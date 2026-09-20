-- ============================================================================
-- 20260920_2 — Module Prospection : tables + vues publiques, jamais provisionnées
-- ============================================================================
--
-- Constat (2026-09-20) : le module Prospection (Cédants + Commercial, écrans
-- /cedants et /prospection, screener SIRENE « Ajouter au pipeline ») n'a JAMAIS
-- eu de base derrière lui. `sql/migration_prospects.sql` (mars 2026, « à
-- exécuter dans le SQL Editor ») n'a été jouée ni sur l'ancien projet partagé
-- ni sur le projet prod : ni majordhome.prospects, ni prospect_interactions,
-- ni les vues, ni les lignes role_permissions cedants / prospection_commerciale.
-- Toute lecture du module répond PGRST205 (vue inconnue) et toute écriture
-- échoue — en silence jusqu'au contrat unwrapResult des hooks (2026-09-18).
--
-- Cette migration reprend le schéma d'origine, aligné sur la charte actuelle :
--   - RLS scopée org_id (membre de l'org) TO authenticated, dès la création ;
--   - vues publiques security_invoker = MIROIRS AUTO-UPDATABLE : le front écrit
--     à travers elles (le schéma majordhome n'est pas exposé à PostgREST —
--     pgrst.db_schemas = public, graphql_public, core, sources, config).
--     Les LEFT JOIN profiles de la définition d'origine rendaient la vue
--     non updatable (cf. majordhome_tasks : is_updatable = NO). Seule colonne
--     calculée consommée par l'UI : le nom de l'auteur d'une interaction
--     (ProspectDrawer) → sous-requête scalaire, qui préserve l'updatabilité ;
--   - GRANT SELECT TO service_role (régression 2026-05-27), anon révoqué,
--     privilèges explicites (l'ACL par défaut du schéma donne arwd à anon).
--
-- Pas de seed de permissions : `cedants` / `prospection_commerciale` restent
-- fail-closed pour les non-admins tant qu'un org_admin ne les accorde pas dans
-- Settings → Droits d'accès (ressources déjà listées dans permissions.js).
-- Répétée sur scripts/migration-rehearsal/ (assert-prospection.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. majordhome.prospects — une entreprise mise en favori depuis le screener
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.prospects (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identité SIRENE (photo au moment du favori)
  siren                     text NOT NULL,
  siret_siege               text,
  raison_sociale            text NOT NULL,
  naf                       text,
  naf_libelle               text,
  departement               text,
  commune                   text,
  adresse                   text,
  code_postal               text,
  forme_juridique           text,
  date_creation             text,
  tranche_effectif_salarie  text,
  dirigeant_nom             text,
  dirigeant_prenoms         text,
  dirigeant_annee_naissance integer,
  dirigeant_qualite         text,
  ca_annuel                 bigint,
  resultat_net              bigint,
  annee_bilan               integer,
  latitude                  double precision,
  longitude                 double precision,

  -- Pipeline
  module                    text NOT NULL CHECK (module IN ('cedants', 'commercial')),
  statut                    text NOT NULL DEFAULT 'nouveau',
  priorite                  text CHECK (priorite IS NULL OR priorite IN ('A', 'B')),
  score                     integer DEFAULT 0,

  -- Cédants uniquement (NULL pour commercial)
  valorisation_estimee      bigint,
  contacts_conseils         jsonb DEFAULT '[]'::jsonb,
  documents                 jsonb DEFAULT '[]'::jsonb,

  -- Enrichissement commercial
  contact_telephone         text,
  contact_email             text,
  notes                     text,

  -- Lien post-conversion (commercial → client)
  converted_client_id       uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,

  -- Multi-tenant
  org_id                    uuid NOT NULL REFERENCES core.organizations(id),
  created_by                uuid REFERENCES core.profiles(id) ON DELETE SET NULL,
  assigned_to               uuid REFERENCES core.profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- Dédoublonnage : le screener fait un upsert ON CONFLICT DO NOTHING dessus
  CONSTRAINT prospects_org_module_siren_key UNIQUE (org_id, module, siren)
);

-- La contrainte UNIQUE couvre déjà les balayages (org_id, module) ; on n'ajoute
-- que les tris/filtres de la liste (statut, plus récent d'abord).
CREATE INDEX IF NOT EXISTS idx_prospects_org_module_statut
  ON majordhome.prospects (org_id, module, statut);
CREATE INDEX IF NOT EXISTS idx_prospects_org_module_created
  ON majordhome.prospects (org_id, module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_converted_client
  ON majordhome.prospects (converted_client_id) WHERE converted_client_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_prospects_updated_at ON majordhome.prospects;
CREATE TRIGGER trg_prospects_updated_at
  BEFORE UPDATE ON majordhome.prospects
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

COMMENT ON TABLE majordhome.prospects IS
  'Prospection (Cédants + Commercial) : entreprises SIRENE mises en favori. Écriture front via la vue publique majordhome_prospects (miroir auto-updatable).';

-- ----------------------------------------------------------------------------
-- 2. majordhome.prospect_interactions — timeline d'un prospect
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.prospect_interactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id    uuid NOT NULL REFERENCES majordhome.prospects(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN (
                   'status_changed', 'note', 'phone_call', 'email_sent',
                   'document_added', 'score_updated', 'contact_added', 'converted'
                 )),
  contenu        text,
  ancien_statut  text,
  nouveau_statut text,
  metadata       jsonb DEFAULT '{}'::jsonb,
  created_by     uuid REFERENCES core.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospect_interactions_prospect_created
  ON majordhome.prospect_interactions (prospect_id, created_at DESC);

COMMENT ON TABLE majordhome.prospect_interactions IS
  'Timeline d''un prospect (changement de statut, note, conversion). Insert front via la vue publique majordhome_prospect_interactions.';

-- ----------------------------------------------------------------------------
-- 3. RLS — membre de l'org (posture frontend : auth.uid() obligatoire)
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.prospect_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospects_select ON majordhome.prospects;
CREATE POLICY prospects_select ON majordhome.prospects
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS prospects_insert ON majordhome.prospects;
CREATE POLICY prospects_insert ON majordhome.prospects
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS prospects_update ON majordhome.prospects;
CREATE POLICY prospects_update ON majordhome.prospects
  FOR UPDATE TO authenticated
  USING      (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS prospects_delete ON majordhome.prospects;
CREATE POLICY prospects_delete ON majordhome.prospects
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));

-- Interactions : accès par l'org du prospect. Pas d'UPDATE/DELETE (timeline
-- append-only côté app ; la suppression suit le prospect par cascade).
DROP POLICY IF EXISTS interactions_select ON majordhome.prospect_interactions;
CREATE POLICY interactions_select ON majordhome.prospect_interactions
  FOR SELECT TO authenticated
  USING (prospect_id IN (
    SELECT p.id FROM majordhome.prospects p
    WHERE p.org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid()))
  ));

DROP POLICY IF EXISTS interactions_insert ON majordhome.prospect_interactions;
CREATE POLICY interactions_insert ON majordhome.prospect_interactions
  FOR INSERT TO authenticated
  WITH CHECK (prospect_id IN (
    SELECT p.id FROM majordhome.prospects p
    WHERE p.org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid()))
  ));

