-- 20261112_1 — Lien MonsieurDPE : journal des accès au rapport complet émis depuis la fiche client.
-- Spec : docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md (§6.3).
--
-- Une ligne par (organisation, numéro de DPE) : le jeton rendu par la porte partenaire de MonsieurDPE et le lien
-- du rapport complet. Sert de journal par organisation (accès illimités, mais comptés) et évite de rappeler
-- MonsieurDPE à chaque clic.
--
-- org_id = organisation CORE, comme majordhome.clients.org_id.
-- Lecture : tout membre de l'organisation (le lien est fait pour être transmis au client).
-- Écriture : la seule edge function `dpe-lien`, par la RPC ci-dessous (service_role). Aucune policy d'écriture.

CREATE TABLE IF NOT EXISTS majordhome.dpe_report_accesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  client_id   uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  dpe_number  text NOT NULL CHECK (dpe_number ~ '^[0-9A-Za-z]{13}$'),
  token       text NOT NULL,
  report_url  text NOT NULL,
  issued_by   uuid,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dpe_report_accesses_org_number_unique UNIQUE (org_id, dpe_number)
);

COMMENT ON TABLE majordhome.dpe_report_accesses IS
  'Accès au rapport complet MonsieurDPE émis depuis la fiche client. Une ligne par (org CORE, numéro de DPE). Écrit par la seule edge function dpe-lien.';

ALTER TABLE majordhome.dpe_report_accesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dpe_report_accesses_select ON majordhome.dpe_report_accesses;
CREATE POLICY dpe_report_accesses_select ON majordhome.dpe_report_accesses
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

-- Le schéma n'accorde rien à anon ; authenticated reçoit arwd par défaut : on ne lui laisse que la lecture.
REVOKE ALL ON majordhome.dpe_report_accesses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.dpe_report_accesses TO authenticated, service_role;

CREATE OR REPLACE VIEW public.majordhome_dpe_report_accesses
WITH (security_invoker = true) AS
SELECT id, org_id, client_id, dpe_number, token, report_url, issued_by, issued_at
FROM majordhome.dpe_report_accesses;

REVOKE ALL ON public.majordhome_dpe_report_accesses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_dpe_report_accesses TO authenticated, service_role;

-- Écriture : service_role seul (la fonction prend org_id en paramètre, elle ne le dérive pas d'auth.uid()).
CREATE OR REPLACE FUNCTION public.dpe_report_access_record(
  p_org_id     uuid,
  p_client_id  uuid,
  p_dpe_number text,
  p_token      text,
  p_report_url text,
  p_issued_by  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_row majordhome.dpe_report_accesses;
BEGIN
  IF p_org_id IS NULL OR p_dpe_number IS NULL OR coalesce(p_token, '') = '' OR coalesce(p_report_url, '') = '' THEN
    RAISE EXCEPTION 'dpe_report_access_invalid';
  END IF;
  -- Le client, s'il est fourni, doit appartenir à l'organisation.
  IF p_client_id IS NOT NULL AND (
    SELECT c.org_id FROM majordhome.clients c WHERE c.id = p_client_id
  ) IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'dpe_report_access_client_org_mismatch';
  END IF;

  INSERT INTO majordhome.dpe_report_accesses (org_id, client_id, dpe_number, token, report_url, issued_by)
  VALUES (p_org_id, p_client_id, p_dpe_number, p_token, p_report_url, p_issued_by)
  ON CONFLICT (org_id, dpe_number) DO UPDATE
    SET token = EXCLUDED.token,
        report_url = EXCLUDED.report_url,
        client_id = COALESCE(EXCLUDED.client_id, majordhome.dpe_report_accesses.client_id)
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.dpe_report_access_record(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dpe_report_access_record(uuid, uuid, text, text, text, uuid) TO service_role;
