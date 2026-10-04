-- supabase/migrations/20261004_3_agent_creneaux.sql
-- ============================================================================
-- Agent téléphonique — proposer et poser un créneau d'entretien.
-- Spec : docs/superpowers/specs/2026-10-04-agent-telephonique-creneaux-design.md
--   1. auto_rdv_poser : nouveau paramètre p_date_max (DEFAULT NULL). NULL = borne
--      historique (fin du mois, prolongée) → page client /rdv/:token INCHANGÉE ;
--      renseigné (edge agent-creneaux, service_role) = borne imposée (J+horizon).
--      Ancienne signature (11 args) supprimée : pas de deux surcharges. Corps = 20260930_4.
--   2. agent_creneaux_contexte(org, conversation) : le client que verifier_client a
--      reconnu DANS CET APPEL (agent_verifications) et son contrat actif — l'agent ne
--      désigne jamais le client.
--   3. majordhome.agent_propositions + RPC enregistrer / lire : les créneaux proposés
--      restent côté serveur, l'agent ne manipule qu'un numéro (valable 30 min).
-- Toutes les RPC : SECURITY DEFINER, service_role seul (org_id en paramètre).
-- Répétée sur scripts/migration-rehearsal/ (assert-agent-creneaux.sql).
-- ============================================================================

