-- 20261024_2_catalogue_connexion_fournisseur.sql
-- Connexion fournisseur (catalogue relevé chez BayWa r.e. / Domos) :
--   1. majordhome.suppliers : connector (baywa | domos), catalog_sync_at, catalog_sync_result — exposés EN FIN
--      des vues majordhome_suppliers / majordhome_suppliers_write (miroirs updatable, security_invoker).
--   2. public.supplier_catalog_upsert(p_org_id, p_supplier_id, p_source_version, p_rows) — UNIQUE écrivain du
--      catalogue depuis un relevé (script Node ou edge supplier-catalog-sync). service_role seul (org_id dans le
--      payload). Règles : libellé et prix de vente posés à l'INSERT seulement (une correction du drawer survit au
--      ré-import) ; prix de vente par défaut ré-appliqué si l'article est encore à 0 ; specs fusionnées (niveau 1
--      ET `canonical`) ; article absent du relevé ⇒ is_active=false, jamais supprimé ; relevé vide refusé.
--   3. Secrets par org dans le Vault : org_secret_set / org_secret_delete (org_admin), org_secret_status (membre,
--      jamais la valeur), org_secret_read (service_role seul). Nom Vault = 'org:<org_id>:<key>'.
-- Spec : docs/superpowers/specs/2026-10-24-module-batterie-catalogue-baywa-design.md (§ 5, § 7).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Colonnes de connexion + vues
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE majordhome.suppliers
  ADD COLUMN IF NOT EXISTS connector text,
  ADD COLUMN IF NOT EXISTS catalog_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS catalog_sync_result jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_connector_check') THEN
    ALTER TABLE majordhome.suppliers
      ADD CONSTRAINT suppliers_connector_check CHECK (connector IS NULL OR connector IN ('baywa', 'domos'));
  END IF;
END $$;

COMMENT ON COLUMN majordhome.suppliers.connector IS 'Connexion catalogue : baywa (automatique, identifiants Vault) | domos (relevé manuel) | NULL';
COMMENT ON COLUMN majordhome.suppliers.catalog_sync_result IS 'Résultat du dernier relevé : { ok, at, version, inseres, mis_a_jour, desactives, total } ou { ok:false, code, at }';

CREATE OR REPLACE VIEW public.majordhome_suppliers WITH (security_invoker = true) AS
  SELECT id, org_id, name, contact_name, contact_email, contact_phone, address, postal_code, city, siret,
         pennylane_supplier_id, notes, is_active, created_at, updated_at,
         connector, catalog_sync_at, catalog_sync_result
  FROM majordhome.suppliers;

CREATE OR REPLACE VIEW public.majordhome_suppliers_write WITH (security_invoker = true) AS
  SELECT id, org_id, name, contact_name, contact_email, contact_phone, address, postal_code, city, siret,
         pennylane_supplier_id, notes, is_active, created_at, updated_at,
         connector, catalog_sync_at, catalog_sync_result
  FROM majordhome.suppliers;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Écrivain unique du catalogue depuis un relevé
-- ---------------------------------------------------------------------------------------------------------------
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

  -- Rejouable dans une même transaction (tests) : la table temporaire d'un appel précédent est retirée sans NOTICE.
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

  -- Mise à jour : prix d'achat, marque, gamme, nature, specs (fusion niveau 1 + canonical). JAMAIS name ;
  -- selling_price_ht seulement s'il est encore à 0 et que le relevé propose un défaut.
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
    specs = COALESCE(p.specs, '{}'::jsonb) || t.specs
            || jsonb_build_object('canonical', COALESCE(p.specs -> 'canonical', '{}'::jsonb) || COALESCE(t.specs -> 'canonical', '{}'::jsonb)),
    is_active = true,
    updated_at = now()
  FROM t_imp t
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.reference = t.reference;
  GET DIAGNOSTICS v_upd = ROW_COUNT;

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

  -- Absent du relevé = plus au tarif : désactivé, jamais supprimé.
  UPDATE majordhome.supplier_products p SET is_active = false, updated_at = now()
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active
    AND NOT EXISTS (SELECT 1 FROM t_imp t WHERE t.reference = p.reference);
  GET DIAGNOSTICS v_des = ROW_COUNT;

  SELECT count(*) INTO v_total FROM majordhome.supplier_products p
  WHERE p.supplier_id = p_supplier_id AND p.org_id = p_org_id AND p.is_active;

  v_res := jsonb_build_object('ok', true, 'at', now(), 'version', p_source_version,
                              'inseres', v_ins, 'mis_a_jour', v_upd, 'desactives', v_des, 'total', v_total);
  UPDATE majordhome.suppliers SET catalog_sync_at = now(), catalog_sync_result = v_res, updated_at = now()
  WHERE id = p_supplier_id AND org_id = p_org_id;
  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_catalog_upsert(uuid, uuid, text, jsonb) TO service_role;
COMMENT ON FUNCTION public.supplier_catalog_upsert IS
  'Écrivain unique du catalogue fournisseur depuis un relevé (service_role). name/selling_price_ht à l''INSERT seulement ; absents désactivés.';

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Secrets par org (Vault)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_secret_set(p_org_id uuid, p_key text, p_value text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, vault, public
AS $$
DECLARE
  v_role text;
  v_name text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM core.organization_members WHERE user_id = auth.uid() AND org_id = p_org_id;
  IF (v_role = 'org_admin') IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z0-9_:.-]{1,120}$' THEN RAISE EXCEPTION 'invalid_key' USING ERRCODE = '22023'; END IF;
  IF p_value IS NULL OR length(p_value) = 0 OR length(p_value) > 8192 THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023'; END IF;
  v_name := 'org:' || p_org_id::text || ':' || p_key;
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, v_name, 'Majord''home — secret d''org');
  ELSE
    PERFORM vault.update_secret(v_id, p_value);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.org_secret_set(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_secret_set(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.org_secret_delete(p_org_id uuid, p_key text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, vault, public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM core.organization_members WHERE user_id = auth.uid() AND org_id = p_org_id;
  IF (v_role = 'org_admin') IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;
  DELETE FROM vault.secrets WHERE name = 'org:' || p_org_id::text || ':' || p_key;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.org_secret_delete(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_secret_delete(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.org_secret_status(p_org_id uuid, p_key text) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, vault, public
AS $$
DECLARE
  v_updated timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM core.organization_members WHERE user_id = auth.uid() AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = '42501';
  END IF;
  SELECT updated_at INTO v_updated FROM vault.secrets WHERE name = 'org:' || p_org_id::text || ':' || p_key;
  RETURN jsonb_build_object('exists', v_updated IS NOT NULL, 'updated_at', v_updated);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.org_secret_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_secret_status(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.org_secret_read(p_org_id uuid, p_key text) RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'org:' || p_org_id::text || ':' || p_key LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.org_secret_read(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_secret_read(uuid, text) TO service_role;
COMMENT ON FUNCTION public.org_secret_read IS 'Lecture d''un secret d''org (Vault) — service_role seul (edge functions).';
