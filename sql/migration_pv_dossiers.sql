-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Dossier PV (tranche 1, plan 1/4) — table majordhome.pv_dossiers + vue publique + RPC forward-only.
-- Pattern : miroir de majordhome.pv_simulations / thermal_studies (RLS owner-or-admin, vue
-- security_invoker auto-updatable, GRANT service_role — charte multi-tenant CLAUDE.md).
-- Le status n'est muté QUE par public.pv_dossier_advance (forward-only) ; trigger backstop DB.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── Migration 1 : pv_dossiers_create ───────────────────────────────────────────────────────────
CREATE TABLE majordhome.pv_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),

  pv_simulation_id uuid UNIQUE REFERENCES majordhome.pv_simulations(id) ON DELETE SET NULL,
  lead_id          uuid REFERENCES majordhome.leads(id)                 ON DELETE SET NULL,
  client_id        uuid REFERENCES majordhome.clients(id)              ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'offre',

  cadastre      jsonb,   -- { commune_insee, parcelles:[{section,numero,superficie_m2}], geojson }
  roof_geometry jsonb,   -- { source, imagery_quality, segments, pitch_deg, azimuth_google_deg, aspect_pvgis, area_m2, flux_image_path }
  abf           jsonb,   -- { secteur_protege, source, checked_at }
  material      jsonb,   -- { module_marque, module_modele, module_aspect }
  declarant     jsonb,   -- { civilite, date_naissance, naissance_commune, naissance_departement }
  documents     jsonb,   -- { cerfa_pdf_path, notice_pdf_path, generated_at }

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- pv_simulation_id est UNIQUE (idempotence de la création lazy = 1 simulation → au plus 1 dossier).
CREATE INDEX idx_pv_dossiers_org_created ON majordhome.pv_dossiers(org_id, created_at DESC);
CREATE INDEX idx_pv_dossiers_lead   ON majordhome.pv_dossiers(lead_id)   WHERE lead_id   IS NOT NULL;
CREATE INDEX idx_pv_dossiers_client ON majordhome.pv_dossiers(client_id) WHERE client_id IS NOT NULL;

ALTER TABLE majordhome.pv_dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY pv_dossiers_select ON majordhome.pv_dossiers
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = pv_dossiers.org_id AND m.role = 'org_admin'))
  );

CREATE POLICY pv_dossiers_insert ON majordhome.pv_dossiers
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY pv_dossiers_update ON majordhome.pv_dossiers
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = pv_dossiers.org_id AND m.role = 'org_admin'))
  );

CREATE POLICY pv_dossiers_delete ON majordhome.pv_dossiers
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = pv_dossiers.org_id AND m.role = 'org_admin'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.pv_dossiers TO authenticated;
GRANT SELECT ON majordhome.pv_dossiers TO service_role;   -- charte (vue security_invoker)

-- ── Migration 2 : pv_dossiers_forward_only_trigger ─────────────────────────────────────────────
-- Backstop DB : la vue publique est updatable (front écrit les blocs jsonb), mais un UPDATE direct
-- ne doit JAMAIS faire régresser status. La RPC reste l'unique writer canonique de status.
CREATE OR REPLACE FUNCTION majordhome.pv_dossiers_forward_only_status()
  RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_arr constant text[] := ARRAY[
    'offre','dossier_valide','urbanisme_depose','urbanisme_valide',
    'raccordement_enedis','consuel_demande','projet_en_service'];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF array_position(order_arr, NEW.status) IS NULL THEN
      RAISE EXCEPTION 'invalid_status: %', NEW.status;
    END IF;
    IF array_position(order_arr, NEW.status) < array_position(order_arr, OLD.status) THEN
      RAISE EXCEPTION 'status_forward_only: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pv_dossiers_forward_only
  BEFORE UPDATE ON majordhome.pv_dossiers
  FOR EACH ROW EXECUTE FUNCTION majordhome.pv_dossiers_forward_only_status();

-- ── Migration 3 : pv_dossiers_public_view ──────────────────────────────────────────────────────
-- Miroir simple mono-table, sans JOIN ni colonne calculée → auto-updatable (règle Bloc B).
CREATE VIEW public.majordhome_pv_dossiers
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.pv_dossiers;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_pv_dossiers TO authenticated;
GRANT SELECT ON public.majordhome_pv_dossiers TO service_role;

-- ── Migration 4 : pv_dossier_advance_rpc ───────────────────────────────────────────────────────
-- Unique writer canonique de status, forward-only, membership-checked. SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.pv_dossier_advance(p_dossier_id uuid, p_target_status text)
  RETURNS majordhome.pv_dossiers
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = majordhome, public
AS $$
DECLARE
  v_dossier majordhome.pv_dossiers;
  order_arr constant text[] := ARRAY[
    'offre','dossier_valide','urbanisme_depose','urbanisme_valide',
    'raccordement_enedis','consuel_demande','projet_en_service'];
  v_cur int;
  v_tgt int;
BEGIN
  SELECT * INTO v_dossier FROM majordhome.pv_dossiers WHERE id = p_dossier_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'dossier_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.org_id = v_dossier.org_id
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_tgt := array_position(order_arr, p_target_status);
  IF v_tgt IS NULL THEN RAISE EXCEPTION 'invalid_status: %', p_target_status; END IF;
  v_cur := array_position(order_arr, v_dossier.status);

  IF v_tgt <= v_cur THEN
    RETURN v_dossier;   -- idempotent : ne redescend jamais, ne fait rien si déjà >= cible
  END IF;

  UPDATE majordhome.pv_dossiers
    SET status = p_target_status, updated_at = now()
    WHERE id = p_dossier_id
    RETURNING * INTO v_dossier;
  RETURN v_dossier;
END;
$$;

REVOKE ALL ON FUNCTION public.pv_dossier_advance(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pv_dossier_advance(uuid, text) TO authenticated;
