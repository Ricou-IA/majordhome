-- 20261025_2_catalogue_connexion_generique.sql
-- Tranche 2 du catalogue fournisseur (spec 2026-10-24-catalogue-photovoltaique-connexion-generique § 3, § 5) :
--   1. suppliers : connector devient la PLATEFORME (suitecommerce | woocommerce, backfill baywa/domos), site_url,
--      connector_config (sca_path / site_id), category_mapping (catégorie du site → batterie | photovoltaique |
--      borne_recharge | exclure), auto_sync (relevé nocturne), catalog_sync_error (dernière erreur, séparée du
--      dernier relevé réussi). Vues majordhome_suppliers(_write) : colonnes ajoutées EN FIN.
--   2. supplier_products : model_key / model_key_source (clé « modèle fabricant », § 7), index partiel unique
--      (supplier_id, reference) sur les lignes relevées (les 1 576 doublons legacy DINAK / MODINOX restent hors champ).
--   3. supplier_catalog_upsert v3 : 5ᵉ paramètre p_meta (categories_vues) ; category / product_kind / brand / gamme
--      posés à l'INSERT SEULEMENT (une correction du drawer survit au relevé) ; image_url si NULL ; model_key
--      recalculé sauf saisie manuelle ; succès ⇒ catalog_sync_error effacée. L'ancienne signature à 4 paramètres
--      est retirée (appel à 4 arguments toujours valide grâce au défaut).
--   4. supplier_catalog_apply_mapping (org_admin) : applique les SURCHARGES de category_mapping aux articles du
--      fournisseur, bouton explicite, jamais pendant le relevé. get_distinct_brands pour le filtre Marque.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Fournisseurs
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.suppliers DROP CONSTRAINT IF EXISTS suppliers_connector_check;
UPDATE majordhome.suppliers SET connector = 'suitecommerce' WHERE connector = 'baywa';
UPDATE majordhome.suppliers SET connector = 'woocommerce' WHERE connector = 'domos';
ALTER TABLE majordhome.suppliers
  ADD CONSTRAINT suppliers_connector_check CHECK (connector IS NULL OR connector IN ('suitecommerce', 'woocommerce'));

ALTER TABLE majordhome.suppliers
  ADD COLUMN IF NOT EXISTS site_url text,
  ADD COLUMN IF NOT EXISTS connector_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS category_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_sync boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_sync_error jsonb;

COMMENT ON COLUMN majordhome.suppliers.connector IS 'Plateforme de la boutique : suitecommerce (NetSuite, compatible BayWa) | woocommerce | NULL (import Excel / relevé JSON seulement)';
COMMENT ON COLUMN majordhome.suppliers.connector_config IS 'Réglages de plateforme : SuiteCommerce { sca_path, site_id } ; WooCommerce {}';
COMMENT ON COLUMN majordhome.suppliers.category_mapping IS '{ "<clé de catégorie du site>": "batterie" | "photovoltaique" | "borne_recharge" | "exclure" } — surcharge des défauts de la plateforme';
COMMENT ON COLUMN majordhome.suppliers.auto_sync IS 'Relevé nocturne par le cron supplier-catalog-sync (jamais pour un site derrière Cloudflare)';
COMMENT ON COLUMN majordhome.suppliers.catalog_sync_error IS 'Dernière erreur de relevé { ok:false, code, detail, at } — séparée du dernier relevé réussi (catalog_sync_result)';

-- Backfill des deux fournisseurs connectés en tranche 1 (sync serveur BayWa réussi le 2026-10-24 ⇒ auto_sync).
UPDATE majordhome.suppliers
SET site_url = COALESCE(site_url, 'https://solarshop.baywa-re.fr'),
    connector_config = CASE WHEN connector_config = '{}'::jsonb THEN '{"sca_path": "/sca-lux-2019-2", "site_id": "6376560"}'::jsonb ELSE connector_config END,
    auto_sync = true
WHERE connector = 'suitecommerce' AND name = 'BAYWA R.E.';
UPDATE majordhome.suppliers
SET site_url = COALESCE(site_url, 'https://webshop.domosindustries.com')
WHERE connector = 'woocommerce' AND name = 'DOMOS INDUSTRIES';

