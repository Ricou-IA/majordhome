-- assert-agent-verifier-client-rdv.sql — vérifie 20261004_2 (prochain_rdv + marque de
-- remplissage) sur le cluster de répétition, APRÈS 20261004_1. Autonome : crée son projet,
-- ses clients, son lead, son équipement et ses RDV (numéros fictifs 06 99 99 02 0x).
DO $$
DECLARE
  v_org    uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_mh_org uuid;
  v_proj   uuid := '77777777-7777-7777-7777-000000000001';
  v_proj2  uuid := '77777777-7777-7777-7777-000000000002';
  v_cli    uuid := '77777777-7777-7777-7777-000000000011';
  v_cli2   uuid := '77777777-7777-7777-7777-000000000012';
  v_lead   uuid := '77777777-7777-7777-7777-000000000021';
  v_type   uuid;
  v_today  date := (now() AT TIME ZONE 'Europe/Paris')::date;
  r        jsonb;
  c        jsonb;
BEGIN
  IF has_function_privilege('anon', 'public.agent_verifier_client_candidats(uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.agent_verifier_client_candidats(uuid, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.agent_verifier_client_candidats(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'droits de agent_verifier_client_candidats modifiés par le CREATE OR REPLACE';
  END IF;

  SELECT id INTO v_mh_org FROM majordhome.organizations WHERE core_org_id = v_org;
  IF v_mh_org IS NULL THEN RAISE EXCEPTION 'org majordhome introuvable'; END IF;

  INSERT INTO core.projects (id, org_id, name, status) VALUES
    (v_proj, v_org, 'TEST AGENT RDV', 'active'), (v_proj2, v_org, 'TEST AGENT RDV LEAD', 'active');
  INSERT INTO majordhome.clients (id, org_id, project_id, last_name, display_name, phone, address, city, is_archived, client_number)
  VALUES (v_cli, v_org, v_proj, 'RDVTEST', 'RDVTEST', '0699990201', '15 route de Lisle', 'Peyrole', false, 'AGENT-R1'),
         (v_cli2, v_org, v_proj2, 'RDVLEAD', 'RDVLEAD', '0699990202', '3 rue Neuve', 'Gaillac', false, 'AGENT-R2');
  SELECT id INTO v_type FROM majordhome.pricing_equipment_types WHERE org_id = v_org AND is_active ORDER BY sort_order LIMIT 1;
  INSERT INTO majordhome.equipments (project_id, equipment_type_id, brand, category, status)
  VALUES (v_proj, v_type, 'À renseigner', 'autre', 'active');

  -- Client 1 : un RDV annulé plus proche (ignoré), un RDV passé (ignoré), le bon RDV à venir
  INSERT INTO majordhome.appointments (id, org_id, client_id, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, client_name)
  VALUES ('77777777-7777-7777-7777-000000000031', v_mh_org, v_cli, 'maintenance', v_today + 1, TIME '08:00', TIME '09:00', 60, 'cancelled', 'RDVTEST'),
         ('77777777-7777-7777-7777-000000000032', v_mh_org, v_cli, 'maintenance', v_today - 3, TIME '08:00', TIME '09:00', 60, 'scheduled', 'RDVTEST'),
         ('77777777-7777-7777-7777-000000000033', v_mh_org, v_cli, 'maintenance', v_today + 12, TIME '08:30', TIME '09:30', 60, 'scheduled', 'RDVTEST');

  -- Client 2 : RDV rattaché au seul lead du client (client_id NULL sur le RDV)
  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, is_deleted, client_id)
  VALUES (v_lead, v_org, 'TEST', 'RDVLEAD', false, v_cli2);
  INSERT INTO majordhome.appointments (id, org_id, lead_id, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, client_name)
  VALUES ('77777777-7777-7777-7777-000000000034', v_mh_org, v_lead, 'rdv_technical', v_today + 5, TIME '14:00', TIME '15:00', 60, 'scheduled', 'RDVLEAD');

  r := public.agent_verifier_client_candidats(v_org, 'conv_rdv', '0699990201');
  c := r->'candidats'->0;
  IF jsonb_array_length(r->'candidats') <> 1 THEN RAISE EXCEPTION 'client 1 : % candidat(s)', jsonb_array_length(r->'candidats'); END IF;
  IF c->'equipements'->>0 ILIKE '%renseigner%' THEN
    RAISE EXCEPTION 'marque de remplissage encore dans le libellé : %', c->'equipements'->>0;
  END IF;
  IF (c->'prochain_rdv'->>'date')::date <> v_today + 12 OR c->'prochain_rdv'->>'heure' <> '08:30'
     OR c->'prochain_rdv'->>'motif' <> 'entretien' THEN
    RAISE EXCEPTION 'client 1 : prochain_rdv inattendu %', c->'prochain_rdv';
  END IF;

  r := public.agent_verifier_client_candidats(v_org, 'conv_rdv', '0699990202');
  c := r->'candidats'->0;
  IF (c->'prochain_rdv'->>'date')::date <> v_today + 5 OR c->'prochain_rdv'->>'motif' <> 'visite technique' THEN
    RAISE EXCEPTION 'client 2 (RDV via lead) : prochain_rdv inattendu %', c->'prochain_rdv';
  END IF;

  -- Sans RDV à venir : clé présente, valeur null
  DELETE FROM majordhome.appointments WHERE lead_id = v_lead;
  r := public.agent_verifier_client_candidats(v_org, 'conv_rdv', '0699990202');
  IF NOT (r->'candidats'->0 ? 'prochain_rdv') OR jsonb_typeof(r->'candidats'->0->'prochain_rdv') <> 'null' THEN
    RAISE EXCEPTION 'sans RDV à venir, prochain_rdv devrait valoir null : %', r->'candidats'->0;
  END IF;

  RAISE NOTICE 'agent_verifier_client prochain_rdv OK';
END $$;
