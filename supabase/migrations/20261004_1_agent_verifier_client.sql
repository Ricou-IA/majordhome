-- supabase/migrations/20261004_1_agent_verifier_client.sql
-- ============================================================================
-- Agent téléphonique (ElevenLabs) — outil `verifier_client`, tranche 1.
-- Spec : docs/superpowers/specs/2026-10-04-agent-telephonique-verifier-client-design.md
--
-- La fiche ne quitte jamais le serveur : l'edge agent-verifier-client (service_role) lit les
-- fiches qui portent le téléphone dit par l'appelant, compare nom / commune / adresse en
-- mémoire (src/lib/agentTelephonique.js), puis journalise sa tentative. L'agent ne reçoit
-- qu'un verdict (+ équipements / dernier entretien si vérifié).
--   1. majordhome.agent_verifications : journal des tentatives (limite par appel, mesure)
--   2. public.agent_verifier_client_candidats(org, conversation, téléphone) → jsonb
--   3. public.agent_verification_enregistrer(...) → journalise une tentative
-- Les deux RPC prennent org_id en paramètre (org résolue par l'edge depuis l'agent_id) :
-- REVOKE FROM PUBLIC, anon, authenticated — service_role seul.
-- Répétée sur scripts/migration-rehearsal/ (assert-agent-verifier-client.sql).
-- ============================================================================

-- 1. Journal des tentatives
CREATE TABLE IF NOT EXISTS majordhome.agent_verifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  agent_id        text NOT NULL,
  verifie         boolean NOT NULL,
  client_id       uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  nb_candidats    integer NOT NULL DEFAULT 0,
  motif_echec     text CHECK (motif_echec IN
                    ('telephone_invalide', 'telephone_inconnu', 'nom', 'commune', 'adresse', 'doublon', 'limite')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (verifie = (motif_echec IS NULL)),
  CHECK (verifie OR client_id IS NULL)
);
COMMENT ON TABLE majordhome.agent_verifications IS
  'Tentatives de reconnaissance d''un appelant par l''agent téléphonique. motif_echec est INTERNE : il ne remonte jamais à l''agent (pas d''oracle). Écrite par l''edge agent-verifier-client (service_role).';
CREATE INDEX IF NOT EXISTS agent_verifications_conversation_idx
  ON majordhome.agent_verifications (org_id, conversation_id);

ALTER TABLE majordhome.agent_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_verifications_select_admin ON majordhome.agent_verifications;
CREATE POLICY agent_verifications_select_admin ON majordhome.agent_verifications
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om
                     WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
-- Aucune écriture front : ni INSERT/UPDATE/DELETE pour anon/authenticated.
REVOKE ALL ON majordhome.agent_verifications FROM anon, authenticated;
GRANT SELECT ON majordhome.agent_verifications TO authenticated;
GRANT SELECT, INSERT ON majordhome.agent_verifications TO service_role;

-- 2. Candidats : fiches actives de l'org portant ce téléphone (principal ou secondaire),
--    avec de quoi personnaliser l'appel SI l'edge les vérifie. Le téléphone stocké est
--    normalisé comme normaliserTelephone() (src/lib/agentTelephonique.js).
CREATE OR REPLACE FUNCTION public.agent_verifier_client_candidats(
  p_org_id uuid,
  p_conversation_id text,
  p_telephone text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_tentatives integer;
  v_candidats jsonb;
BEGIN
  IF p_org_id IS NULL OR p_conversation_id IS NULL OR p_telephone IS NULL
     OR p_telephone !~ '^0[0-9]{9}$' THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_tentatives
    FROM majordhome.agent_verifications
   WHERE org_id = p_org_id AND conversation_id = p_conversation_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'client_id', c.id,
           'last_name', c.last_name,
           'address', c.address,
           'city', c.city,
           'equipements', (
             SELECT coalesce(jsonb_agg(trim(concat_ws(' ', coalesce(t.label, cat.label), e.brand)) ORDER BY e.created_at), '[]'::jsonb)
               FROM majordhome.equipments e
               LEFT JOIN majordhome.pricing_equipment_types t ON t.id = e.equipment_type_id
               LEFT JOIN majordhome.equipment_categories cat ON cat.id = e.category_id
              WHERE c.project_id IS NOT NULL AND e.project_id = c.project_id
                AND coalesce(t.label, cat.label) IS NOT NULL),
           'dernier_entretien', (
             SELECT max(v.visit_date)
               FROM majordhome.maintenance_visits v
               JOIN majordhome.contracts k ON k.id = v.contract_id
              WHERE k.client_id = c.id AND v.status = 'completed'),
           'contrat_actif', EXISTS (
             SELECT 1 FROM majordhome.contracts k
              WHERE k.client_id = c.id AND k.status = 'active')
         )), '[]'::jsonb)
    INTO v_candidats
    FROM majordhome.clients c
   WHERE c.org_id = p_org_id
     AND NOT coalesce(c.is_archived, false)
     AND EXISTS (
       SELECT 1
         FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d
                 FROM unnest(ARRAY[c.phone, c.phone_secondary]) AS p) s
        WHERE CASE
                WHEN s.d LIKE '0033%' THEN '0' || substr(s.d, 5)
                WHEN s.d LIKE '33%' AND length(s.d) = 11 THEN '0' || substr(s.d, 3)
                WHEN length(s.d) = 9 THEN '0' || s.d
                ELSE s.d
              END = p_telephone);

  RETURN jsonb_build_object('tentatives', v_tentatives, 'candidats', v_candidats);
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_verifier_client_candidats(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_verifier_client_candidats(uuid, text, text) TO service_role;

-- 3. Journalisation d'une tentative (le verdict est calculé par l'edge)
CREATE OR REPLACE FUNCTION public.agent_verification_enregistrer(
  p_org_id uuid,
  p_conversation_id text,
  p_agent_id text,
  p_verifie boolean,
  p_client_id uuid,
  p_nb_candidats integer,
  p_motif_echec text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- Un client vérifié appartient forcément à l'org de l'appel.
  IF p_client_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM majordhome.clients WHERE id = p_client_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'client_hors_org' USING ERRCODE = '42501';
  END IF;
  INSERT INTO majordhome.agent_verifications
    (org_id, conversation_id, agent_id, verifie, client_id, nb_candidats, motif_echec)
  VALUES (p_org_id, p_conversation_id, p_agent_id, p_verifie, p_client_id, coalesce(p_nb_candidats, 0), p_motif_echec)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_verification_enregistrer(uuid, text, text, boolean, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_verification_enregistrer(uuid, text, text, boolean, uuid, integer, text) TO service_role;
