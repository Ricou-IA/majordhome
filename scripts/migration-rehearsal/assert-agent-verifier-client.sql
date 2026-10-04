-- assert-agent-verifier-client.sql — vérifie 20261004_1 (outil verifier_client de l'agent
-- téléphonique) sur le cluster de répétition. Autonome : crée son projet, ses clients et son
-- équipement. Un écart lève une exception.
DO $$
DECLARE
  v_org     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre   uuid;
  v_proj    uuid := '66666666-6666-6666-6666-000000000001';
  v_cli     uuid := '66666666-6666-6666-6666-000000000011';
  v_archive uuid := '66666666-6666-6666-6666-000000000012';
  v_type    uuid;
  r         jsonb;
  n         int;
BEGIN
  -- Structure et droits (effet réel, jamais le texte de la migration)
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.agent_verifications'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'RLS inactive sur agent_verifications';
  END IF;
  IF has_function_privilege('anon', 'public.agent_verifier_client_candidats(uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.agent_verifier_client_candidats(uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.agent_verification_enregistrer(uuid, text, text, boolean, uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.agent_verification_enregistrer(uuid, text, text, boolean, uuid, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC agent_* exécutable par anon ou authenticated (org_id dans le payload ⇒ service_role seul)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.agent_verifier_client_candidats(uuid, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.agent_verification_enregistrer(uuid, text, text, boolean, uuid, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role ne peut pas exécuter les RPC agent_*';
  END IF;
  IF has_table_privilege('authenticated', 'majordhome.agent_verifications', 'INSERT')
     OR has_table_privilege('anon', 'majordhome.agent_verifications', 'SELECT') THEN
    RAISE EXCEPTION 'agent_verifications écrivable par le front ou lisible par anon';
  END IF;

  -- Données (numéro fictif 06 99 99 01 01, absent de la prod) : un client au téléphone stocké SANS zéro (import Excel), un archivé au même numéro.
  -- client_number explicite : la séquence du cluster n'est pas recalée sur les données copiées.
  INSERT INTO core.projects (id, org_id, name, status) VALUES (v_proj, v_org, 'TEST AGENT', 'active'),
    ('66666666-6666-6666-6666-000000000002', v_org, 'TEST AGENT ARCHIVE', 'active');
  INSERT INTO majordhome.clients (id, org_id, project_id, last_name, display_name, phone, address, city, is_archived, client_number)
  VALUES (v_cli, v_org, v_proj, 'AGENTTEST', 'AGENTTEST', '699990101', '7 bis Rte des Bardys', 'Gaillac', false, 'AGENT-T1'),
         (v_archive, v_org, '66666666-6666-6666-6666-000000000002', 'AGENTTEST', 'AGENTTEST', '06 99 99 01 01', '7 bis Rte des Bardys', 'Gaillac', true, 'AGENT-T2');
  SELECT id INTO v_type FROM majordhome.pricing_equipment_types WHERE org_id = v_org AND is_active ORDER BY sort_order LIMIT 1;
  INSERT INTO majordhome.equipments (project_id, equipment_type_id, brand, category, status)
  VALUES (v_proj, v_type, 'Okofen', 'autre', 'active');

  r := public.agent_verifier_client_candidats(v_org, 'conv_test', '0699990101');
  IF (r->>'tentatives')::int <> 0 THEN RAISE EXCEPTION 'tentatives initiales = % (attendu 0)', r->>'tentatives'; END IF;
  IF jsonb_array_length(r->'candidats') <> 1 THEN
    RAISE EXCEPTION '% candidat(s) pour 0699990101 (attendu 1 : le client actif, pas l''archivé)', jsonb_array_length(r->'candidats');
  END IF;
  IF r->'candidats'->0->>'client_id' <> v_cli::text THEN RAISE EXCEPTION 'mauvais candidat'; END IF;
  IF jsonb_array_length(r->'candidats'->0->'equipements') <> 1
     OR r->'candidats'->0->'equipements'->>0 NOT LIKE '%Okofen' THEN
    RAISE EXCEPTION 'équipements inattendus : %', r->'candidats'->0->'equipements';
  END IF;
  IF (r->'candidats'->0->>'contrat_actif')::boolean THEN RAISE EXCEPTION 'contrat_actif vrai sans contrat'; END IF;

  -- Autre numéro : aucun candidat ; numéro mal formé : refus
  r := public.agent_verifier_client_candidats(v_org, 'conv_test', '0600000000');
  IF jsonb_array_length(r->'candidats') <> 0 THEN RAISE EXCEPTION 'candidat fantôme sur un numéro inconnu'; END IF;
  BEGIN
    PERFORM public.agent_verifier_client_candidats(v_org, 'conv_test', '699990101');
    RAISE EXCEPTION 'numéro non normalisé accepté';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Une autre org ne voit pas ce client
  SELECT id INTO v_autre FROM core.organizations WHERE id <> v_org LIMIT 1;
  IF v_autre IS NOT NULL THEN
    r := public.agent_verifier_client_candidats(v_autre, 'conv_test', '0699990101');
    IF jsonb_array_length(r->'candidats') <> 0 THEN RAISE EXCEPTION 'fuite cross-org : candidat visible depuis une autre org'; END IF;
    BEGIN
      PERFORM public.agent_verification_enregistrer(v_autre, 'conv_x', 'agent_x', true, v_cli, 1, NULL);
      RAISE EXCEPTION 'client d''une autre org journalisé comme vérifié';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END IF;

  -- Journal : compte les tentatives par conversation
  PERFORM public.agent_verification_enregistrer(v_org, 'conv_test', 'agent_x', false, NULL, 1, 'adresse');
  PERFORM public.agent_verification_enregistrer(v_org, 'conv_test', 'agent_x', true, v_cli, 1, NULL);
  r := public.agent_verifier_client_candidats(v_org, 'conv_test', '0699990101');
  IF (r->>'tentatives')::int <> 2 THEN RAISE EXCEPTION 'tentatives = % (attendu 2)', r->>'tentatives'; END IF;

  -- Incohérence verdict / motif refusée par la table
  BEGIN
    PERFORM public.agent_verification_enregistrer(v_org, 'conv_test', 'agent_x', true, v_cli, 1, 'nom');
    RAISE EXCEPTION 'vérifié avec un motif d''échec accepté';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  SELECT count(*) INTO n FROM majordhome.agent_verifications WHERE conversation_id = 'conv_test';
  RAISE NOTICE 'agent_verifier_client OK — % tentative(s) journalisée(s)', n;
END $$;
