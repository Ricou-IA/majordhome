-- assert-visite-date.sql — vérifie 20260928_1_visite_date_jamais_future.sql sur le cluster de répétition.
-- maintenance_visits / contracts / interventions sont photographiées sans données (data: false) :
-- on pose un contrat + une carte d'essai, puis on rejoue les gestes du bloc « Visites d'entretien ».

-- ── A. Structure ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM 1 FROM pg_trigger
   WHERE tgrelid = 'majordhome.maintenance_visits'::regclass AND NOT tgisinternal
     AND tgname = 'trg_maintenance_visit_date_guard'
     AND tgfoid = 'majordhome.maintenance_visit_date_guard()'::regprocedure;
  IF NOT FOUND THEN RAISE EXCEPTION 'trigger de garde absent'; END IF;
  IF has_function_privilege('anon', 'majordhome.maintenance_visit_date_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'garde exécutable par anon';
  END IF;
END $$;

-- ── B. Comportement ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_org uuid; v_client uuid; v_contract uuid := gen_random_uuid(); v_card uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_visit uuid; v_ok boolean; v_wf text; v_project uuid;
BEGIN
  SELECT org_id, id, project_id INTO v_org, v_client, v_project FROM majordhome.clients WHERE project_id IS NOT NULL LIMIT 1;
  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency)
    VALUES (v_contract, v_org, v_client, 'active', 'annuel');
  INSERT INTO majordhome.interventions (id, project_id, contract_id, intervention_type, workflow_status, status, scheduled_date)
    VALUES (v_card, v_project, v_contract, 'entretien', 'planifie', 'scheduled', v_today + 2);

  -- 1. « Programmer » au futur avec statut Réalisé : refusé, la carte ne bouge pas
  v_ok := false;
  BEGIN
    INSERT INTO majordhome.maintenance_visits (org_id, contract_id, visit_year, visit_date, status)
      VALUES (v_org, v_contract, date_part('year', CURRENT_DATE)::int, v_today + 2, 'completed');
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'visite future acceptée à l''INSERT'; END IF;
  SELECT workflow_status INTO v_wf FROM majordhome.interventions WHERE id = v_card;
  IF v_wf <> 'planifie' THEN RAISE EXCEPTION 'carte basculée en % par une visite refusée', v_wf; END IF;

  -- 2. Date du jour : acceptée, la carte passe Réalisé (comportement historique conservé)
  INSERT INTO majordhome.maintenance_visits (org_id, contract_id, visit_year, visit_date, status)
    VALUES (v_org, v_contract, date_part('year', CURRENT_DATE)::int, v_today, 'completed')
    RETURNING id INTO v_visit;
  SELECT workflow_status INTO v_wf FROM majordhome.interventions WHERE id = v_card;
  IF v_wf <> 'realise' THEN RAISE EXCEPTION 'visite du jour : carte en % au lieu de realise', v_wf; END IF;

  -- 3. Déplacer la visite au futur : refusé
  v_ok := false;
  BEGIN
    UPDATE majordhome.maintenance_visits SET visit_date = v_today + 30 WHERE id = v_visit;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'visite déplacée au futur acceptée'; END IF;

  -- 4. Ligne future déjà en base (antérieure à la garde) : modifier la note sans toucher la date
  --    reste possible, et ne bascule pas la carte.
  UPDATE majordhome.interventions SET workflow_status = 'planifie', status = 'scheduled' WHERE id = v_card;
  ALTER TABLE majordhome.maintenance_visits DISABLE TRIGGER trg_maintenance_visit_date_guard;
  UPDATE majordhome.maintenance_visits SET visit_date = v_today + 30 WHERE id = v_visit;
  ALTER TABLE majordhome.maintenance_visits ENABLE TRIGGER trg_maintenance_visit_date_guard;
  UPDATE majordhome.interventions SET workflow_status = 'planifie', status = 'scheduled' WHERE id = v_card;
  UPDATE majordhome.maintenance_visits SET notes = 'RAS', status = 'completed', visit_date = v_today + 30 WHERE id = v_visit;
  SELECT workflow_status INTO v_wf FROM majordhome.interventions WHERE id = v_card;
  IF v_wf <> 'planifie' THEN RAISE EXCEPTION 'visite future existante : carte basculée en %', v_wf; END IF;

  -- 5. Refus client sans date explicite (recordVisit met la date du jour) : accepté
  UPDATE majordhome.maintenance_visits SET status = 'cancelled', visit_date = v_today WHERE id = v_visit;

  RAISE NOTICE 'assert-visite-date : OK';
END $$;