-- 1. auto_rdv_poser + p_date_max -------------------------------------------------
DROP FUNCTION IF EXISTS public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.auto_rdv_poser(
  p_contract_id    uuid,
  p_team_member_id uuid,
  p_date           date,
  p_demi           text,
  p_start          time,
  p_end            time,
  p_duration       int,
  p_empreinte      text,
  p_grand_secteur  text,
  p_source         text,
  p_decalages      jsonb DEFAULT '[]'::jsonb,
  p_date_max       date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_ct        record;
  v_cl        record;
  v_core      uuid;
  v_mdh       uuid;
  v_tm_id     uuid;
  v_empreinte text;
  v_card      uuid;
  v_created   boolean := false;
  v_appt      uuid;
  v_now       timestamptz := now();
  v_fin_mois  date;
  v_borne     date;
  v_ligne     jsonb;
  v_decales   int := 0;
BEGIN
  IF p_contract_id IS NULL OR p_team_member_id IS NULL OR p_date IS NULL
     OR p_demi IS NULL OR p_demi NOT IN ('matin', 'apres_midi')
     OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start
     OR p_duration IS NULL OR p_duration <= 0
     OR p_decalages IS NULL OR jsonb_typeof(p_decalages) <> 'array' THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;

  IF p_date_max IS NOT NULL THEN
    v_borne := p_date_max;
  ELSE
    v_fin_mois := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
    v_borne := CASE WHEN v_fin_mois - current_date < 7
                    THEN (date_trunc('month', current_date) + interval '2 month - 1 day')::date
                    ELSE v_fin_mois END;
  END IF;
  IF p_date < current_date OR p_date > v_borne THEN
    RAISE EXCEPTION 'hors_mois';
  END IF;

  SELECT c.id, c.org_id, c.client_id, c.status INTO v_ct
    FROM majordhome.contracts c WHERE c.id = p_contract_id;
  IF v_ct.id IS NULL THEN RAISE EXCEPTION 'contrat_introuvable'; END IF;
  IF v_ct.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'contrat_inactif'; END IF;
  v_core := v_ct.org_id;

  SELECT o.id INTO v_mdh FROM majordhome.organizations o WHERE o.core_org_id = v_core;
  IF v_mdh IS NULL THEN RAISE EXCEPTION 'org_majordhome_introuvable'; END IF;

  SELECT cl.id, cl.project_id, cl.first_name, cl.last_name, cl.display_name,
         cl.phone, cl.email, cl.address, cl.city, cl.postal_code
    INTO v_cl
    FROM majordhome.clients cl WHERE cl.id = v_ct.client_id AND cl.org_id = v_core;
  IF v_cl.id IS NULL THEN RAISE EXCEPTION 'contrat_introuvable'; END IF;
  IF v_cl.project_id IS NULL THEN RAISE EXCEPTION 'client_sans_projet'; END IF;

  SELECT tm.id INTO v_tm_id
    FROM majordhome.team_members tm
   WHERE tm.id = p_team_member_id AND tm.org_id = v_mdh
     AND tm.is_active IS TRUE AND tm.include_in_routing IS TRUE AND tm.role = 'technician';
  IF v_tm_id IS NULL THEN RAISE EXCEPTION 'technicien_invalide'; END IF;

  IF EXISTS (
    SELECT 1 FROM majordhome.journees_secteur js
     WHERE js.org_id = v_core AND js.team_member_id = p_team_member_id
       AND js.date = p_date AND js.figee_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'journee_figee';
  END IF;

  SELECT coalesce(string_agg(a.id::text || '@' || to_char(a.scheduled_start, 'HH24:MI'), ',' ORDER BY a.id::text), '')
    INTO v_empreinte
    FROM majordhome.appointments a
    JOIN majordhome.appointment_technicians at
      ON at.appointment_id = a.id AND at.technician_id = p_team_member_id
   WHERE a.org_id = v_mdh AND a.scheduled_date = p_date
     AND a.status NOT IN ('cancelled', 'no_show');
  IF v_empreinte IS DISTINCT FROM coalesce(p_empreinte, '') THEN
    RAISE EXCEPTION 'journee_modifiee';
  END IF;

  FOR v_ligne IN SELECT * FROM jsonb_array_elements(p_decalages) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM majordhome.appointments a
      JOIN majordhome.appointment_technicians at ON at.appointment_id = a.id AND at.technician_id = p_team_member_id
      WHERE a.id = (v_ligne->>'id')::uuid
        AND a.org_id = v_mdh
        AND a.scheduled_date = p_date
        AND a.scheduled_start = (v_ligne->>'attendu')::time
        AND a.hour_confirmed_at IS NULL
        AND coalesce(a.time_flex_minutes, -1) <> 0
        AND a.status NOT IN ('cancelled', 'completed', 'no_show')
        AND a.appointment_type IN ('maintenance', 'service')
    ) THEN
      RAISE EXCEPTION 'decalage_refuse';
    END IF;
  END LOOP;
  FOR v_ligne IN SELECT * FROM jsonb_array_elements(p_decalages) LOOP
    UPDATE majordhome.appointments a SET
      scheduled_start = (v_ligne->>'scheduled_start')::time,
      scheduled_end   = (v_ligne->>'scheduled_end')::time,
      updated_at      = v_now
    WHERE a.id = (v_ligne->>'id')::uuid AND a.org_id = v_mdh;
    v_decales := v_decales + 1;
  END LOOP;

  SELECT i.id INTO v_card
    FROM majordhome.interventions i
   WHERE i.client_id = v_cl.id AND i.intervention_type = 'entretien' AND i.parent_id IS NULL
     AND i.workflow_status NOT IN ('realise', 'facture')
   ORDER BY i.created_at DESC LIMIT 1;
  IF v_card IS NOT NULL AND EXISTS (
    SELECT 1 FROM majordhome.appointments a
     WHERE a.intervention_id = v_card AND a.scheduled_date >= current_date
       AND a.status NOT IN ('cancelled', 'no_show')
  ) THEN
    RAISE EXCEPTION 'deja_planifie';
  END IF;

  IF v_card IS NULL THEN
    INSERT INTO majordhome.interventions
      (project_id, client_id, contract_id, intervention_type, workflow_status, scheduled_date, status, tags)
    VALUES
      (v_cl.project_id, v_cl.id, v_ct.id, 'entretien', 'planifie', p_date, 'scheduled', ARRAY['Contrat']::text[])
    RETURNING id INTO v_card;
    v_created := true;
  ELSE
    UPDATE majordhome.interventions
       SET workflow_status = 'planifie', scheduled_date = p_date,
           contract_id = coalesce(contract_id, v_ct.id), updated_at = v_now
     WHERE id = v_card;
  END IF;

  INSERT INTO majordhome.appointments (
    org_id, appointment_type, subject, scheduled_date, scheduled_start, scheduled_end, duration_minutes,
    intervention_id, client_id, client_name, client_first_name, client_phone, client_email,
    address, city, postal_code, status, priority, source,
    time_flex_minutes, hour_confirmed_at, announced_start, grand_secteur
  ) VALUES (
    v_mdh, 'maintenance', 'Entretien', p_date, p_start, p_end, p_duration,
    v_card, v_cl.id, coalesce(v_cl.last_name, v_cl.display_name), v_cl.first_name, v_cl.phone, v_cl.email,
    v_cl.address, v_cl.city, v_cl.postal_code, 'scheduled', 'normal', coalesce(p_source, 'auto_rdv'),
    240, NULL, p_start, p_grand_secteur
  ) RETURNING id INTO v_appt;

  INSERT INTO majordhome.appointment_technicians (appointment_id, technician_id, role)
  VALUES (v_appt, p_team_member_id, 'lead');

  INSERT INTO majordhome.journees_secteur (org_id, date, team_member_id, grand_secteur, origine)
  VALUES (v_core, p_date, p_team_member_id, p_grand_secteur, 'deduite')
  ON CONFLICT (org_id, team_member_id, date) DO UPDATE
    SET grand_secteur = coalesce(majordhome.journees_secteur.grand_secteur, EXCLUDED.grand_secteur),
        updated_at = v_now;

  RETURN jsonb_build_object('appointment_id', v_appt, 'intervention_id', v_card, 'carte_creee', v_created, 'decales', v_decales);
END
$$;

REVOKE EXECUTE ON FUNCTION public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text, jsonb, date)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text, jsonb, date)
  TO service_role;
COMMENT ON FUNCTION public.auto_rdv_poser(uuid, uuid, date, text, time, time, int, text, text, text, jsonb, date) IS
  'Auto-RDV : pose atomique d''un entretien (page client, agent téléphonique) + décalages des voisins adaptables. p_date_max NULL = mois en cours prolongé (page client). service_role only.';

