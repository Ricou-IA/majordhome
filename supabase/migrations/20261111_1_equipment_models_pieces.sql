-- 20261111_1_equipment_models_pieces.sql
-- Pièces détachées par modèle d'appareil (tranche 1 : relevé et données). Spec :
-- docs/superpowers/specs/2026-11-11-pieces-detachees-invicta-releve-nomenclature-design.md
-- Demande d'Eric (2026-11-11) : « les vues éclatées pour avoir directement dans l'application la liste des pièces
-- détachées » et « avoir le prix des pièces détachées dans notre outil », avec une mise à jour rapide depuis le site
-- du fabricant (relevé navigateur, scripts/catalogue/dump-invicta-pieces.browser.js).
--   1. majordhome.equipment_models : le MODÈLE FABRICANT (marque, référence, nom, rayon, photo, vues éclatées),
--      par org. Identité = (org, marque, identifiant du site) : une même référence fabricant peut désigner deux
--      appareils (« FOYER 700 DO INVICTA » et sa version EXPORT portent tous deux P687644).
--   2. majordhome.equipment_model_parts : la NOMENCLATURE (repère de la vue éclatée, pièce, quantité, remarque,
--      prix public de la pièce SUR CET APPAREIL — une même référence a parfois un prix différent selon l'appareil).
--   3. equipments.equipment_model_id : rattachement EXPLICITE d'un équipement client à son modèle fabricant.
--   4. public.supplier_pieces_upsert : SEUL écrivain d'un relevé de pièces. Enveloppe de l'écrivain unique
--      supplier_catalog_upsert (appelé avec desactiver_absents = false : un relevé de pièces ne doit JAMAIS
--      désactiver le tarif du fournisseur), plus : refus d'une référence déjà au tarif, suivi du prix de vente
--      (décision d'Eric : le prix de vente d'une pièce suit le prix public sauf s'il a été ajusté à la main),
--      désactivation des seules pièces absentes relevées sous cette marque.
--   5. public.equipment_models_upsert (par lots) / equipment_models_close (une fois) : modèles + nomenclature.
-- Écritures : service_role seul (les trois RPC prennent org_id en paramètre). Lecture : membre de l'org.
-- Répétée sur scripts/migration-rehearsal/ (assert-equipment-models-pieces.sql).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Modèles d'appareil
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.equipment_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES majordhome.suppliers(id) ON DELETE SET NULL,
  brand text NOT NULL,
  brand_key text NOT NULL,
  source_id text NOT NULL,
  reference text NOT NULL,
  reference_key text NOT NULL,
  name text NOT NULL,
  model_name text NOT NULL,
  model_name_key text,
  category text,
  lifecycle text,
  photo_path text,
  exploded_views jsonb NOT NULL DEFAULT '[]'::jsonb,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_models_org_brand_source_unique UNIQUE (org_id, brand_key, source_id)
);
COMMENT ON TABLE majordhome.equipment_models IS 'Modèle fabricant d''un appareil (relevé du site du fabricant) : référence, nom, photo, vues éclatées. Écrit par public.equipment_models_upsert (service_role) seulement.';
COMMENT ON COLUMN majordhome.equipment_models.source_id IS 'Identifiant de l''appareil sur le site du fabricant (publicId) : identité du modèle, la référence n''étant pas unique.';
COMMENT ON COLUMN majordhome.equipment_models.photo_path IS 'Chemin Storage de la photo (rempli par la copie des fichiers, jamais écrasé par un relevé).';
COMMENT ON COLUMN majordhome.equipment_models.exploded_views IS 'Vues éclatées copiées dans le Storage : [{ path, width, height }] (remplies par la copie des fichiers).';
COMMENT ON COLUMN majordhome.equipment_models.source IS 'Provenance : { site, publicId, version, photo, vues_eclatees, documents } tels que relevés (adresses du site, pour la copie des fichiers).';
CREATE INDEX IF NOT EXISTS equipment_models_org_brand_reference_idx ON majordhome.equipment_models (org_id, brand_key, reference_key);

CREATE OR REPLACE FUNCTION majordhome.equipment_models_set_keys() RETURNS trigger
LANGUAGE plpgsql
SET search_path = majordhome, public
AS $$
BEGIN
  NEW.brand_key := majordhome.equipment_model_key(NEW.brand);
  NEW.reference_key := majordhome.equipment_model_key(NEW.reference);
  NEW.model_name_key := majordhome.equipment_model_key(NEW.model_name);
  IF NEW.brand_key IS NULL OR NEW.reference_key IS NULL THEN
    RAISE EXCEPTION 'equipment_model_key_required' USING ERRCODE = '22023',
      HINT = 'La marque et la référence doivent contenir au moins une lettre ou un chiffre.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION majordhome.equipment_models_set_keys() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS equipment_models_set_keys ON majordhome.equipment_models;
CREATE TRIGGER equipment_models_set_keys
  BEFORE INSERT OR UPDATE OF brand, reference, model_name ON majordhome.equipment_models
  FOR EACH ROW EXECUTE FUNCTION majordhome.equipment_models_set_keys();

ALTER TABLE majordhome.equipment_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipment_models_select ON majordhome.equipment_models;
CREATE POLICY equipment_models_select ON majordhome.equipment_models FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
REVOKE ALL ON majordhome.equipment_models FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.equipment_models TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Nomenclature
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.equipment_model_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  equipment_model_id uuid NOT NULL REFERENCES majordhome.equipment_models(id) ON DELETE CASCADE,
  position integer NOT NULL,
  repere text NOT NULL DEFAULT '',
  supplier_product_id uuid NOT NULL REFERENCES majordhome.supplier_products(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 1,
  notes text NOT NULL DEFAULT '',
  public_price_ht numeric
);
COMMENT ON TABLE majordhome.equipment_model_parts IS 'Nomenclature d''un modèle d''appareil : repère de la vue éclatée → pièce (ligne fournisseur), quantité, remarque. Remplacée en bloc par modèle à chaque relevé (public.equipment_models_upsert).';
COMMENT ON COLUMN majordhome.equipment_model_parts.repere IS 'Numéro de repère sur la vue éclatée (« 23 », « 7-14 »). Un même repère peut porter plusieurs lignes (variantes).';
COMMENT ON COLUMN majordhome.equipment_model_parts.public_price_ht IS 'Prix public HT de la pièce SUR CET APPAREIL au dernier relevé (NULL = non vendue / sans prix). Une même référence a parfois un prix différent selon l''appareil.';
CREATE INDEX IF NOT EXISTS equipment_model_parts_model_idx ON majordhome.equipment_model_parts (equipment_model_id, position);
CREATE INDEX IF NOT EXISTS equipment_model_parts_product_idx ON majordhome.equipment_model_parts (supplier_product_id);

ALTER TABLE majordhome.equipment_model_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipment_model_parts_select ON majordhome.equipment_model_parts;
CREATE POLICY equipment_model_parts_select ON majordhome.equipment_model_parts FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
REVOKE ALL ON majordhome.equipment_model_parts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.equipment_model_parts TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Rattachement d'un équipement client à son modèle fabricant
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.equipments
  ADD COLUMN IF NOT EXISTS equipment_model_id uuid REFERENCES majordhome.equipment_models(id) ON DELETE SET NULL;
COMMENT ON COLUMN majordhome.equipments.equipment_model_id IS 'Modèle fabricant choisi pour cet appareil (pièces détachées, vue éclatée). Choisi par un humain ; posé d''office seulement si le modèle saisi est exactement une référence fabricant.';
CREATE INDEX IF NOT EXISTS equipments_equipment_model_idx ON majordhome.equipments (equipment_model_id) WHERE equipment_model_id IS NOT NULL;

-- Miroir updatable : la colonne s'ajoute EN FIN (CREATE OR REPLACE VIEW n'autorise que cela) ; l'ACL de la vue est conservée.
CREATE OR REPLACE VIEW public.majordhome_equipments WITH (security_invoker = true) AS
  SELECT id, project_id, category, brand, model, serial_number, install_date, warranty_end_date,
         maintenance_frequency_months, last_maintenance_date, next_maintenance_due, contract_type, contract_tarif,
         contract_start_date, contract_status, invoice_file_id, manual_file_id, status, notes, metadata, created_by,
         created_at, updated_at, installation_year, equipment_type_id, installation_type, supplier_product_id,
         unit_count, category_id, nameplate_photo_path, equipment_model_id
  FROM majordhome.equipments;
