-- =============================================================================
-- Migration: Module Prospection (Cedants + Commercial)
-- A executer dans Supabase SQL Editor
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLE majordhome.prospects
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE majordhome.prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identite SIRENE (snapshot au moment du favori)
  siren TEXT NOT NULL,
  siret_siege TEXT,
  raison_sociale TEXT NOT NULL,
  naf TEXT,
  naf_libelle TEXT,
  departement TEXT,
  commune TEXT,
  adresse TEXT,
  code_postal TEXT,
  forme_juridique TEXT,
  date_creation TEXT,
  tranche_effectif_salarie TEXT,
  dirigeant_nom TEXT,
  dirigeant_prenoms TEXT,
  dirigeant_annee_naissance INTEGER,
  dirigeant_qualite TEXT,
  ca_annuel BIGINT,
  resultat_net BIGINT,
  annee_bilan INTEGER,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  -- Pipeline
  module TEXT NOT NULL CHECK (module IN ('cedants', 'commercial')),
  statut TEXT NOT NULL DEFAULT 'nouveau',
  priorite TEXT CHECK (priorite IS NULL OR priorite IN ('A', 'B')),
  score INTEGER DEFAULT 0,

  -- Cedants only (null pour commercial)
  valorisation_estimee BIGINT,
  contacts_conseils JSONB DEFAULT '[]'::jsonb,
  documents JSONB DEFAULT '[]'::jsonb,

  -- Commercial enrichissement
  contact_telephone TEXT,
  contact_email TEXT,
  notes TEXT,

  -- Lien post-conversion (commercial → client)
  converted_client_id UUID,

  -- Multi-tenant
  org_id UUID NOT NULL REFERENCES core.organizations(id),
  created_by UUID REFERENCES auth.users(id),
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Deduplication silencieuse
  UNIQUE(org_id, module, siren)
);

-- Index
CREATE INDEX idx_prospects_org_module ON majordhome.prospects(org_id, module);
CREATE INDEX idx_prospects_statut ON majordhome.prospects(org_id, module, statut);
CREATE INDEX idx_prospects_siren ON majordhome.prospects(siren);
CREATE INDEX idx_prospects_departement ON majordhome.prospects(departement);
CREATE INDEX idx_prospects_score ON majordhome.prospects(score DESC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION majordhome.prospects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prospects_updated_at
  BEFORE UPDATE ON majordhome.prospects
  FOR EACH ROW EXECUTE FUNCTION majordhome.prospects_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABLE majordhome.prospect_interactions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE majordhome.prospect_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES majordhome.prospects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'status_changed', 'note', 'phone_call', 'email_sent',
    'document_added', 'score_updated', 'contact_added', 'converted'
  )),
  contenu TEXT,
  ancien_statut TEXT,
  nouveau_statut TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prospect_interactions_prospect ON majordhome.prospect_interactions(prospect_id);
CREATE INDEX idx_prospect_interactions_created ON majordhome.prospect_interactions(prospect_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VUES PUBLIQUES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.majordhome_prospects AS
SELECT
  p.*,
  cb.full_name AS created_by_name,
  at2.full_name AS assigned_to_name
FROM majordhome.prospects p
LEFT JOIN public.profiles cb ON cb.id = p.created_by
LEFT JOIN public.profiles at2 ON at2.id = p.assigned_to;

CREATE OR REPLACE VIEW public.majordhome_prospect_interactions AS
SELECT
  pi.*,
  prof.full_name AS created_by_name
FROM majordhome.prospect_interactions pi
LEFT JOIN public.profiles prof ON prof.id = pi.created_by;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE majordhome.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.prospect_interactions ENABLE ROW LEVEL SECURITY;

-- Prospects: membres de l'org peuvent lire
CREATE POLICY prospects_select ON majordhome.prospects FOR SELECT
  USING (org_id IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  ));

-- Prospects: membres de l'org peuvent inserer
CREATE POLICY prospects_insert ON majordhome.prospects FOR INSERT
  WITH CHECK (org_id IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  ));

-- Prospects: membres de l'org peuvent modifier
CREATE POLICY prospects_update ON majordhome.prospects FOR UPDATE
  USING (org_id IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  ));

-- Prospects: membres de l'org peuvent supprimer
CREATE POLICY prospects_delete ON majordhome.prospects FOR DELETE
  USING (org_id IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  ));

-- Interactions: acces via prospect.org_id
CREATE POLICY interactions_select ON majordhome.prospect_interactions FOR SELECT
  USING (prospect_id IN (
    SELECT id FROM majordhome.prospects WHERE org_id IN (
      SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
    )
  ));

CREATE POLICY interactions_insert ON majordhome.prospect_interactions FOR INSERT
  WITH CHECK (prospect_id IN (
    SELECT id FROM majordhome.prospects WHERE org_id IN (
      SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
    )
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SEED PERMISSIONS — Mayer Energie
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO majordhome.role_permissions (org_id, role, resource, action, allowed) VALUES
  -- Cedants: org_admin only (bypass auto), tous les autres = false
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'team_leader', 'cedants', 'view', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'team_leader', 'cedants', 'create', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'team_leader', 'cedants', 'edit', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'team_leader', 'cedants', 'delete', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'commercial', 'cedants', 'view', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'commercial', 'cedants', 'create', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'commercial', 'cedants', 'edit', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'commercial', 'cedants', 'delete', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'technicien', 'cedants', 'view', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'technicien', 'cedants', 'create', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'technicien', 'cedants', 'edit', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'technicien', 'cedants', 'delete', false),

  -- Prospection commerciale: team_leader + commercial = view/create/edit
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'team_leader', 'prospection_commerciale', 'view', true),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'team_leader', 'prospection_commerciale', 'create', true),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'team_leader', 'prospection_commerciale', 'edit', true),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'team_leader', 'prospection_commerciale', 'delete', true),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'commercial', 'prospection_commerciale', 'view', true),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'commercial', 'prospection_commerciale', 'create', true),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'commercial', 'prospection_commerciale', 'edit', true),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'commercial', 'prospection_commerciale', 'edit_own', true),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'commercial', 'prospection_commerciale', 'delete', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'technicien', 'prospection_commerciale', 'view', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'technicien', 'prospection_commerciale', 'create', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'technicien', 'prospection_commerciale', 'edit', false),
  ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 'technicien', 'prospection_commerciale', 'delete', false)
ON CONFLICT (org_id, role, resource, action) DO NOTHING;