-- ----------------------------------------------------------------------------
-- 4. Privilèges tables — explicites (l'ACL par défaut de majordhome donne
--    arwd à anon ET authenticated, et rien à service_role)
-- ----------------------------------------------------------------------------
REVOKE ALL ON majordhome.prospects, majordhome.prospect_interactions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.prospects TO authenticated;
GRANT SELECT, INSERT ON majordhome.prospect_interactions TO authenticated;
GRANT SELECT ON majordhome.prospects, majordhome.prospect_interactions TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Vues publiques — miroirs simples, auto-updatable (règle : miroir simple =
--    updatable, JOIN/agrégat = read-only)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.majordhome_prospects;
CREATE VIEW public.majordhome_prospects
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.prospects;

DROP VIEW IF EXISTS public.majordhome_prospect_interactions;
CREATE VIEW public.majordhome_prospect_interactions
  WITH (security_invoker = true) AS
  SELECT pi.*,
         (SELECT p.full_name FROM public.profiles p WHERE p.id = pi.created_by) AS created_by_name
  FROM majordhome.prospect_interactions pi;

REVOKE ALL ON public.majordhome_prospects, public.majordhome_prospect_interactions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_prospects TO authenticated;
GRANT SELECT, INSERT ON public.majordhome_prospect_interactions TO authenticated;
GRANT SELECT ON public.majordhome_prospects, public.majordhome_prospect_interactions TO service_role;

COMMENT ON VIEW public.majordhome_prospects IS
  'Miroir auto-updatable de majordhome.prospects (security_invoker, RLS membre org). Lecture ET écriture front.';
COMMENT ON VIEW public.majordhome_prospect_interactions IS
  'Miroir de majordhome.prospect_interactions + created_by_name (sous-requête scalaire : reste insérable). Lecture ET insert front.';