REVOKE ALL ON public.majordhome_equipments FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Vues de lecture
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_equipment_models WITH (security_invoker = true) AS
  SELECT id, org_id, supplier_id, brand, brand_key, source_id, reference, reference_key, name, model_name,
         model_name_key, category, lifecycle, photo_path, exploded_views, source, is_active, created_at, updated_at
  FROM majordhome.equipment_models;
REVOKE ALL ON public.majordhome_equipment_models FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_equipment_models TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_equipment_model_parts WITH (security_invoker = true) AS
  SELECT mp.id, mp.org_id, mp.equipment_model_id, mp.position, mp.repere, mp.quantity, mp.notes,
         mp.supplier_product_id,
         sp.reference AS piece_reference,
         sp.name AS piece_name,
         COALESCE(mp.public_price_ht, NULLIF(sp.tarif_public, 0)) AS prix_public_ht,
         sp.selling_price_ht,
         sp.unit,
         sp.catalog_item_id,
         sp.is_active AS piece_active,
         sp.image_url AS piece_image_url,
         sp.specs -> 'canonical' ->> 'cycle_de_vie' AS cycle_de_vie,
         sp.specs -> 'canonical' ->> 'remplacee_par' AS remplacee_par,
         COALESCE((sp.specs -> 'canonical' ->> 'kit')::boolean, false) AS kit,
         COALESCE((sp.specs -> 'canonical' ->> 'vendue_seule')::boolean, true) AS vendue_seule,
         COALESCE((sp.specs -> 'canonical' ->> 'prix_selon_appareil')::boolean, false) AS prix_selon_appareil
  FROM majordhome.equipment_model_parts mp
  JOIN majordhome.supplier_products sp ON sp.id = mp.supplier_product_id;
