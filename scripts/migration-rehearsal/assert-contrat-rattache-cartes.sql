-- assert-contrat-rattache-cartes.sql — vérifie 20260928_3_contrat_actif_rattache_cartes.sql.
-- contracts / interventions sont photographiées sans données : fixtures posées ici.

DO $$
DECLARE
  v_org uuid; v_client uuid; v_project uuid; v_client2 uuid; v_project2 uuid;
  v_ctr uuid := gen_random_uuid(); v_ctr_ins uuid := gen_random_uuid();
  v_card uuid := gen_random_uuid(); v_done uuid := gen_random_uuid(); v_dem uuid := gen_random_uuid();
  v_card2 uuid := gen_random_uuid();
  r record;
BEGIN
  SELECT org_id, id, project_id INTO v_org, v_client, v_project
    FROM majordhome.clients WHERE project_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id, project_id INTO v_client2, v_project2
    FROM majordhome.clients WHERE project_id IS NOT NULL AND id <> v_client ORDER BY id LIMIT 1;

  -- Contrat résilié + 3 cartes sans contrat : planifiée, réalisée, demande de contrat
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency, end_date)
    VALUES (v_ctr, v_org, v_client, 'cancelled', 'annuel', DATE '2026-02-26');
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, workflow_status, status) VALUES
    (v_card, v_project, v_client, 'entretien', 'planifie', 'scheduled'),
    (v_done, v_project, v_client, 'entretien', 'realise', 'completed'),
    (v_dem,  v_project, v_client, 'entretien', 'demande_contrat', 'scheduled');

  -- 1. Réactivation par effacement de end_date (status posé par le BEFORE, absent du SET)
  UPDATE majordhome.contracts SET end_date = NULL WHERE id = v_ctr;
  SELECT status INTO r FROM majordhome.contracts WHERE id = v_ctr;
  IF r.status <> 'active' THEN RAISE EXCEPTION 'contrat non réactivé (%)', r.status; END IF;

  SELECT contract_id, workflow_status INTO r FROM majordhome.interventions WHERE id = v_card;
  IF r.contract_id IS DISTINCT FROM v_ctr THEN RAISE EXCEPTION 'carte planifiée non rattachée'; END IF;
  SELECT contract_id INTO r FROM majordhome.interventions WHERE id = v_done;
  IF r.contract_id IS NOT NULL THEN RAISE EXCEPTION 'carte réalisée rattachée (historique touché)'; END IF;
  SELECT contract_id, workflow_status INTO r FROM majordhome.interventions WHERE id = v_dem;
  IF r.contract_id IS DISTINCT FROM v_ctr OR r.workflow_status <> 'a_planifier' THEN
    RAISE EXCEPTION 'demande_contrat : rattachement/promotion KO (%, %)', r.contract_id, r.workflow_status;
  END IF;

  -- 2. Contrat INSÉRÉ directement actif (autre client)
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, workflow_status, status)
    VALUES (v_card2, v_project2, v_client2, 'entretien', 'a_planifier', 'scheduled');
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency)
    VALUES (v_ctr_ins, v_org, v_client2, 'active', 'annuel');
  SELECT contract_id INTO r FROM majordhome.interventions WHERE id = v_card2;
  IF r.contract_id IS DISTINCT FROM v_ctr_ins THEN RAISE EXCEPTION 'contrat inséré actif : carte non rattachée'; END IF;

  -- 3. Pas de réaction sur un UPDATE qui ne change pas le statut
  UPDATE majordhome.interventions SET contract_id = NULL WHERE id = v_card;
  UPDATE majordhome.contracts SET frequency = 'annuel' WHERE id = v_ctr;
  SELECT contract_id INTO r FROM majordhome.interventions WHERE id = v_card;
  IF r.contract_id IS NOT NULL THEN RAISE EXCEPTION 'trigger déclenché sans changement de statut'; END IF;

  RAISE NOTICE 'assert-contrat-rattache-cartes : OK';
END $$;
