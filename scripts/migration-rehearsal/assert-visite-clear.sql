-- assert-visite-clear.sql — vérifie 20261010_4_maintenance_visit_clear.sql sur le cluster de répétition.
-- maintenance_visits / contracts / interventions / appointments sont photographiées sans données :
-- on pose un contrat + une carte d'essai par scénario, on saisit une visite comme le ferait le
-- bloc « Visites d'entretien » (le trigger bascule la carte), puis on efface par la RPC.

-- ── A. Structure / ACL ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.maintenance_visit_clear(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'maintenance_visit_clear exécutable par anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.maintenance_visit_clear(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'maintenance_visit_clear non exécutable par authenticated';
  END IF;
END $$;

-- ── B. Comportement ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_org uuid; v_client uuid; v_project uuid; v_admin uuid;
  v_clients uuid[]; -- 1 contrat par client (contracts_client_id_key) → un client par scénario
  v_mdh_org uuid;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_year int := date_part('year', v_today)::int;
  v_contract uuid; v_card uuid; v_child uuid; v_visit uuid;
  v_wf text; v_status text; v_sched date; v_report timestamptz; v_ok boolean; v_res jsonb;
BEGIN
  SELECT c.org_id INTO v_org FROM majordhome.clients c WHERE c.project_id IS NOT NULL LIMIT 1;
  v_clients := ARRAY(SELECT c.id FROM majordhome.clients c WHERE c.org_id = v_org AND c.project_id IS NOT NULL ORDER BY c.created_at LIMIT 6);
  IF array_length(v_clients, 1) < 6 THEN RAISE EXCEPTION 'moins de 6 clients avec projet dans le snapshot'; END IF;
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_org AND om.role = 'org_admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'aucun org_admin dans le snapshot pour %', v_org; END IF;
  SELECT id INTO v_mdh_org FROM majordhome.organizations WHERE core_org_id = v_org LIMIT 1;
  IF v_mdh_org IS NULL THEN v_mdh_org := v_org; END IF;

  -- ── 1. Anonyme : refusé ──────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_ok := false;
  BEGIN
    PERFORM public.maintenance_visit_clear(gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(1) anonyme non refusé'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- ── 2. Carte Planifié avec RDV, visite réalisée saisie par erreur ────────
  v_client := v_clients[1]; SELECT project_id INTO v_project FROM majordhome.clients WHERE id = v_client;
  v_contract := gen_random_uuid(); v_card := gen_random_uuid();
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency) VALUES (v_contract, v_org, v_client, 'active', 'annuel');
  INSERT INTO majordhome.interventions (id, project_id, client_id, contract_id, intervention_type, workflow_status, status, scheduled_date)
    VALUES (v_card, v_project, v_client, v_contract, 'entretien', 'planifie', 'scheduled', v_today + 5);
  INSERT INTO majordhome.appointments (org_id, client_id, intervention_id, scheduled_date, scheduled_start, appointment_type, status)
    VALUES (v_mdh_org, v_client, v_card, v_today + 5, '09:00', 'maintenance', 'scheduled');
  INSERT INTO majordhome.maintenance_visits (org_id, contract_id, visit_year, visit_date, status)
    VALUES (v_org, v_contract, v_year, v_today, 'completed') RETURNING id INTO v_visit;
  SELECT workflow_status INTO v_wf FROM majordhome.interventions WHERE id = v_card;
  IF v_wf <> 'realise' THEN RAISE EXCEPTION '(2) prérequis : la saisie devait basculer la carte (wf=%)', v_wf; END IF;

  v_res := public.maintenance_visit_clear(v_visit);
  IF EXISTS (SELECT 1 FROM majordhome.maintenance_visits WHERE id = v_visit) THEN RAISE EXCEPTION '(2) visite non effacée'; END IF;
  SELECT workflow_status, status::text, scheduled_date, report_date INTO v_wf, v_status, v_sched, v_report FROM majordhome.interventions WHERE id = v_card;
  IF v_wf <> 'planifie' OR v_status <> 'scheduled' OR v_sched <> v_today + 5 OR v_report IS NOT NULL THEN
    RAISE EXCEPTION '(2) carte attendue planifie/scheduled/%/NULL, obtenu %/%/%/%', v_today + 5, v_wf, v_status, v_sched, v_report;
  END IF;
  IF v_res->>'card_reverted_to' <> 'planifie' THEN RAISE EXCEPTION '(2) retour RPC : %', v_res; END IF;

  -- ── 3. Carte À planifier sans RDV ────────────────────────────────────────
  v_client := v_clients[2]; SELECT project_id INTO v_project FROM majordhome.clients WHERE id = v_client;
  v_contract := gen_random_uuid(); v_card := gen_random_uuid();
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency) VALUES (v_contract, v_org, v_client, 'active', 'annuel');
  INSERT INTO majordhome.interventions (id, project_id, client_id, contract_id, intervention_type, workflow_status, status)
    VALUES (v_card, v_project, v_client, v_contract, 'entretien', 'a_planifier', 'scheduled');
  INSERT INTO majordhome.maintenance_visits (org_id, contract_id, visit_year, visit_date, status, intervention_id)
    VALUES (v_org, v_contract, v_year, v_today - 1, 'completed', v_card) RETURNING id INTO v_visit;
  v_res := public.maintenance_visit_clear(v_visit);
  SELECT workflow_status, status::text, scheduled_date, report_date INTO v_wf, v_status, v_sched, v_report FROM majordhome.interventions WHERE id = v_card;
  IF v_wf <> 'a_planifier' OR v_status <> 'scheduled' OR v_sched IS NOT NULL OR v_report IS NOT NULL THEN
    RAISE EXCEPTION '(3) carte attendue a_planifier/scheduled/NULL/NULL, obtenu %/%/%/%', v_wf, v_status, v_sched, v_report;
  END IF;
  IF v_res->>'card_reverted_to' <> 'a_planifier' THEN RAISE EXCEPTION '(3) retour RPC : %', v_res; END IF;

  -- ── 4. Refus client : la carte n'a pas bougé, on n'y touche pas ──────────
  v_client := v_clients[3]; SELECT project_id INTO v_project FROM majordhome.clients WHERE id = v_client;
  v_contract := gen_random_uuid(); v_card := gen_random_uuid();
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency) VALUES (v_contract, v_org, v_client, 'active', 'annuel');
  INSERT INTO majordhome.interventions (id, project_id, client_id, contract_id, intervention_type, workflow_status, status, scheduled_date)
    VALUES (v_card, v_project, v_client, v_contract, 'entretien', 'planifie', 'scheduled', v_today + 3);
  INSERT INTO majordhome.maintenance_visits (org_id, contract_id, visit_year, visit_date, status, notes)
    VALUES (v_org, v_contract, v_year, v_today, 'cancelled', 'Erreur de clic') RETURNING id INTO v_visit;
  v_res := public.maintenance_visit_clear(v_visit);
  IF EXISTS (SELECT 1 FROM majordhome.maintenance_visits WHERE id = v_visit) THEN RAISE EXCEPTION '(4) refus non effacé'; END IF;
  SELECT workflow_status, scheduled_date INTO v_wf, v_sched FROM majordhome.interventions WHERE id = v_card;
  IF v_wf <> 'planifie' OR v_sched <> v_today + 3 THEN RAISE EXCEPTION '(4) carte modifiée (%/%)', v_wf, v_sched; END IF;
  IF v_res->>'card_reverted_to' IS NOT NULL THEN RAISE EXCEPTION '(4) retour RPC : %', v_res; END IF;

  -- ── 5. Année passée : historique seulement, carte intacte ────────────────
  INSERT INTO majordhome.maintenance_visits (org_id, contract_id, visit_year, visit_date, status)
    VALUES (v_org, v_contract, v_year - 1, make_date(v_year - 1, 6, 15), 'completed') RETURNING id INTO v_visit;
  UPDATE majordhome.interventions SET workflow_status = 'realise', status = 'completed' WHERE id = v_card;
  v_res := public.maintenance_visit_clear(v_visit);
  IF EXISTS (SELECT 1 FROM majordhome.maintenance_visits WHERE id = v_visit) THEN RAISE EXCEPTION '(5) visite passée non effacée'; END IF;
  SELECT workflow_status INTO v_wf FROM majordhome.interventions WHERE id = v_card;
  IF v_wf <> 'realise' THEN RAISE EXCEPTION '(5) carte modifiée par une visite d''année passée (%)', v_wf; END IF;

  -- ── 6. Certificat signé : la visite vient du terrain, refus ───────────────
  v_client := v_clients[4]; SELECT project_id INTO v_project FROM majordhome.clients WHERE id = v_client;
  v_contract := gen_random_uuid(); v_card := gen_random_uuid(); v_child := gen_random_uuid();
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency) VALUES (v_contract, v_org, v_client, 'active', 'annuel');
  INSERT INTO majordhome.interventions (id, project_id, client_id, contract_id, intervention_type, workflow_status, status)
    VALUES (v_card, v_project, v_client, v_contract, 'entretien', 'planifie', 'scheduled');
  INSERT INTO majordhome.interventions (id, project_id, client_id, contract_id, parent_id, intervention_type, workflow_status, status)
    VALUES (v_child, v_project, v_client, v_contract, v_card, 'entretien', 'realise', 'completed');
  INSERT INTO majordhome.certificats (intervention_id, client_id, org_id, contract_id, equipement_type, date_intervention, statut, type_document)
    VALUES (v_child, v_client, v_org, v_contract, 'poele', v_today, 'signe', 'entretien_ramonage');
  INSERT INTO majordhome.maintenance_visits (org_id, contract_id, visit_year, visit_date, status)
    VALUES (v_org, v_contract, v_year, v_today, 'completed') RETURNING id INTO v_visit;
  v_ok := false;
  BEGIN
    PERFORM public.maintenance_visit_clear(v_visit);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'certificat_signe' THEN RAISE EXCEPTION '(6) erreur inattendue : %', SQLERRM; END IF;
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(6) certificat signé : effacement accepté'; END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.maintenance_visits WHERE id = v_visit) THEN RAISE EXCEPTION '(6) visite effacée malgré le refus'; END IF;

  -- ── 7. Carte facturée : refus ────────────────────────────────────────────
  v_client := v_clients[5]; SELECT project_id INTO v_project FROM majordhome.clients WHERE id = v_client;
  v_contract := gen_random_uuid(); v_card := gen_random_uuid();
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency) VALUES (v_contract, v_org, v_client, 'active', 'annuel');
  INSERT INTO majordhome.interventions (id, project_id, client_id, contract_id, intervention_type, workflow_status, status)
    VALUES (v_card, v_project, v_client, v_contract, 'entretien', 'planifie', 'scheduled');
  INSERT INTO majordhome.maintenance_visits (org_id, contract_id, visit_year, visit_date, status)
    VALUES (v_org, v_contract, v_year, v_today, 'completed') RETURNING id INTO v_visit;
  UPDATE majordhome.interventions SET workflow_status = 'facture' WHERE id = v_card;
  v_ok := false;
  BEGIN
    PERFORM public.maintenance_visit_clear(v_visit);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'visite_facturee' THEN RAISE EXCEPTION '(7) erreur inattendue : %', SQLERRM; END IF;
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(7) facturé : effacement accepté'; END IF;
  SELECT workflow_status INTO v_wf FROM majordhome.interventions WHERE id = v_card;
  IF v_wf <> 'facture' THEN RAISE EXCEPTION '(7) carte facturée modifiée (%)', v_wf; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-visite-clear : OK';
END $$;
