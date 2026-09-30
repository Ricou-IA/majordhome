-- ============================================================================
-- 20260930_5 — Auto-RDV tranche 3 : invitations mensuelles + crons
-- (spec 2026-09-29 § 3.2, § 4.1, § 6 ; plan tranche 3 Task 5)
-- ============================================================================
-- 1. majordhome.auto_rdv_invitations : une ligne par (org, contrat, mois).
--    Écrite par les edges (service_role) : auto-rdv-cron (envoi, relances,
--    expiration) et auto-rdv (page ouverte, sans créneau, RDV pris). Lue par le
--    Kanban (badge « invité le… ») et le Dashboard (tableau du mois).
-- 2. Crons pg_cron → edge auto-rdv-cron (verify_jwt:false, MDH_CRON_SECRET) :
--    `auto-rdv-ouverture` le 1er à 04:00 UTC (06:00 Paris), `auto-rdv-relances`
--    tous les jours à 04:20 UTC. Même patron que maintenance-digest.
-- ============================================================================

CREATE TABLE IF NOT EXISTS majordhome.auto_rdv_invitations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  contract_id        uuid NOT NULL REFERENCES majordhome.contracts(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL,
  mois               date NOT NULL,
  raison             text NOT NULL CHECK (raison IN ('anniversaire', 'retard')),
  sent_at            timestamptz,
  email_to           text,
  mailing_log_id     uuid,
  opened_at          timestamptz,
  booked_at          timestamptz,
  appointment_id     uuid,
  intervention_id    uuid,
  sms_relance_at     timestamptz,
  escalade_appel_at  timestamptz,
  outcome            text CHECK (outcome IN ('booked', 'no_slot', 'expired', 'phone')),
  relances           int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, contract_id, mois)
);
CREATE INDEX IF NOT EXISTS auto_rdv_invitations_org_mois_idx ON majordhome.auto_rdv_invitations (org_id, mois);
COMMENT ON TABLE majordhome.auto_rdv_invitations IS
  'Auto-RDV : suivi d''une invitation mensuelle par contrat (mail envoyé, page ouverte, RDV pris, relance SMS, escalade en liste d''appels, expiration). Écrite par les edges (service_role).';
COMMENT ON COLUMN majordhome.auto_rdv_invitations.mois IS '1er jour du mois de l''invitation.';
COMMENT ON COLUMN majordhome.auto_rdv_invitations.relances IS 'Mois consécutifs invité sans rendez-vous (compteur porté d''un mois à l''autre).';

DROP TRIGGER IF EXISTS trg_auto_rdv_invitations_updated_at ON majordhome.auto_rdv_invitations;
CREATE TRIGGER trg_auto_rdv_invitations_updated_at BEFORE UPDATE ON majordhome.auto_rdv_invitations
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

ALTER TABLE majordhome.auto_rdv_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auto_rdv_invitations_select ON majordhome.auto_rdv_invitations;
CREATE POLICY auto_rdv_invitations_select ON majordhome.auto_rdv_invitations FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
-- aucune policy d'écriture : service_role seulement.

REVOKE ALL ON majordhome.auto_rdv_invitations FROM anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baikal_reader') THEN
    REVOKE ALL ON majordhome.auto_rdv_invitations FROM baikal_reader;
  END IF;
END $$;
GRANT SELECT ON majordhome.auto_rdv_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON majordhome.auto_rdv_invitations TO service_role;

DROP VIEW IF EXISTS public.majordhome_auto_rdv_invitations;
CREATE VIEW public.majordhome_auto_rdv_invitations WITH (security_invoker = true) AS
  SELECT id, org_id, contract_id, client_id, mois, raison, sent_at, email_to, mailing_log_id, opened_at, booked_at,
         appointment_id, intervention_id, sms_relance_at, escalade_appel_at, outcome, relances, created_at, updated_at
  FROM majordhome.auto_rdv_invitations;
REVOKE ALL ON public.majordhome_auto_rdv_invitations FROM anon, authenticated;
GRANT SELECT ON public.majordhome_auto_rdv_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.majordhome_auto_rdv_invitations TO service_role;

-- Les crons pg_cron sont dans 20260930_6_auto_rdv_crons.sql (le harnais de
-- répétition n'a ni pg_cron ni vault, même convention que maintenance-digest).
