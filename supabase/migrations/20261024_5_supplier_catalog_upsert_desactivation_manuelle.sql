-- 20261024_5_supplier_catalog_upsert_desactivation_manuelle.sql
-- Relecture du 2026-10-24 (I2) : « Supprimer » un article d'un fournisseur connecté (is_active=false à la main)
-- était défait en silence au relevé suivant, la RPC réactivant toute référence présente dans le relevé.
-- Règle : seules les désactivations faites PAR LE RELEVÉ (marque specs.desactive_par_releve = true, posée ici)
-- sont réactivées quand l'article revient ; un article désactivé à la main reste inactif (son prix d'achat et ses
-- specs continuent d'être suivis) et est compté dans `ignores_inactifs`. La marque est effacée à la réactivation.
-- Même signature, mêmes droits (service_role seul) que 20261024_2.

CREATE OR REPLACE FUNCTION public.supplier_catalog_upsert(
  p_org_id uuid,
  p_supplier_id uuid,
  p_source_version text,
  p_rows jsonb
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
           r.default_tva_rate, r.unit, r.category, COALESCE(r.specs, '{}'::jsonb) AS specs
    FROM jsonb_to_recordset(p_rows) AS r(
      reference text, name text, brand text, gamme text, product_kind text, purchase_price_ht numeric,
      selling_price_ht_defaut numeric, default_tva_rate numeric, unit text, category text, specs jsonb);

  IF EXISTS (SELECT 1 FROM t_imp WHERE reference IS NULL OR reference = '' OR name IS NULL OR name = '' OR purchase_price_ht IS NULL) THEN
    RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) - count(DISTINCT reference) FROM t_imp) > 0 THEN
    RAISE EXCEPTION 'reference_en_double' USING ERRCODE = '22023';
  END IF;

  -- Articles présents dans le relevé : prix d'achat, marque, gamme, nature, specs (fusion niveau 1 + canonical).
  -- JAMAIS name ; selling_price_ht seulement s'il est encore à 0 et que le relevé propose un défaut.
  -- is_active : réactivé seulement si la désactivation venait du relevé ; une suppression manuelle est respectée.
  UPDATE majordhome.supplier_products p SET
    brand = COALESCE(t.brand, p.brand),
    gamme = COALESCE(t.gamme, p.gamme),
    product_kind = COALESCE(t.product_kind, p.product_kind),
    category = COALESCE(t.category, p.category),
    purchase_price_ht = t.purchase_price_ht,
    selling_price_ht = CASE WHEN p.selling_price_ht = 0 AND COALESCE(t.selling_price_ht_defaut, 0) > 0
                            THEN t.selling_price_ht_defaut ELSE p.selling_price_ht END,
    default_tva_rate = COALESCE(t.default_tva_rate, p.default_tva_rate),
    unit = COALESCE(t.unit, p.unit),
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
     default_tva_rate, unit, specs, product_kind, is_active)
  SELECT p_supplier_id, p_org_id, t.reference, t.name, t.category, t.gamme, t.brand, t.purchase_price_ht,
         COALESCE(t.selling_price_ht_defaut, 0), COALESCE(t.default_tva_rate, 20), COALESCE(t.unit, 'pièce'),
         t.specs, COALESCE(t.product_kind, 'main'), true
  FROM t_imp t
  WHERE NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p
                    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- Absent du relevé = plus au tarif : désactivé (marqué comme tel), jamais supprimé.
  UPDATE majordhome.supplier_products p
  SET is_active = false, specs = COALESCE(p.specs, '{}'::jsonb) || '{"desactive_par_releve": true}'::jsonb, updated_at = now()
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active
    AND NOT EXISTS (SELECT 1 FROM t_imp t WHERE t.reference = p.reference);
  GET DIAGNOSTICS v_des = ROW_COUNT;

  SELECT count(*) INTO v_total FROM majordhome.supplier_products p
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active;

  v_res := jsonb_build_object('ok', true, 'at', now(), 'version', p_source_version,
                              'inseres', v_ins, 'mis_a_jour', v_upd - v_ign, 'desactives', v_des,
                              'ignores_inactifs', v_ign, 'total', v_total);
  UPDATE majordhome.suppliers SET catalog_sync_at = now(), catalog_sync_result = v_res, updated_at = now()
  WHERE id = p_supplier_id AND org_id = p_org_id;
  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb) TO service_role;
COMMENT ON FUNCTION public.supplier_catalog_upsert IS
  'Écrivain unique du catalogue fournisseur depuis un relevé (service_role). name/selling_price_ht à l''INSERT seulement ; absents désactivés (marqués desactive_par_releve) ; une désactivation manuelle est respectée.';