CREATE OR REPLACE VIEW public.majordhome_suppliers WITH (security_invoker = true) AS
  SELECT id, org_id, name, contact_name, contact_email, contact_phone, address, postal_code, city, siret,
         pennylane_supplier_id, notes, is_active, created_at, updated_at,
         connector, catalog_sync_at, catalog_sync_result,
         site_url, connector_config, category_mapping, auto_sync, catalog_sync_error
  FROM majordhome.suppliers;

CREATE OR REPLACE VIEW public.majordhome_suppliers_write WITH (security_invoker = true) AS
  SELECT id, org_id, name, contact_name, contact_email, contact_phone, address, postal_code, city, siret,
         pennylane_supplier_id, notes, is_active, created_at, updated_at,
         connector, catalog_sync_at, catalog_sync_result,
         site_url, connector_config, category_mapping, auto_sync, catalog_sync_error
  FROM majordhome.suppliers;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Produits : clé modèle, index
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.supplier_products
  ADD COLUMN IF NOT EXISTS model_key text,
  ADD COLUMN IF NOT EXISTS model_key_source text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_products_model_key_source_check') THEN
    ALTER TABLE majordhome.supplier_products
      ADD CONSTRAINT supplier_products_model_key_source_check CHECK (model_key_source IS NULL OR model_key_source IN ('cle', 'ia', 'manuel'));
  END IF;
END $$;
COMMENT ON COLUMN majordhome.supplier_products.model_key IS 'Modèle fabricant normalisé (majuscules, sans séparateurs) : clé commune entre fournisseurs';
COMMENT ON COLUMN majordhome.supplier_products.model_key_source IS 'cle (dérivée du relevé) | ia (catalog-normalize) | manuel (drawer, jamais recalculée)';

CREATE INDEX IF NOT EXISTS supplier_products_model_key_idx
  ON majordhome.supplier_products (org_id, lower(brand), model_key) WHERE model_key IS NOT NULL;
-- Lignes relevées (specs.source_version) : jamais deux fois la même référence pour un fournisseur
-- (un « Actualiser » cliqué pendant le cron ne peut plus doubler une insertion).
CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_releve_reference_uniq
  ON majordhome.supplier_products (supplier_id, reference) WHERE reference IS NOT NULL AND specs ? 'source_version';

CREATE OR REPLACE VIEW public.majordhome_supplier_products WITH (security_invoker = true) AS
  SELECT p.id, p.supplier_id, p.org_id, p.reference, p.name, p.description, p.category, p.purchase_price_ht,
         p.selling_price_ht, p.default_tva_rate, p.unit, p.pennylane_product_id, p.is_active, p.created_at, p.updated_at,
         p.code_famille, p.gamme, p.code_ean, p.tarif_public, p.taux_remise, p.diametre, p.ledger_account_pl_id,
         p.ledger_account_pl_number, p.fuel_type, p.brand, p.variant_of, p.variant_label, p.image_url, p.image_source_url,
         p.specs, p.client_visible, p.product_kind, p.compatible_with_ids, s.name AS supplier_name,
         p.model_key, p.model_key_source
  FROM majordhome.supplier_products p
  LEFT JOIN majordhome.suppliers s ON s.id = p.supplier_id;

CREATE OR REPLACE VIEW public.majordhome_supplier_products_write WITH (security_invoker = true) AS
  SELECT id, supplier_id, org_id, reference, name, description, category, purchase_price_ht, selling_price_ht,
         default_tva_rate, unit, pennylane_product_id, is_active, created_at, updated_at, code_famille, gamme, code_ean,
         tarif_public, taux_remise, diametre, ledger_account_pl_id, ledger_account_pl_number, fuel_type, brand, variant_of,
         variant_label, image_url, image_source_url, specs, client_visible, product_kind, compatible_with_ids,
         model_key, model_key_source
  FROM majordhome.supplier_products;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Écrivain unique v3
-- ---------------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.supplier_catalog_upsert(uuid, uuid, text, jsonb);

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
                              'ignores_inactifs', v_ign, 'total', v_total,
                              'categories_vues', COALESCE(p_meta -> 'categories_vues', '[]'::jsonb));
  UPDATE majordhome.suppliers SET catalog_sync_at = now(), catalog_sync_result = v_res, catalog_sync_error = NULL, updated_at = now()
  WHERE id = p_supplier_id AND org_id = p_org_id;
  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) TO service_role;