REVOKE ALL ON public.majordhome_equipment_model_parts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_equipment_model_parts TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Écrivain d'un relevé de pièces détachées
-- ---------------------------------------------------------------------------------------------------------------
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
  SELECT count(*) INTO v_ajustes
  FROM majordhome.supplier_products p JOIN t_avant a ON a.id = p.id
  WHERE COALESCE(p.tarif_public, 0) <> a.tarif_public
    AND a.selling_price_ht <> a.tarif_public AND a.selling_price_ht <> 0;

  UPDATE majordhome.catalog_items ci SET selling_price_ht = COALESCE(p.tarif_public, 0), updated_at = now()
  FROM t_avant a JOIN majordhome.supplier_products p ON p.id = a.id
  WHERE ci.id = a.catalog_item_id
    AND COALESCE(p.tarif_public, 0) <> a.tarif_public
    AND (a.item_selling_price_ht = a.tarif_public OR a.item_selling_price_ht = 0)
    AND (a.selling_price_ht = a.tarif_public OR a.selling_price_ht = 0);

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
COMMENT ON FUNCTION public.supplier_pieces_upsert(uuid, uuid, text, text, jsonb) IS
  'Seul écrivain d''un relevé de pièces détachées (service_role). Appelle supplier_catalog_upsert SANS désactivation des absents (le tarif du fournisseur n''est jamais touché), refuse une référence déjà au tarif, fait suivre le prix de vente au prix public sauf ajustement manuel, désactive les pièces absentes relevées sous cette seule marque.';

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Modèles + nomenclature (par lots), puis clôture du relevé
-- ---------------------------------------------------------------------------------------------------------------
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

  DELETE FROM majordhome.equipment_model_parts mp
  USING majordhome.equipment_models em JOIN t_models m ON m.source_id = em.source_id
  WHERE em.org_id = p_org_id AND em.brand_key = v_bk AND mp.equipment_model_id = em.id;

  INSERT INTO majordhome.equipment_model_parts
    (org_id, equipment_model_id, position, repere, supplier_product_id, quantity, notes, public_price_ht)
  SELECT p_org_id, em.id, l.position, l.repere, l.supplier_product_id, l.quantity, l.notes, l.prix_public
  FROM t_parts l
  JOIN majordhome.equipment_models em ON em.org_id = p_org_id AND em.brand_key = v_bk AND em.source_id = l.modele_source_id;
  GET DIAGNOSTICS v_lignes = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'version', p_source_version, 'modeles', v_models, 'lignes', v_lignes);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipment_models_upsert(uuid, uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_models_upsert(uuid, uuid, text, text, jsonb, jsonb) TO service_role;
COMMENT ON FUNCTION public.equipment_models_upsert(uuid, uuid, text, text, jsonb, jsonb) IS
  'Écrit un lot de modèles d''appareil et remplace leur nomenclature (service_role). Ne désactive rien : equipment_models_close clôt le relevé. Échoue si une pièce de nomenclature ne se résout pas chez le fournisseur.';

CREATE OR REPLACE FUNCTION public.equipment_models_close(
  p_org_id uuid,
  p_brand text,
  p_source_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_bk text := majordhome.equipment_model_key(p_brand);
  v_des int := 0;
  v_rat int := 0;
BEGIN
  IF p_org_id IS NULL OR v_bk IS NULL OR COALESCE(btrim(p_source_version), '') = '' THEN
    RAISE EXCEPTION 'brand_and_version_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.equipment_models em
                 WHERE em.org_id = p_org_id AND em.brand_key = v_bk AND em.source ->> 'version' = p_source_version) THEN
    RAISE EXCEPTION 'releve_non_importe' USING ERRCODE = '22023', HINT = 'Aucun modèle de cette marque ne porte cette version : rien n''est désactivé.';
  END IF;

  -- Modèles absents du relevé : désactivés, jamais supprimés (un équipement client peut y être rattaché).
  UPDATE majordhome.equipment_models em SET is_active = false, updated_at = now()
  WHERE em.org_id = p_org_id AND em.brand_key = v_bk AND em.is_active
    AND em.source ->> 'version' IS DISTINCT FROM p_source_version;
  GET DIAGNOSTICS v_des = ROW_COUNT;

  -- Rattachement d'office : seulement quand le modèle saisi sur l'équipement est EXACTEMENT une référence
  -- fabricant (avec ou sans le « P » initial) et qu'un seul modèle actif y correspond. Jamais par le nom.
  WITH cand AS (
    SELECT e.id AS equipment_id, em.id AS model_id, count(*) OVER (PARTITION BY e.id) AS n
    FROM majordhome.equipments e
    JOIN majordhome.equipment_models em
      ON em.org_id = p_org_id AND em.brand_key = v_bk AND em.is_active
     AND em.reference_key IN (majordhome.equipment_model_key(e.model), 'p' || majordhome.equipment_model_key(e.model))
    WHERE e.equipment_model_id IS NULL
      AND majordhome.equipment_model_key(e.brand) = v_bk
      AND majordhome.project_org_id(e.project_id) = p_org_id
  )
  UPDATE majordhome.equipments e SET equipment_model_id = c.model_id
  FROM cand c WHERE c.equipment_id = e.id AND c.n = 1;
  GET DIAGNOSTICS v_rat = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'version', p_source_version, 'modeles_desactives', v_des, 'equipements_rattaches', v_rat);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.equipment_models_close(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_models_close(uuid, text, text) TO service_role;
COMMENT ON FUNCTION public.equipment_models_close(uuid, text, text) IS
  'Clôt un relevé de modèles d''appareil (service_role) : désactive les modèles de la marque absents de cette version, rattache d''office les équipements dont le modèle saisi est exactement une référence fabricant.';