-- 2. Contexte de l'appel : client vérifié dans CET appel + contrat actif -----------
CREATE OR REPLACE FUNCTION public.agent_creneaux_contexte(p_org_id uuid, p_conversation_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_client   uuid;
  v_contrat  uuid;
BEGIN
  IF p_org_id IS NULL OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  SELECT v.client_id INTO v_client
    FROM majordhome.agent_verifications v
   WHERE v.org_id = p_org_id AND v.conversation_id = p_conversation_id
     AND v.verifie AND v.client_id IS NOT NULL
     AND v.created_at > now() - interval '1 hour'
   ORDER BY v.created_at DESC LIMIT 1;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('erreur', 'client_non_verifie');
  END IF;
  SELECT k.id INTO v_contrat
    FROM majordhome.contracts k
   WHERE k.client_id = v_client AND k.org_id = p_org_id AND k.status = 'active'
   LIMIT 1;
  IF v_contrat IS NULL THEN
    RETURN jsonb_build_object('erreur', 'pas_de_contrat');
  END IF;
  RETURN jsonb_build_object('client_id', v_client, 'contract_id', v_contrat);
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_creneaux_contexte(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_creneaux_contexte(uuid, text) TO service_role;

-- 3. Créneaux proposés pendant l'appel ----------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.agent_propositions (
  org_id          uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  numero          integer NOT NULL CHECK (numero > 0),
  contract_id     uuid NOT NULL REFERENCES majordhome.contracts(id) ON DELETE CASCADE,
  date            date NOT NULL,
  technicien_id   uuid NOT NULL,
  demi            text NOT NULL CHECK (demi IN ('matin', 'apres_midi')),
  empreinte       text NOT NULL,
  grand_secteur   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, conversation_id, numero)
);
COMMENT ON TABLE majordhome.agent_propositions IS
  'Créneaux proposés par l''agent téléphonique pendant un appel. L''agent ne manipule que le numéro ; valable 30 min. Écrite par l''edge agent-creneaux (service_role).';
ALTER TABLE majordhome.agent_propositions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_propositions_select_admin ON majordhome.agent_propositions;
CREATE POLICY agent_propositions_select_admin ON majordhome.agent_propositions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om
                     WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
REVOKE ALL ON majordhome.agent_propositions FROM anon, authenticated;
GRANT SELECT ON majordhome.agent_propositions TO authenticated;
GRANT SELECT, INSERT ON majordhome.agent_propositions TO service_role;

-- p_creneaux = [{ date, technicien_id, demi, empreinte, grand_secteur }] → numéros attribués, dans l'ordre.
CREATE OR REPLACE FUNCTION public.agent_propositions_enregistrer(
  p_org_id uuid, p_conversation_id text, p_contract_id uuid, p_creneaux jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_base    integer;
  v_ligne   jsonb;
  v_i       integer := 0;
  v_numeros jsonb := '[]'::jsonb;
BEGIN
  IF p_org_id IS NULL OR p_conversation_id IS NULL OR p_contract_id IS NULL
     OR p_creneaux IS NULL OR jsonb_typeof(p_creneaux) <> 'array' THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.contracts WHERE id = p_contract_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'contrat_hors_org' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(max(numero), 0) INTO v_base
    FROM majordhome.agent_propositions WHERE org_id = p_org_id AND conversation_id = p_conversation_id;
  FOR v_ligne IN SELECT * FROM jsonb_array_elements(p_creneaux) LOOP
    v_i := v_i + 1;
    INSERT INTO majordhome.agent_propositions
      (org_id, conversation_id, numero, contract_id, date, technicien_id, demi, empreinte, grand_secteur)
    VALUES (p_org_id, p_conversation_id, v_base + v_i, p_contract_id,
            (v_ligne->>'date')::date, (v_ligne->>'technicien_id')::uuid, v_ligne->>'demi',
            coalesce(v_ligne->>'empreinte', ''), nullif(v_ligne->>'grand_secteur', ''));
    v_numeros := v_numeros || to_jsonb(v_base + v_i);
  END LOOP;
  RETURN v_numeros;
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_propositions_enregistrer(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_propositions_enregistrer(uuid, text, uuid, jsonb) TO service_role;

-- Proposition encore valable (30 min) de CET appel, sinon NULL.
CREATE OR REPLACE FUNCTION public.agent_proposition_lire(p_org_id uuid, p_conversation_id text, p_numero integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
  SELECT jsonb_build_object('contract_id', p.contract_id, 'date', p.date, 'technicien_id', p.technicien_id,
                            'demi', p.demi, 'empreinte', p.empreinte, 'grand_secteur', p.grand_secteur)
    FROM majordhome.agent_propositions p
   WHERE p.org_id = p_org_id AND p.conversation_id = p_conversation_id AND p.numero = p_numero
     AND p.created_at > now() - interval '30 minutes';
$function$;
REVOKE ALL ON FUNCTION public.agent_proposition_lire(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_proposition_lire(uuid, text, integer) TO service_role;
