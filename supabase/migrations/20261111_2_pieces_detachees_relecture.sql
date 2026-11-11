-- 20261111_2_pieces_detachees_relecture.sql
-- Corrections de la relecture de 20261111_1 (pièces détachées par modèle d'appareil) :
--   1. supplier_pieces_upsert : le prix de vente de l'ARTICLE suit le prix public sur son propre prix (plus sur celui
--      de la ligne) ; « ajustés à la main, non suivis » compte une ligne OU un article ajusté.
--   2. equipment_models_upsert : un modèle reçu sans aucune ligne garde sa nomenclature (et est nommé dans le
--      résultat, `nomenclatures_conservees`) au lieu de la perdre.
--   3. supplier_catalog_upsert : la désactivation des absents ne touche plus les pièces détachées — un relevé du
--      TARIF du fournisseur aurait désactivé toutes ses pièces. Corps relu de la prod (pg_get_functiondef) le
--      2026-11-11, une seule clause ajoutée ; privilèges inchangés (réaffirmés).
-- Répétée sur scripts/migration-rehearsal/ (assert-equipment-models-pieces.sql, après 20261111_1).

CREATE OR REPLACE FUNCTION public.supplier_catalog_upsert(p_org_id uuid, p_supplier_id uuid, p_source_version text, p_rows jsonb, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_des int := 0;
  v_ign int := 0;
  v_total int := 0;
  v_res jsonb;
  v_art jsonb;
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
           r.default_tva_rate, r.unit, r.category,
           COALESCE(r.specs, '{}'::jsonb)
             || CASE WHEN r.category IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('categorie_releve', r.category) END AS specs,
           r.image_url, r.image_source_url, r.model_key,
           -- date du prix : fournie par l'appelant (import d'achats : date de la facture), sinon le relevé = maintenant
           COALESCE(r.purchase_price_at, now()) AS purchase_price_at,
           -- prix public et taux de remise = faits fournisseur (« Prix de base » Soditelem), rafraîchis à chaque relevé
           r.tarif_public, r.taux_remise
    FROM jsonb_to_recordset(p_rows) AS r(
      reference text, name text, brand text, gamme text, product_kind text, purchase_price_ht numeric,
      selling_price_ht_defaut numeric, default_tva_rate numeric, unit text, category text, specs jsonb,
      image_url text, image_source_url text, model_key text, purchase_price_at timestamptz,
      tarif_public numeric, taux_remise numeric);

  IF EXISTS (SELECT 1 FROM t_imp WHERE reference IS NULL OR reference = '' OR name IS NULL OR name = '' OR purchase_price_ht IS NULL) THEN
    RAISE EXCEPTION 'row_invalid' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) - count(DISTINCT reference) FROM t_imp) > 0 THEN
    RAISE EXCEPTION 'reference_en_double' USING ERRCODE = '22023';
  END IF;

  UPDATE majordhome.supplier_products p SET
    purchase_price_ht = t.purchase_price_ht,
    purchase_price_at = t.purchase_price_at,
    tarif_public = COALESCE(t.tarif_public, p.tarif_public),
    taux_remise = COALESCE(t.taux_remise, p.taux_remise),
    selling_price_ht = CASE WHEN p.selling_price_ht = 0 AND COALESCE(t.selling_price_ht_defaut, 0) > 0
                            THEN t.selling_price_ht_defaut ELSE p.selling_price_ht END,
    default_tva_rate = COALESCE(t.default_tva_rate, p.default_tva_rate),
    unit = COALESCE(t.unit, p.unit),
    image_url = COALESCE(p.image_url, t.image_url),
    image_source_url = CASE WHEN p.image_url IS NULL THEN COALESCE(t.image_source_url, p.image_source_url) ELSE p.image_source_url END,
    model_key = CASE WHEN p.model_key_source = 'manuel' THEN p.model_key
                     WHEN t.model_key IS NOT NULL THEN t.model_key
                     WHEN p.model_key_source = 'ia' THEN p.model_key
                     ELSE NULL END,
    model_key_source = CASE WHEN p.model_key_source = 'manuel' THEN 'manuel'
                            WHEN t.model_key IS NOT NULL THEN 'cle'
                            WHEN p.model_key_source = 'ia' THEN 'ia'
                            ELSE NULL END,
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
    (supplier_id, org_id, reference, name, category, gamme, brand, purchase_price_ht, purchase_price_at, selling_price_ht,
     default_tva_rate, unit, specs, product_kind, is_active, image_url, image_source_url, model_key, model_key_source,
     tarif_public, taux_remise)
  SELECT p_supplier_id, p_org_id, t.reference, t.name, t.category, t.gamme, t.brand, t.purchase_price_ht, t.purchase_price_at,
         COALESCE(t.selling_price_ht_defaut, 0), COALESCE(t.default_tva_rate, 20), COALESCE(t.unit, 'pièce'),
         t.specs, COALESCE(t.product_kind, 'main'), true, t.image_url, t.image_source_url, t.model_key,
         CASE WHEN t.model_key IS NOT NULL THEN 'cle' ELSE NULL END,
         t.tarif_public, COALESCE(t.taux_remise, 0)
  FROM t_imp t
  WHERE NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p
                    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  IF v_desactiver THEN
    UPDATE majordhome.supplier_products p
    SET is_active = false, specs = COALESCE(p.specs, '{}'::jsonb) || '{"desactive_par_releve": true}'::jsonb, updated_at = now()
    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active
      -- 20261111_2 : un relevé du tarif ne désactive jamais les pièces détachées (écrites par supplier_pieces_upsert)
      AND p.category IS DISTINCT FROM 'piece_detachee'
      AND NOT EXISTS (SELECT 1 FROM t_imp t WHERE t.reference = p.reference);
    GET DIAGNOSTICS v_des = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_total FROM majordhome.supplier_products p
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active;

  -- Articles Majord'home : chaque ligne active sans article en reçoit un (rattachement franc ou création).
  v_art := public.catalog_items_ensure(p_org_id);

  v_res := jsonb_build_object('ok', true, 'at', now(), 'version', p_source_version,
                              'inseres', v_ins, 'mis_a_jour', v_upd - v_ign, 'desactives', v_des,
                              'ignores_inactifs', v_ign, 'total', v_total,
                              'categories_vues', COALESCE(p_meta -> 'categories_vues', '[]'::jsonb),
                              'desactiver_absents', v_desactiver,
                              'articles', v_art);
  UPDATE majordhome.suppliers SET catalog_sync_at = now(), catalog_sync_result = v_res, catalog_sync_error = NULL, updated_at = now()
  WHERE id = p_supplier_id AND org_id = p_org_id;
  RETURN v_res;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.supplier_pieces_upsert(
  p_org_id uuid,
  p_supplier_id uuid,
  p_source_version text,
  p_marque text,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_res jsonb;
  v_ref text;
  v_suivis int := 0;
  v_ajustes int := 0;
  v_des int := 0;
  v_marque text := btrim(COALESCE(p_marque, ''));
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'rows_empty' USING ERRCODE = '22023';
  END IF;
  IF v_marque = '' THEN
    RAISE EXCEPTION 'marque_required' USING ERRCODE = '22023';
  END IF;
  IF p_org_id IS NULL OR p_supplier_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM majordhome.suppliers s WHERE s.id = p_supplier_id AND s.org_id = p_org_id) THEN
    RAISE EXCEPTION 'supplier_not_in_org' USING ERRCODE = '42501';
  END IF;

  IF to_regclass('pg_temp.t_pieces') IS NOT NULL THEN DROP TABLE pg_temp.t_pieces; END IF;
  CREATE TEMP TABLE t_pieces ON COMMIT DROP AS
    SELECT r.reference, r.category
    FROM jsonb_to_recordset(p_rows) AS r(reference text, category text);
  CREATE INDEX ON t_pieces (reference);
  ANALYZE t_pieces;

  IF EXISTS (SELECT 1 FROM t_pieces WHERE category IS DISTINCT FROM 'piece_detachee') THEN
    RAISE EXCEPTION 'row_not_piece' USING ERRCODE = '22023', HINT = 'Toutes les lignes doivent être de catégorie piece_detachee.';
  END IF;
  -- La marque du site est comparée telle quelle dans releves_pieces : une seule graphie par marque (celle du site).

  -- Une référence déjà au tarif du fournisseur (hors pièces) n'est jamais réécrite par un relevé de pièces.
  SELECT p.reference INTO v_ref
  FROM majordhome.supplier_products p JOIN t_pieces t ON t.reference = p.reference
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.category IS DISTINCT FROM 'piece_detachee'
  LIMIT 1;
  IF v_ref IS NOT NULL THEN
    RAISE EXCEPTION 'reference_au_tarif: %', v_ref USING ERRCODE = '22023';
  END IF;

  -- Photo d'avant : prix public et prix de vente des pièces déjà connues (ligne et article).
  IF to_regclass('pg_temp.t_avant') IS NOT NULL THEN DROP TABLE pg_temp.t_avant; END IF;
  CREATE TEMP TABLE t_avant ON COMMIT DROP AS
    SELECT p.id, COALESCE(p.tarif_public, 0) AS tarif_public, COALESCE(p.selling_price_ht, 0) AS selling_price_ht,
           p.catalog_item_id, COALESCE(ci.selling_price_ht, 0) AS item_selling_price_ht
    FROM majordhome.supplier_products p
    JOIN t_pieces t ON t.reference = p.reference
    LEFT JOIN majordhome.catalog_items ci ON ci.id = p.catalog_item_id
    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id;
  CREATE INDEX ON t_avant (id);
  ANALYZE t_avant;

  v_res := public.supplier_catalog_upsert(p_org_id, p_supplier_id, p_source_version, p_rows, '{"desactiver_absents": false}'::jsonb);

  -- Suivi du prix de vente (Eric, 2026-11-11) : il suit le nouveau prix public tant qu'il n'a pas été ajusté à la
  -- main (resté égal à l'ancien prix public, ou encore à 0). Un prix ajusté est conservé et compté.
  -- La ligne et l'article sont jugés CHACUN sur son propre prix : l'un peut avoir été ajusté sans l'autre.
  SELECT count(*) INTO v_ajustes
  FROM majordhome.supplier_products p JOIN t_avant a ON a.id = p.id
  WHERE COALESCE(p.tarif_public, 0) <> a.tarif_public
    AND ((a.selling_price_ht <> a.tarif_public AND a.selling_price_ht <> 0)
         OR (a.catalog_item_id IS NOT NULL AND a.item_selling_price_ht <> a.tarif_public AND a.item_selling_price_ht <> 0));

  UPDATE majordhome.catalog_items ci SET selling_price_ht = COALESCE(p.tarif_public, 0), updated_at = now()
  FROM t_avant a JOIN majordhome.supplier_products p ON p.id = a.id
  WHERE ci.id = a.catalog_item_id
    AND COALESCE(p.tarif_public, 0) <> a.tarif_public
    AND (a.item_selling_price_ht = a.tarif_public OR a.item_selling_price_ht = 0);

  UPDATE majordhome.supplier_products p SET selling_price_ht = COALESCE(p.tarif_public, 0), updated_at = now()
  FROM t_avant a
  WHERE p.id = a.id
    AND COALESCE(p.tarif_public, 0) <> a.tarif_public
    AND (a.selling_price_ht = a.tarif_public OR a.selling_price_ht = 0);
  GET DIAGNOSTICS v_suivis = ROW_COUNT;

  -- Marque du site où la pièce a été vue (une pièce peut être partagée par plusieurs marques du groupe).
  UPDATE majordhome.supplier_products p
  SET specs = jsonb_set(
        jsonb_set(COALESCE(p.specs, '{}'::jsonb), '{canonical}', COALESCE(p.specs -> 'canonical', '{}'::jsonb), true),
        '{canonical,releves_pieces}',
        (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
         FROM (SELECT jsonb_array_elements_text(
                        CASE WHEN jsonb_typeof(p.specs -> 'canonical' -> 'releves_pieces') = 'array'
                             THEN p.specs -> 'canonical' -> 'releves_pieces' ELSE '[]'::jsonb END) AS x
               UNION SELECT v_marque) s),
        true)
  FROM t_pieces t
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference;

  -- Pièces absentes du relevé : désactivées si cette marque était leur seule provenance, sinon la marque est retirée.
  UPDATE majordhome.supplier_products p
  SET is_active = false, specs = COALESCE(p.specs, '{}'::jsonb) || '{"desactive_par_releve": true}'::jsonb, updated_at = now()
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active AND p.category = 'piece_detachee'
    AND p.specs -> 'canonical' -> 'releves_pieces' = jsonb_build_array(v_marque)
    AND NOT EXISTS (SELECT 1 FROM t_pieces t WHERE t.reference = p.reference);
  GET DIAGNOSTICS v_des = ROW_COUNT;

  UPDATE majordhome.supplier_products p
  SET specs = jsonb_set(p.specs, '{canonical,releves_pieces}', (p.specs -> 'canonical' -> 'releves_pieces') - v_marque)
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.category = 'piece_detachee'
    AND jsonb_typeof(p.specs -> 'canonical' -> 'releves_pieces') = 'array'
    AND jsonb_array_length(p.specs -> 'canonical' -> 'releves_pieces') > 1
    AND p.specs -> 'canonical' -> 'releves_pieces' ? v_marque
    AND NOT EXISTS (SELECT 1 FROM t_pieces t WHERE t.reference = p.reference);

  v_res := v_res || jsonb_build_object('releve', 'pieces', 'marque', v_marque, 'prix_suivis', v_suivis,
                                       'prix_ajustes_non_suivis', v_ajustes, 'pieces_desactivees', v_des);
  UPDATE majordhome.suppliers SET catalog_sync_result = v_res, updated_at = now()
  WHERE id = p_supplier_id AND org_id = p_org_id;
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.supplier_pieces_upsert(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_pieces_upsert(uuid, uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.equipment_models_upsert(
  p_org_id uuid,
  p_supplier_id uuid,
  p_brand text,
  p_source_version text,
  p_models jsonb,
  p_parts jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_bk text := majordhome.equipment_model_key(p_brand);
  v_ref text;
  v_models int := 0;
  v_lignes int := 0;
  v_vides text[];
BEGIN
  IF p_models IS NULL OR jsonb_typeof(p_models) <> 'array' OR jsonb_array_length(p_models) = 0 THEN
    RAISE EXCEPTION 'models_empty' USING ERRCODE = '22023';
  END IF;
  IF v_bk IS NULL OR COALESCE(btrim(p_source_version), '') = '' THEN
    RAISE EXCEPTION 'brand_and_version_required' USING ERRCODE = '22023';
  END IF;
  IF p_org_id IS NULL OR p_supplier_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM majordhome.suppliers s WHERE s.id = p_supplier_id AND s.org_id = p_org_id) THEN
    RAISE EXCEPTION 'supplier_not_in_org' USING ERRCODE = '42501';
  END IF;

  IF to_regclass('pg_temp.t_models') IS NOT NULL THEN DROP TABLE pg_temp.t_models; END IF;
  CREATE TEMP TABLE t_models ON COMMIT DROP AS
    SELECT m.source_id, m.reference, m.name, m.model_name, m.category, m.lifecycle, COALESCE(m.source, '{}'::jsonb) AS source
    FROM jsonb_to_recordset(p_models) AS m(source_id text, reference text, name text, model_name text, category text, lifecycle text, source jsonb);
  CREATE INDEX ON t_models (source_id);
  ANALYZE t_models;
  IF EXISTS (SELECT 1 FROM t_models WHERE COALESCE(source_id, '') = '' OR COALESCE(reference, '') = '' OR COALESCE(name, '') = '') THEN
    RAISE EXCEPTION 'model_invalid' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) - count(DISTINCT source_id) FROM t_models) > 0 THEN
    RAISE EXCEPTION 'model_en_double' USING ERRCODE = '22023';
  END IF;

  IF to_regclass('pg_temp.t_parts') IS NOT NULL THEN DROP TABLE pg_temp.t_parts; END IF;
  CREATE TEMP TABLE t_parts ON COMMIT DROP AS
    SELECT l.modele_source_id, l.position, COALESCE(l.repere, '') AS repere, l.piece_reference,
           COALESCE(l.quantity, 1) AS quantity, COALESCE(l.notes, '') AS notes, l.prix_public,
           NULL::uuid AS supplier_product_id
    FROM jsonb_to_recordset(COALESCE(p_parts, '[]'::jsonb)) AS l(modele_source_id text, "position" integer, repere text, piece_reference text, quantity numeric, notes text, prix_public numeric);
  CREATE INDEX ON t_parts (piece_reference);
  CREATE INDEX ON t_parts (modele_source_id);
  ANALYZE t_parts;

  SELECT l.modele_source_id INTO v_ref FROM t_parts l
  WHERE NOT EXISTS (SELECT 1 FROM t_models m WHERE m.source_id = l.modele_source_id) LIMIT 1;
  IF v_ref IS NOT NULL THEN
    RAISE EXCEPTION 'ligne_sans_modele: %', v_ref USING ERRCODE = '22023';
  END IF;

  -- Pièce = ligne du fournisseur de même référence (active d'abord, puis la plus ancienne : le tarif INVICTA
  -- porte quelques références en double).
  UPDATE t_parts l SET supplier_product_id = (
    SELECT p.id FROM majordhome.supplier_products p
    WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = l.piece_reference
    ORDER BY p.is_active DESC, p.created_at ASC, p.id ASC LIMIT 1);
  SELECT l.piece_reference INTO v_ref FROM t_parts l WHERE l.supplier_product_id IS NULL LIMIT 1;
  IF v_ref IS NOT NULL THEN
    RAISE EXCEPTION 'piece_introuvable: %', v_ref USING ERRCODE = '22023';
  END IF;

  INSERT INTO majordhome.equipment_models
    (org_id, supplier_id, brand, brand_key, source_id, reference, reference_key, name, model_name, category, lifecycle, source, is_active)
  SELECT p_org_id, p_supplier_id, btrim(p_brand), v_bk, m.source_id, m.reference, majordhome.equipment_model_key(m.reference),
         m.name, COALESCE(NULLIF(btrim(m.model_name), ''), m.name), m.category, m.lifecycle,
         m.source || jsonb_build_object('version', p_source_version), true
  FROM t_models m
  ON CONFLICT (org_id, brand_key, source_id) DO UPDATE SET
    supplier_id = EXCLUDED.supplier_id, brand = EXCLUDED.brand, reference = EXCLUDED.reference, name = EXCLUDED.name,
    model_name = EXCLUDED.model_name, category = EXCLUDED.category, lifecycle = EXCLUDED.lifecycle,
    source = EXCLUDED.source, is_active = true, updated_at = now();
  GET DIAGNOSTICS v_models = ROW_COUNT;

  -- Un modèle reçu SANS aucune ligne garde sa nomenclature (un appareil rendu vide par le site ne doit pas effacer
  -- ce qu'on savait) ; il est nommé dans le résultat.
  SELECT array_agg(em.reference ORDER BY em.reference) INTO v_vides
  FROM majordhome.equipment_models em JOIN t_models m ON m.source_id = em.source_id
  WHERE em.org_id = p_org_id AND em.brand_key = v_bk
    AND NOT EXISTS (SELECT 1 FROM t_parts l WHERE l.modele_source_id = m.source_id)
    AND EXISTS (SELECT 1 FROM majordhome.equipment_model_parts mp WHERE mp.equipment_model_id = em.id);

  DELETE FROM majordhome.equipment_model_parts mp
  USING majordhome.equipment_models em JOIN t_models m ON m.source_id = em.source_id
  WHERE em.org_id = p_org_id AND em.brand_key = v_bk AND mp.equipment_model_id = em.id
    AND EXISTS (SELECT 1 FROM t_parts l WHERE l.modele_source_id = m.source_id);

  INSERT INTO majordhome.equipment_model_parts
    (org_id, equipment_model_id, position, repere, supplier_product_id, quantity, notes, public_price_ht)
  SELECT p_org_id, em.id, l.position, l.repere, l.supplier_product_id, l.quantity, l.notes, l.prix_public
  FROM t_parts l
  JOIN majordhome.equipment_models em ON em.org_id = p_org_id AND em.brand_key = v_bk AND em.source_id = l.modele_source_id;
  GET DIAGNOSTICS v_lignes = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'version', p_source_version, 'modeles', v_models, 'lignes', v_lignes,
                            'nomenclatures_conservees', COALESCE(to_jsonb(v_vides), '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipment_models_upsert(uuid, uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_models_upsert(uuid, uuid, text, text, jsonb, jsonb) TO service_role;
