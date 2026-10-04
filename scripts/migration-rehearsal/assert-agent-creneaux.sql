-- assert-agent-creneaux.sql — vérifie 20261004_3 (agent téléphonique : créneaux) sur le cluster
-- de répétition, APRÈS 20261004_1 et 20261004_2. Autonome : crée son projet, son client, son
-- contrat et sa vérification (numéro fictif 06 99 99 03 01). Un écart lève une exception.
DO $$
DECLARE
  v_org    uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_mdh    uuid;
  v_proj   uuid := '88888888-8888-8888-8888-000000000001';
  v_cli    uuid := '88888888-8888-8888-8888-000000000011';
  v_cli2   uuid := '88888888-8888-8888-8888-000000000012';
  v_ct     uuid := '88888888-8888-8888-8888-000000000021';
  v_tech   uuid;
  v_loin   date := current_date + 40;
  r        jsonb;
  n        int;
BEGIN
  -- Droits effectifs (jamais le texte de la migration)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
              WHERE s.nspname = 'public' AND p.proname = 'auto_rdv_poser' AND p.pronargs = 11) THEN
    RAISE EXCEPTION 'ancienne signature auto_rdv_poser (11 args) toujours présente';
  END IF;
  IF has_function_privilege('anon', 'public.auto_rdv_poser(uuid,uuid,date,text,time,time,int,text,text,text,jsonb,date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.auto_rdv_poser(uuid,uuid,date,text,time,time,int,text,text,text,jsonb,date)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.auto_rdv_poser(uuid,uuid,date,text,time,time,int,text,text,text,jsonb,date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.agent_creneaux_contexte(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.agent_creneaux_contexte(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.agent_propositions_enregistrer(uuid,text,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.agent_proposition_lire(uuid,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.agent_proposition_lire(uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'droits des RPC agent / auto_rdv_poser incorrects';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.agent_propositions'::regclass) IS NOT TRUE
     OR has_table_privilege('authenticated', 'majordhome.agent_propositions', 'INSERT') THEN
    RAISE EXCEPTION 'agent_propositions : RLS inactive ou écrivable par le front';
  END IF;

  SELECT id INTO v_mdh FROM majordhome.organizations WHERE core_org_id = v_org;
  SELECT tm.id INTO v_tech FROM majordhome.team_members tm
   WHERE tm.org_id = v_mdh AND tm.is_active AND tm.include_in_routing AND tm.role = 'technician' LIMIT 1;
  IF v_tech IS NULL THEN RAISE EXCEPTION 'aucun technicien de tournée dans le snapshot'; END IF;

  INSERT INTO core.projects (id, org_id, name, status) VALUES (v_proj, v_org, 'TEST AGENT CRENEAUX', 'active'),
    ('88888888-8888-8888-8888-000000000002', v_org, 'TEST AGENT SANS CONTRAT', 'active');
  INSERT INTO majordhome.clients (id, org_id, project_id, last_name, display_name, phone, address, city, is_archived, client_number)
  VALUES (v_cli, v_org, v_proj, 'CRENEAUTEST', 'CRENEAUTEST', '0699990301', '1 rue du Test', 'Gaillac', false, 'AGENT-C1'),
         (v_cli2, v_org, '88888888-8888-8888-8888-000000000002', 'SANSCONTRAT', 'SANSCONTRAT', '0699990302', '2 rue du Test', 'Gaillac', false, 'AGENT-C2');
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency, start_date)
  VALUES (v_ct, v_org, v_cli, 'active', 'annuel', current_date - 100);

  -- Contexte : rien tant que verifier_client n'a pas reconnu le client DANS CET appel
  r := public.agent_creneaux_contexte(v_org, 'conv_cr');
  IF r->>'erreur' <> 'client_non_verifie' THEN RAISE EXCEPTION 'contexte sans vérification : %', r; END IF;
  PERFORM public.agent_verification_enregistrer(v_org, 'conv_cr', 'agent_x', false, NULL, 1, 'adresse');
  r := public.agent_creneaux_contexte(v_org, 'conv_cr');
  IF r->>'erreur' <> 'client_non_verifie' THEN RAISE EXCEPTION 'un échec de vérification ouvre le contexte : %', r; END IF;
  PERFORM public.agent_verification_enregistrer(v_org, 'conv_cr', 'agent_x', true, v_cli, 1, NULL);
  r := public.agent_creneaux_contexte(v_org, 'conv_cr');
  IF r->>'client_id' <> v_cli::text OR r->>'contract_id' <> v_ct::text THEN RAISE EXCEPTION 'contexte inattendu : %', r; END IF;
  r := public.agent_creneaux_contexte(v_org, 'autre_conv');
  IF r->>'erreur' <> 'client_non_verifie' THEN RAISE EXCEPTION 'vérification d''un autre appel réutilisée : %', r; END IF;
  PERFORM public.agent_verification_enregistrer(v_org, 'conv_sc', 'agent_x', true, v_cli2, 1, NULL);
  r := public.agent_creneaux_contexte(v_org, 'conv_sc');
  IF r->>'erreur' <> 'pas_de_contrat' THEN RAISE EXCEPTION 'client sans contrat : %', r; END IF;

  -- Propositions : numérotées par appel, lisibles 30 min, cloisonnées par appel
  r := public.agent_propositions_enregistrer(v_org, 'conv_cr', v_ct, jsonb_build_array(
         jsonb_build_object('date', v_loin, 'technicien_id', v_tech, 'demi', 'matin', 'empreinte', '', 'grand_secteur', NULL),
         jsonb_build_object('date', v_loin, 'technicien_id', v_tech, 'demi', 'apres_midi', 'empreinte', '', 'grand_secteur', 'Gaillac')));
  IF r <> '[1, 2]'::jsonb THEN RAISE EXCEPTION 'numéros inattendus : %', r; END IF;
  r := public.agent_propositions_enregistrer(v_org, 'conv_cr', v_ct, jsonb_build_array(
         jsonb_build_object('date', v_loin, 'technicien_id', v_tech, 'demi', 'matin', 'empreinte', '')));
  IF r <> '[3]'::jsonb THEN RAISE EXCEPTION 'numérotation non poursuivie : %', r; END IF;
  r := public.agent_proposition_lire(v_org, 'conv_cr', 2);
  IF r->>'demi' <> 'apres_midi' OR r->>'grand_secteur' <> 'Gaillac' THEN RAISE EXCEPTION 'lecture : %', r; END IF;
  IF public.agent_proposition_lire(v_org, 'autre_conv', 2) IS NOT NULL THEN RAISE EXCEPTION 'proposition lisible depuis un autre appel'; END IF;
  UPDATE majordhome.agent_propositions SET created_at = now() - interval '31 minutes' WHERE conversation_id = 'conv_cr' AND numero = 3;
  IF public.agent_proposition_lire(v_org, 'conv_cr', 3) IS NOT NULL THEN RAISE EXCEPTION 'proposition expirée encore lisible'; END IF;

  -- auto_rdv_poser : J+40 refusé sans borne (page client inchangée), accepté avec p_date_max
  BEGIN
    PERFORM public.auto_rdv_poser(v_ct, v_tech, v_loin, 'matin', TIME '08:00', TIME '09:30', 90, '', NULL, 'auto_rdv:agent', '[]'::jsonb);
    RAISE EXCEPTION 'pose à J+40 acceptée sans p_date_max';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'hors_mois' THEN RAISE; END IF;
  END;
  r := public.auto_rdv_poser(v_ct, v_tech, v_loin, 'matin', TIME '08:00', TIME '09:30', 90, '', NULL, 'auto_rdv:agent', '[]'::jsonb, current_date + 45);
  IF r->>'appointment_id' IS NULL OR (r->>'carte_creee')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'pose agent : %', r; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments
   WHERE id = (r->>'appointment_id')::uuid AND source = 'auto_rdv:agent' AND scheduled_date = v_loin AND client_id = v_cli;
  IF n <> 1 THEN RAISE EXCEPTION 'RDV agent introuvable'; END IF;
  SELECT count(*) INTO n FROM majordhome.interventions
   WHERE id = (r->>'intervention_id')::uuid AND workflow_status = 'planifie' AND contract_id = v_ct;
  IF n <> 1 THEN RAISE EXCEPTION 'carte d''entretien non planifiée'; END IF;
  -- Second RDV refusé (carte déjà planifiée)
  BEGIN
    PERFORM public.auto_rdv_poser(v_ct, v_tech, v_loin - 1, 'matin', TIME '08:00', TIME '09:30', 90, '', NULL, 'auto_rdv:agent', '[]'::jsonb, current_date + 45);
    RAISE EXCEPTION 'second RDV posé sur une carte déjà planifiée';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('deja_planifie', 'journee_modifiee') THEN RAISE; END IF;
  END;

  RAISE NOTICE 'agent_creneaux OK';
END $$;
