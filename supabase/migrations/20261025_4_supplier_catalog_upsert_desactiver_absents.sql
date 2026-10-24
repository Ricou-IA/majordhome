-- 20261025_4_supplier_catalog_upsert_desactiver_absents.sql
-- Import du catalogue d'achats depuis les factures fournisseur Pennylane (SODITELEM, TEREVA — scripts/catalogue/
-- import-achats-pennylane.mjs) : un relevé de FACTURES n'est pas un tarif. Un article absent des derniers relevés n'est
-- pas « plus au tarif », il n'a simplement pas été acheté ce mois-ci : la désactivation des absents (règle des
-- relevés de catalogue BayWa / Domos / Ecostal) doit pouvoir être débrayée par l'appelant.
--   p_meta ->> 'desactiver_absents' (booléen, défaut true = comportement inchangé) : à false, aucun article n'est
--   désactivé ; `desactives` vaut 0 et `desactiver_absents` est rappelé dans le résultat.
-- Corps identique à 20261025_2 par ailleurs ; même signature, mêmes droits (service_role seul).

CREATE OR REPLACE FUNCTION public.supplier_catalog_upsert(
  p_org_id uuid,
  p_supplier_id uuid,
  p_source_version text,
  p_rows jsonb,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_des int := 0;
  v_ign int := 0;
  v_total int := 0;
  v_res jsonb;
  v_desactiver boolean := COALESCE((p_meta ->> 'desactiver_absents')::boolean, true);
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'rows_empty' USING ERRCODE = '22023';
  END IF;
  IF p_org_id IS NULL OR p_supplier_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM majordhome.suppliers s WHERE s.id = p_supplier_id AND s.org_id = p_org_id) THEN
    RAISE EXCEPTION 'supplier_not_in_org' USING ERRCODE = '42501';
  END IF;

  IF to_regclass('pg_temp.t_imp') IS NOT NULL THEN DROP TABLE pg_temp.t_imp; END IF;
  CREATE TEMP TABLE t_imp ON COMMIT DROP AS
    SELECT r.reference, r.name, r.brand, r.gamme, r.product_kind, r.purchase_price_ht, r.selling_price_ht_defaut,
           r.default_tva_rate, r.unit, r.category, COALESCE(r.specs, '{}'::jsonb) AS specs,
           r.image_url, r.image_source_url, r.model_key
    FROM jsonb_to_recordset(p_rows) AS r(
      reference text, name text, brand text, gamme text, product_kind text, purchase_price_ht numeric,
      selling_price_ht_defaut numeric, default_tva_rate numeric, unit text, category text, specs jsonb,
      image_url text, image_source_url text, model_key text);

  IF EXISTS (SELECT 1 FROM t_imp WHERE reference IS NULL OR reference = '' OR name IS NULL OR name = '' OR purchase_price_ht IS NULL) THEN
    RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) - count(DISTINCT reference) FROM t_imp) > 0 THEN
    RAISE EXCEPTION 'reference_en_double' USING ERRCODE = '22023';
  END IF;

  -- Articles présents dans le relevé : prix d'achat, specs (fusion niveau 1 + canonical), photo si absente, clé modèle.
  -- JAMAIS name, category, product_kind, brand, gamme (humains) ; selling_price_ht seulement s'il est encore à 0.
  -- is_active : réactivé seulement si la désactivation venait du relevé ; une suppression manuelle est respectée.
  UPDATE majordhome.supplier_products p SET
    purchase_price_ht = t.purchase_price_ht,
    selling_price_ht = CASE WHEN p.selling_price_ht = 0 AND COALESCE(t.selling_price_ht_defaut, 0) > 0
                            THEN t.selling_price_ht_defaut ELSE p.selling_price_ht END,
    default_tva_rate = COALESCE(t.default_tva_rate, p.default_tva_rate),
    unit = COALESCE(t.unit, p.unit),
    image_url = COALESCE(p.image_url, t.image_url),
    image_source_url = CASE WHEN p.image_url IS NULL THEN COALESCE(t.image_source_url, p.image_source_url) ELSE p.image_source_url END,
    model_key = CASE WHEN p.model_key_source = 'manuel' THEN p.model_key ELSE t.model_key END,
    model_key_source = CASE WHEN p.model_key_source = 'manuel' THEN 'manuel' WHEN t.model_key IS NOT NULL THEN 'cle' ELSE NULL END,
    specs = (COALESCE(p.specs, '{}'::jsonb) || t.specs
             || jsonb_build_object('canonical', COALESCE(p.specs -> 'canonical', '{}'::jsonb) || COALESCE(t.specs -> 'canonical', '{}'::jsonb))
            ) - 'desactive_par_releve',
    is_active = CASE WHEN p.is_active THEN true
                     WHEN (p.specs ->> 'desactive_par_releve')::boolean IS TRUE THEN true
                     ELSE false END,
    updated_at = now()
  FROM t_imp t
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference;
  GET DIAGNOSTICS v_upd = ROW_COUNT;

  SELECT count(*) INTO v_ign FROM majordhome.supplier_products p JOIN t_imp t ON t.reference = p.reference
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND NOT p.is_active;

  INSERT INTO majordhome.supplier_products
    (supplier_id, org_id, reference, name, category, gamme, brand, purchase_price_ht, selling_price_ht,
     default_tva_rate, unit, specs, product_kind, is_active, image_url, image_source_url, model_key, model_key_source)
  SELECT p_supplier_id, p_org_id, t.reference, t.name, t.category, t.gamme, t.brand, t.purchase_price_ht,
         COALESCE(t.selling_price_ht_defaut, 0), COALESCE(t.default_tva_rate, 20), COALESCE(t.unit, 'pièce'),
         t.specs, COALESCE(t.product_kind, 'main'), true, t.image_url, t.image_source_url, t.model_key,
         CASE WHEN t.model_key IS NOT NULL THEN 'cle' ELSE NULL END
  FROM t_imp t
  WHERE NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p
                    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- Absent du relevé = plus au tarif : désactivé (marqué comme tel), jamais supprimé — sauf si l'appelant le débraye
  -- (p_meta.desactiver_absents = false : relevé de FACTURES, un article non racheté ce mois-ci reste au catalogue).
  IF v_desactiver THEN
    UPDATE majordhome.supplier_products p
    SET is_active = false, specs = COALESCE(p.specs, '{}'::jsonb) || '{"desactive_par_releve": true}'::jsonb, updated_at = now()
    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active
      AND NOT EXISTS (SELECT 1 FROM t_imp t WHERE t.reference = p.reference);
    GET DIAGNOSTICS v_des = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_total FROM majordhome.supplier_products p
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active;

  v_res := jsonb_build_object('ok', true, 'at', now(), 'version', p_source_version,
                              'inseres', v_ins, 'mis_a_jour', v_upd - v_ign, 'desactives', v_des,
                              'ignores_inactifs', v_ign, 'total', v_total,
                              'categories_vues', COALESCE(p_meta -> 'categories_vues', '[]'::jsonb),
                              'desactiver_absents', v_desactiver);
  UPDATE majordhome.suppliers SET catalog_sync_at = now(), catalog_sync_result = v_res, catalog_sync_error = NULL, updated_at = now()
  WHERE id = p_supplier_id AND org_id = p_org_id;
  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) TO service_role;
COMMENT ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) IS
  'Écrivain unique du catalogue fournisseur depuis un relevé (service_role). name / selling_price_ht / category / product_kind / brand / gamme à l''INSERT seulement ; photo si absente ; clé modèle sauf manuelle ; absents désactivés (marqués) sauf p_meta.desactiver_absents=false (relevé de factures) ; suppression manuelle respectée.';
