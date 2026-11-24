-- 20261124_1_fournisseur_compte_client_acces.sql
-- ============================================================================
-- Fiche fournisseur (demande d'Eric, 2026-11-24) :
--   1. « Compte client » = le numéro de NOTRE entreprise chez ce fournisseur (servira aux bons de commande).
--      Donnée ordinaire, pas un secret : colonne de majordhome.suppliers, exposée en FIN de liste par les deux
--      miroirs updatables (majordhome_suppliers, majordhome_suppliers_write ; CREATE OR REPLACE VIEW garde l'ACL).
--   2. Recueil des accès au compte fournisseur : identifiant et mot de passe restent dans le Vault
--      (org:<org>:supplier:<id>:credentials, écrits par org_secret_set, org_admin). Jusqu'ici ils n'étaient JAMAIS
--      relisibles depuis l'écran. supplier_credentials_reveal les rend à un org_admin ACTIF de l'organisation, pour
--      ce seul fournisseur de cette organisation — jamais une autre clé du Vault (pas de lecture générique de secret).
-- ============================================================================

ALTER TABLE majordhome.suppliers ADD COLUMN IF NOT EXISTS customer_account text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_customer_account_len') THEN
    ALTER TABLE majordhome.suppliers ADD CONSTRAINT suppliers_customer_account_len CHECK (customer_account IS NULL OR length(customer_account) <= 60);
  END IF;
END $$;
COMMENT ON COLUMN majordhome.suppliers.customer_account IS 'Numéro de compte client de l''entreprise chez ce fournisseur (bons de commande).';

CREATE OR REPLACE VIEW public.majordhome_suppliers WITH (security_invoker = true) AS
 SELECT id, org_id, name, contact_name, contact_email, contact_phone, address, postal_code, city, siret,
    pennylane_supplier_id, notes, is_active, created_at, updated_at, connector, catalog_sync_at, catalog_sync_result,
    site_url, connector_config, category_mapping, auto_sync, catalog_sync_error, customer_account
   FROM majordhome.suppliers;

CREATE OR REPLACE VIEW public.majordhome_suppliers_write WITH (security_invoker = true) AS
 SELECT id, org_id, name, contact_name, contact_email, contact_phone, address, postal_code, city, siret,
    pennylane_supplier_id, notes, is_active, created_at, updated_at, connector, catalog_sync_at, catalog_sync_result,
    site_url, connector_config, category_mapping, auto_sync, catalog_sync_error, customer_account
   FROM majordhome.suppliers;

REVOKE ALL ON public.majordhome_suppliers FROM anon;
REVOKE ALL ON public.majordhome_suppliers_write FROM anon;

CREATE OR REPLACE FUNCTION public.supplier_credentials_reveal(p_org_id uuid, p_supplier_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, majordhome, vault, public
AS $$
DECLARE
  v_admin boolean;
  v_valeur text;
  v_json jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM core.organization_members
     WHERE user_id = auth.uid() AND org_id = p_org_id AND role = 'org_admin' AND status = 'active'
  ) INTO v_admin;
  IF v_admin IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.suppliers WHERE id = p_supplier_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'supplier_not_in_org' USING ERRCODE = '42501';
  END IF;
  SELECT decrypted_secret INTO v_valeur FROM vault.decrypted_secrets
   WHERE name = 'org:' || p_org_id::text || ':supplier:' || p_supplier_id::text || ':credentials' LIMIT 1;
  IF v_valeur IS NULL THEN RETURN NULL; END IF;
  BEGIN v_json := v_valeur::jsonb; EXCEPTION WHEN others THEN RETURN NULL; END;
  RETURN jsonb_build_object('identifiant', v_json->>'email', 'mot_de_passe', v_json->>'password');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.supplier_credentials_reveal(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_credentials_reveal(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.supplier_credentials_reveal IS 'Identifiant et mot de passe du compte fournisseur (Vault) — org_admin actif de l''organisation, ce fournisseur seulement.';
