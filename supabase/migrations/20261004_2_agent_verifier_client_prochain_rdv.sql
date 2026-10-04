-- supabase/migrations/20261004_2_agent_verifier_client_prochain_rdv.sql
-- ============================================================================
-- Agent téléphonique — outil verifier_client : deux corrections vues au 1er appel réel
-- (2026-10-04, client test ABRIOUX) :
--   1. prochain_rdv : l'agent ne savait pas qu'un RDV était déjà posé (entretien du 16/10).
--      Prochain RDV à venir (date ≥ aujourd'hui, heure de Paris), hors annulé / absent / congé,
--      rattaché au client directement (appointments.client_id) OU via un lead du client
--      (16 RDV à venir sur 115 n'ont que lead_id, mesuré le 2026-10-04).
--   2. libellé d'équipement : la marque « À renseigner » (valeur de remplissage de l'import)
--      partait dans le libellé lu par l'agent. Les marques de remplissage sont ignorées.
-- Même signature, mêmes droits (REVOKE PUBLIC/anon/authenticated, service_role seul).
-- Répétée sur scripts/migration-rehearsal/ (assert-agent-verifier-client.sql, étendu).
-- ============================================================================

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
              END = p_telephone);

  RETURN jsonb_build_object('tentatives', v_tentatives, 'candidats', v_candidats);
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_verifier_client_candidats(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_verifier_client_candidats(uuid, text, text) TO service_role;
