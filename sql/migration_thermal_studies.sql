-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Module Thermique (plan 4, Task 7) — table majordhome.thermal_studies + vue publique + permission.
-- Appliquées via MCP Supabase le 2026-07-05 (migrations : thermal_studies_create,
-- thermal_studies_public_view, thermal_study_permission_seed). Copie versionnée de référence.
-- Pattern : miroir exact de majordhome.pv_simulations (RLS owner-or-admin, vue security_invoker
-- auto-updatable, GRANT service_role — charte multi-tenant CLAUDE.md).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── Migration 1 : thermal_studies_create ──────────────────────────────────────────────────────
CREATE TABLE majordhome.thermal_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  client_id uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES majordhome.leads(id) ON DELETE SET NULL,
  title text,
  input jsonb NOT NULL,                -- saisie complète (contexte, dessin, compositions, pac)
  results jsonb,                       -- sorties persistées (bilan, θe, volet PAC)
  engine_version text NOT NULL,        -- rejouabilité : une étude ancienne affiche ses résultats persistés
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_thermal_studies_org_created ON majordhome.thermal_studies(org_id, created_at DESC);
CREATE INDEX idx_thermal_studies_client ON majordhome.thermal_studies(client_id) WHERE client_id IS NOT NULL;

ALTER TABLE majordhome.thermal_studies ENABLE ROW LEVEL SECURITY;

-- Pattern pv_simulations à l'identique : SELECT/UPDATE/DELETE = membre org ET (owner OU org_admin) ;
-- INSERT = membre org, owner forcé.
CREATE POLICY thermal_studies_select ON majordhome.thermal_studies
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = thermal_studies.org_id AND m.role = 'org_admin'))
  );

CREATE POLICY thermal_studies_insert ON majordhome.thermal_studies
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY thermal_studies_update ON majordhome.thermal_studies
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = thermal_studies.org_id AND m.role = 'org_admin'))
  );

CREATE POLICY thermal_studies_delete ON majordhome.thermal_studies
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = thermal_studies.org_id AND m.role = 'org_admin'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.thermal_studies TO authenticated;
-- Charte multi-tenant (régression 2026-05-27) : GRANT service_role obligatoire (vue security_invoker)
GRANT SELECT ON majordhome.thermal_studies TO service_role;

-- ── Migration 2 : thermal_studies_public_view ─────────────────────────────────────────────────
-- Miroir simple mono-table, sans JOIN ni colonne calculée → auto-updatable (règle Bloc B)
CREATE VIEW public.majordhome_thermal_studies
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.thermal_studies;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_thermal_studies TO authenticated;
GRANT SELECT ON public.majordhome_thermal_studies TO service_role;

-- ── Migration 3 : thermal_study_permission_seed ───────────────────────────────────────────────
-- R8 : copie du set org × rôle de pv_calculator (mêmes allowed : commercial/team_leader ✅, technicien ❌)
-- Pré-contrôle exécuté : 0 ligne thermal_study existante ; 6 lignes modèle pv_calculator (2 orgs × 3 rôles).
INSERT INTO majordhome.role_permissions (org_id, role, resource, action, allowed)
SELECT org_id, role, 'thermal_study', 'view', allowed
FROM majordhome.role_permissions
WHERE resource = 'pv_calculator' AND action = 'view';

-- ── Vérifications (exécutées le 2026-07-05, toutes OK) ────────────────────────────────────────
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.thermal_studies'::regclass;          → true
-- SELECT count(*) FROM pg_policies WHERE schemaname='majordhome' AND tablename='thermal_studies';  → 4
-- SELECT has_table_privilege('service_role', 'majordhome.thermal_studies', 'SELECT');              → true
-- SELECT is_insertable_into FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='majordhome_thermal_studies';                       → YES
-- SELECT count(*) FILTER (WHERE allowed), count(*) FROM majordhome.role_permissions
--   WHERE resource='thermal_study';                                                                → 4, 6