COMMENT ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb) IS
  'Écrivain unique du catalogue fournisseur depuis un relevé (service_role). name / selling_price_ht / category / product_kind / brand / gamme à l''INSERT seulement ; photo si absente ; clé modèle sauf manuelle ; absents désactivés (marqués) ; suppression manuelle respectée.';

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Correspondance des catégories (bouton explicite) et marques distinctes
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supplier_catalog_apply_mapping(p_supplier_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_org uuid;
  v_role text;
  v_mapping jsonb;
  v_reclasses int := 0;
  v_exclus int := 0;
  v_reactives int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT org_id, category_mapping INTO v_org, v_mapping FROM majordhome.suppliers WHERE id = p_supplier_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'supplier_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT role INTO v_role FROM core.organization_members WHERE user_id = auth.uid() AND org_id = v_org;
  IF (v_role = 'org_admin') IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;

  -- Cible d'un article = la plus prioritaire (exclure > batterie > borne_recharge > photovoltaique) parmi les
  -- SURCHARGES qui couvrent l'une de ses catégories du site ((sans categorie) si aucune). Article non couvert : inchangé.
  IF to_regclass('pg_temp.t_cibles') IS NOT NULL THEN DROP TABLE pg_temp.t_cibles; END IF;
  CREATE TEMP TABLE t_cibles ON COMMIT DROP AS
    SELECT p.id,
           (SELECT c FROM unnest(ARRAY['exclure', 'batterie', 'borne_recharge', 'photovoltaique']) AS c
             WHERE c IN (SELECT v_mapping ->> k FROM (
                           SELECT CASE WHEN jsonb_array_length(COALESCE(p.specs -> 'canonical' -> 'categories_site', '[]'::jsonb)) = 0
                                       THEN ARRAY['(sans categorie)']
                                       ELSE ARRAY(SELECT jsonb_array_elements_text(p.specs -> 'canonical' -> 'categories_site')) END AS cles
                         ) x, unnest(x.cles) AS k)
             ORDER BY array_position(ARRAY['exclure', 'batterie', 'borne_recharge', 'photovoltaique'], c) LIMIT 1) AS cible
    FROM majordhome.supplier_products p
    WHERE p.supplier_id = p_supplier_id AND p.org_id = v_org AND p.specs ? 'source_version';

  UPDATE majordhome.supplier_products p
  SET is_active = false, specs = COALESCE(p.specs, '{}'::jsonb) || '{"desactive_par_mapping": true}'::jsonb, updated_at = now()
  FROM t_cibles t WHERE t.id = p.id AND t.cible = 'exclure' AND p.is_active;
  GET DIAGNOSTICS v_exclus = ROW_COUNT;

  UPDATE majordhome.supplier_products p
  SET is_active = true, specs = p.specs - 'desactive_par_mapping', updated_at = now()
  FROM t_cibles t WHERE t.id = p.id AND t.cible IS DISTINCT FROM 'exclure' AND NOT p.is_active
    AND (p.specs ->> 'desactive_par_mapping')::boolean IS TRUE;
  GET DIAGNOSTICS v_reactives = ROW_COUNT;

  UPDATE majordhome.supplier_products p
  SET category = t.cible, updated_at = now()
  FROM t_cibles t WHERE t.id = p.id AND t.cible IS NOT NULL AND t.cible <> 'exclure' AND p.category IS DISTINCT FROM t.cible;
  GET DIAGNOSTICS v_reclasses = ROW_COUNT;

  RETURN jsonb_build_object('reclasses', v_reclasses, 'exclus', v_exclus, 'reactives', v_reactives);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.supplier_catalog_apply_mapping(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_apply_mapping(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_distinct_brands(p_supplier_id uuid)
RETURNS TABLE(brand text)
LANGUAGE sql STABLE
SET search_path TO 'public', 'majordhome', 'core', 'pg_temp'
AS $$
  SELECT DISTINCT sp.brand FROM majordhome.supplier_products sp
  WHERE sp.supplier_id = p_supplier_id AND sp.is_active = true AND sp.brand IS NOT NULL AND sp.brand <> ''
  ORDER BY sp.brand;
$$;
REVOKE EXECUTE ON FUNCTION public.get_distinct_brands(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_distinct_brands(uuid) TO authenticated, service_role;
