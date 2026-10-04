-- supabase/migrations/20261004_6_agent_accueil.sql
-- ============================================================================
-- Agent téléphonique — accueil personnalisé par le numéro appelant.
-- Spec : docs/superpowers/specs/2026-10-04-agent-telephonique-reconnaissance-par-numero-design.md
--
-- Au décroché d'un appel Twilio, ElevenLabs appelle l'edge `agent-accueil` avec le numéro
-- QUI APPELLE ; elle salue le client par son nom (« Bonjour Jean Dupont ») et relève ce
-- numéro ici. La vérification (`verifier_client`) le RELIT côté serveur : le numéro
-- appelant ne transite jamais par l'agent ni par un paramètre d'outil — il fait foi
-- parce que seul le serveur l'a écrit, et c'est ce qui autorise « numéro appelant +
-- adresse » comme preuve suffisante.
--
--   1. majordhome.agent_accueils : un accueil par conversation (numéro appelant, mode).
--   2. public.agent_accueil_enregistrer(...) : écrit par l'edge agent-accueil.
--   3. public.agent_verifier_client_candidats : même signature, trois changements :
--      - p_telephone NULL → numéro appelant relevé à l'accueil de CETTE conversation
--        (moins d'une heure) ; aucun → aucun candidat ;
--      - renvoie `numero_appelant` = le numéro utilisé est celui qui appelle (relevé ou
--        dicté identique) — c'est l'edge qui en déduit l'assouplissement nom / commune ;
--      - chaque candidat porte `first_name` (salutation de l'accueil).
-- Toutes les RPC : SECURITY DEFINER, org_id en paramètre → REVOKE FROM PUBLIC, anon,
-- authenticated ; service_role seul. Répétée sur scripts/migration-rehearsal/
-- (après 20261004_1 et _2, assert-agent-accueil.sql).
-- ============================================================================

-- 1. Accueils ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.agent_accueils (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  conversation_id    text NOT NULL,
  agent_id           text NOT NULL,
  telephone_appelant text CHECK (telephone_appelant ~ '^0[0-9]{9}$'),
  mode               text NOT NULL CHECK (mode IN ('nom', 'famille', 'commune', 'neutre')),
  nb_fiches          integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, conversation_id)
);
COMMENT ON TABLE majordhome.agent_accueils IS
  'Accueil d''un appel par l''agent téléphonique : numéro appelant relevé au décroché (webhook d''initiation Twilio → edge agent-accueil) et salutation choisie. Seule source du numéro appelant pour verifier_client. Écrite par l''edge (service_role).';

ALTER TABLE majordhome.agent_accueils ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_accueils_select_admin ON majordhome.agent_accueils;
CREATE POLICY agent_accueils_select_admin ON majordhome.agent_accueils
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om
                     WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
-- Aucune écriture front.
REVOKE ALL ON majordhome.agent_accueils FROM anon, authenticated;
GRANT SELECT ON majordhome.agent_accueils TO authenticated;
GRANT SELECT, INSERT ON majordhome.agent_accueils TO service_role;

-- 2. Enregistrement de l'accueil -------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_accueil_enregistrer(
  p_org_id uuid,
  p_conversation_id text,
  p_agent_id text,
  p_telephone text,
  p_mode text,
  p_nb_fiches integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
BEGIN
  IF p_org_id IS NULL OR coalesce(p_conversation_id, '') = '' OR coalesce(p_agent_id, '') = '' THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  -- Premier accueil de la conversation seul retenu : un rejeu du webhook ne remplace rien.
  INSERT INTO majordhome.agent_accueils (org_id, conversation_id, agent_id, telephone_appelant, mode, nb_fiches)
  VALUES (p_org_id, p_conversation_id, p_agent_id, nullif(p_telephone, ''), p_mode, coalesce(p_nb_fiches, 0))
  ON CONFLICT (org_id, conversation_id) DO NOTHING;
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_accueil_enregistrer(uuid, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_accueil_enregistrer(uuid, text, text, text, text, integer) TO service_role;

-- 3. Candidats : numéro appelant relu, prénom renvoyé ----------------------------
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
  v_aujourdhui date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_appelant text;
  v_telephone text;
BEGIN
  IF p_org_id IS NULL OR p_conversation_id IS NULL
     OR (p_telephone IS NOT NULL AND p_telephone !~ '^0[0-9]{9}$') THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_tentatives
    FROM majordhome.agent_verifications
   WHERE org_id = p_org_id AND conversation_id = p_conversation_id;

  -- Numéro QUI APPELLE, relevé par le serveur au décroché de CETTE conversation.
  SELECT a.telephone_appelant INTO v_appelant
    FROM majordhome.agent_accueils a
   WHERE a.org_id = p_org_id AND a.conversation_id = p_conversation_id
     AND a.created_at > now() - interval '1 hour';

  v_telephone := coalesce(p_telephone, v_appelant);
  IF v_telephone IS NULL THEN
    RETURN jsonb_build_object('tentatives', v_tentatives, 'candidats', '[]'::jsonb, 'numero_appelant', false);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'client_id', c.id,
           'last_name', c.last_name,
           'first_name', c.first_name,
           'address', c.address,
           'city', c.city,
           'equipements', (
             SELECT coalesce(jsonb_agg(trim(concat_ws(' ', coalesce(t.label, cat.label),
                      -- translate() avant lower() : sous une locale C, lower('À') reste 'À'.
                      CASE WHEN lower(translate(trim(coalesce(e.brand, '')), 'ÀàÂâ', 'aaaa')) IN
                                ('', 'a renseigner', 'inconnu', 'inconnue', 'nc', 'n/c', '?', '-', 'autre')
                           THEN NULL ELSE trim(e.brand) END)) ORDER BY e.created_at), '[]'::jsonb)
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
              WHERE k.client_id = c.id AND k.status = 'active'),
           'prochain_rdv', (
             SELECT jsonb_build_object(
                      'date', a.scheduled_date,
                      'heure', to_char(a.scheduled_start, 'HH24:MI'),
                      'motif', CASE a.appointment_type
                                 WHEN 'maintenance'   THEN 'entretien'
                                 WHEN 'service'       THEN 'dépannage'
                                 WHEN 'installation'  THEN 'installation'
                                 WHEN 'rdv_technical' THEN 'visite technique'
                                 ELSE 'rendez-vous'
                               END)
               FROM majordhome.appointments a
              WHERE a.scheduled_date >= v_aujourdhui
                AND coalesce(a.status, '') NOT IN ('cancelled', 'no_show')
                AND coalesce(a.appointment_type, '') <> 'leave'
                AND (a.client_id = c.id
                     OR a.lead_id IN (SELECT l.id FROM majordhome.leads l WHERE l.client_id = c.id))
              ORDER BY a.scheduled_date, a.scheduled_start NULLS LAST
              LIMIT 1)
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
              END = v_telephone);

  RETURN jsonb_build_object(
    'tentatives', v_tentatives,
    'candidats', v_candidats,
    'numero_appelant', v_appelant IS NOT NULL AND v_telephone = v_appelant);
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_verifier_client_candidats(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_verifier_client_candidats(uuid, text, text) TO service_role;
