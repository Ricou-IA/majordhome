-- supabase/migrations/20260805_1_lead_quote_revisions.sql
-- ============================================================================
-- Historique des révisions de devis Pennylane.
--
-- Pennylane reste canonical : un devis peut être modifié après rattachement et
-- Majord'home doit suivre. Cette table garde la trace de chaque modification de
-- CONTENU (montant / numéro / date) pour rendre l'évolution traçable, et flague
-- celles survenues après un point de non-retour (lead gagné, devis validé).
--
-- Un snapshot par révision, PAS un journal de deltas champ par champ :
-- « suivre l'évolution » doit être un simple ORDER BY detected_at.
--
-- Un simple changement de quote_status (pending -> accepted) ne crée PAS de
-- révision : c'est du cycle de vie, déjà visible par le déplacement de la carte.
--
-- Spec : docs/superpowers/specs/2026-08-05-pennylane-resync-montants-devis-design.md
-- Plan : docs/superpowers/plans/2026-08-05-pennylane-resync-montants-devis.md (Task 1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS majordhome.lead_quote_revisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES core.organizations(id),
  lead_quote_id      uuid NOT NULL REFERENCES majordhome.lead_pennylane_quotes(id) ON DELETE CASCADE,
  lead_id            uuid NOT NULL REFERENCES majordhome.leads(id) ON DELETE CASCADE,
  pennylane_quote_id bigint NOT NULL,
  detected_at        timestamptz NOT NULL DEFAULT now(),

  -- Etat APRES modification
  amount_ht          numeric,
  quote_label        text,
  quote_date         date,
  quote_status       text,

  -- Delta (brut, sans seuil : le filtrage se fait a la requete)
  previous_amount_ht numeric,
  amount_delta       numeric,
  amount_delta_pct   numeric,

  source             text NOT NULL DEFAULT 'sync',
  anomaly_flags      text[] NOT NULL DEFAULT '{}'::text[],

  CONSTRAINT lead_quote_revisions_source_chk
    CHECK (source IN ('sync', 'initial_reconciliation'))
);

CREATE INDEX IF NOT EXISTS idx_lqr_quote    ON majordhome.lead_quote_revisions(lead_quote_id);
CREATE INDEX IF NOT EXISTS idx_lqr_lead     ON majordhome.lead_quote_revisions(lead_id);
CREATE INDEX IF NOT EXISTS idx_lqr_org_date ON majordhome.lead_quote_revisions(org_id, detected_at DESC);

-- RLS : lecture/ecriture scopees org (defense en profondeur, l'ecriture reelle
-- passe par la RPC SECURITY DEFINER pennylane_sync_update_quote_fields).
ALTER TABLE majordhome.lead_quote_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_quote_revisions_org ON majordhome.lead_quote_revisions;
CREATE POLICY lead_quote_revisions_org ON majordhome.lead_quote_revisions
  FOR ALL
  USING (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()));

-- Sans ce GRANT, les edge functions qui lisent la vue plantent en 42501 SILENCIEUX.
GRANT SELECT ON majordhome.lead_quote_revisions TO service_role;

CREATE OR REPLACE VIEW public.majordhome_lead_quote_revisions
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.lead_quote_revisions;

GRANT SELECT ON public.majordhome_lead_quote_revisions TO authenticated, service_role;

COMMENT ON TABLE majordhome.lead_quote_revisions IS
  'Historique des modifications de contenu des devis Pennylane rattaches (montant/numero/date). Ecrite par pennylane_sync_update_quote_fields. source=initial_reconciliation pour les ecarts constates au premier passage (delta reel, date de modification inconnue).';
