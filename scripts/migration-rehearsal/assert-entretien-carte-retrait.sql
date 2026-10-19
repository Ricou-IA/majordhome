-- assert-entretien-carte-retrait.sql — vérifie 20261019_2_entretien_carte_sans_contrat_retrait.sql.
-- interventions / appointments / contracts sont photographiées sans données : fixtures posées ici.

DO $$
DECLARE
  v_org uuid; v_mdh_org uuid; v_client uuid; v_project uuid; v_member uuid; v_outsider uuid;
  v_ctr uuid := gen_random_uuid();
  v_orphan uuid := gen_random_uuid(); v_child uuid := gen_random_uuid(); v_rdv_cancel uuid := gen_random_uuid();
  v_with_ctr uuid := gen_random_uuid();
  v_busy uuid := gen_random_uuid(); v_rdv_active uuid := gen_random_uuid();
  v_cert uuid := gen_random_uuid(); v_cert_child uuid := gen_random_uuid();
  v_dem uuid := gen_random_uuid();
  r jsonb; v_refused boolean;
BEGIN
  SELECT c.org_id, c.id, c.project_id INTO v_org, v_client, v_project
    FROM majordhome.clients c
   WHERE c.project_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM core.organization_members om WHERE om.org_id = c.org_id)
   ORDER BY c.id LIMIT 1;
  SELECT id INTO v_mdh_org FROM majordhome.organizations WHERE core_org_id = v_org;
  SELECT user_id INTO v_member FROM core.organization_members WHERE org_id = v_org ORDER BY user_id LIMIT 1;
  SELECT p.id INTO v_outsider FROM core.profiles p
   WHERE NOT EXISTS (SELECT 1 FROM core.organization_members om WHERE om.user_id = p.id AND om.org_id = v_org)
   ORDER BY p.id LIMIT 1;

  -- 0. ACL : anon ne peut pas appeler la RPC, authenticated oui
  IF has_function_privilege('anon', 'public.entretien_card_release_orphan(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon peut exécuter entretien_card_release_orphan';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.entretien_card_release_orphan(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ne peut pas exécuter entretien_card_release_orphan';
  END IF;

  INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency)
    VALUES (v_ctr, v_org, v_client, 'cancelled', 'annuel');
  INSERT INTO majordhome.interventions (id, project_id, client_id, contract_id, parent_id, intervention_type, workflow_status, status) VALUES
    (v_orphan,   v_project, v_client, NULL,  NULL,     'entretien', 'a_planifier',     'scheduled'),
    (v_child,    v_project, v_client, NULL,  v_orphan, 'entretien', 'planifie',        'scheduled'),
    (v_with_ctr, v_project, v_client, v_ctr, NULL,     'entretien', 'a_planifier',     'scheduled'),
    (v_busy,     v_project, v_client, NULL,  NULL,     'entretien', 'planifie',        'scheduled'),
    (v_cert,     v_project, v_client, NULL,  NULL,     'entretien', 'a_planifier',     'scheduled'),
    (v_cert_child, v_project, v_client, NULL, v_cert,  'entretien', 'planifie',        'scheduled'),
    (v_dem,      v_project, v_client, NULL,  NULL,     'entretien', 'demande_contrat', 'scheduled');
  INSERT INTO majordhome.appointments (id, org_id, client_id, intervention_id, appointment_type, status, scheduled_date, scheduled_start) VALUES
    (v_rdv_cancel, v_mdh_org, v_client, v_orphan, 'maintenance', 'cancelled', DATE '2026-10-19', TIME '14:00'),
    (v_rdv_active, v_mdh_org, v_client, v_busy,   'maintenance', 'scheduled', DATE '2026-10-19', TIME '14:00');
  INSERT INTO majordhome.certificats (org_id, client_id, intervention_id, equipement_type, technicien_nom, date_intervention)
    VALUES (v_org, v_client, v_cert_child, 'poele', 'Fixture', current_date);

  -- 1. Sans session : refus
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_refused := false;
  BEGIN
    PERFORM public.entretien_card_release_orphan(v_orphan);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN RAISE EXCEPTION 'appel sans session accepté'; END IF;

  -- 2. Hors de l'org : refus
  IF v_outsider IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
    v_refused := false;
    BEGIN
      PERFORM public.entretien_card_release_orphan(v_orphan);
    EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
    END;
    IF NOT v_refused THEN RAISE EXCEPTION 'appel hors org accepté'; END IF;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);

  -- 3. Cartes conservées, avec leur raison
  r := public.entretien_card_release_orphan(v_with_ctr);
  IF (r->>'released')::boolean OR r->>'reason' <> 'not_orphan' THEN RAISE EXCEPTION 'carte avec contrat : %', r; END IF;
  r := public.entretien_card_release_orphan(v_busy);
  IF (r->>'released')::boolean OR r->>'reason' <> 'active_appointment' THEN RAISE EXCEPTION 'carte avec RDV actif : %', r; END IF;
  r := public.entretien_card_release_orphan(v_cert);
  IF (r->>'released')::boolean OR r->>'reason' <> 'has_content' THEN RAISE EXCEPTION 'carte avec certificat : %', r; END IF;
  r := public.entretien_card_release_orphan(v_dem);
  IF (r->>'released')::boolean OR r->>'reason' <> 'status_demande_contrat' THEN RAISE EXCEPTION 'demande de contrat : %', r; END IF;
  r := public.entretien_card_release_orphan(gen_random_uuid());
  IF (r->>'released')::boolean OR r->>'reason' <> 'not_found' THEN RAISE EXCEPTION 'carte inconnue : %', r; END IF;
  IF (SELECT count(*) FROM majordhome.interventions WHERE id IN (v_with_ctr, v_busy, v_cert, v_cert_child, v_dem)) <> 5 THEN
    RAISE EXCEPTION 'une carte non orpheline a été supprimée';
  END IF;

  -- 4. Carte orpheline vide (enfant vierge + RDV annulé) : retirée
  r := public.entretien_card_release_orphan(v_orphan);
  IF NOT (r->>'released')::boolean THEN RAISE EXCEPTION 'carte orpheline non retirée : %', r; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.interventions WHERE id IN (v_orphan, v_child)) THEN
    RAISE EXCEPTION 'carte ou enfant encore présent';
  END IF;
  IF (SELECT intervention_id FROM majordhome.appointments WHERE id = v_rdv_cancel) IS NOT NULL THEN
    RAISE EXCEPTION 'RDV annulé encore rattaché';
  END IF;

  RAISE NOTICE 'assert-entretien-carte-retrait : OK';
END $$;
