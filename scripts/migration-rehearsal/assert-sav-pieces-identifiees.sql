-- assert-sav-pieces-identifiees.sql — vérifie 20261113_5_sav_pieces_identifiees.sql (pièces identifiées sur une carte SAV).
-- Table majordhome.sav_part_selections + vue public.majordhome_sav_part_selections (miroir simple, security_invoker).
-- Org Mayer = org CORE (3c68…). Impersonation : membre Mayer qui n'est ni org_admin ni team_leader ni Commercial (donc
-- technicien effectif, sans profil maison), choisi dans le snapshot ; si le snapshot n'en a pas, l'assertion le dit.
-- SET LOCAL ROLE authenticated + request.jwt.claim.sub (stub auth.uid()). Fixtures supprimées en fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;
  v_tech uuid;
  v_eq uuid;
  v_cli uuid; v_proj uuid;
  v_cli_a uuid; v_proj_a uuid;
  v_inter uuid; v_inter_a uuid;
  v_n int;
  v_q numeric;
  v_ok boolean;
  p text;
BEGIN
  -- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────
  SELECT om.user_id INTO v_tech FROM core.organization_members om LEFT JOIN core.profiles pr ON pr.id = om.user_id
  WHERE om.org_id = v_mayer AND om.role NOT IN ('org_admin', 'team_leader')
    AND coalesce(pr.app_role, '') NOT IN ('org_admin', 'team_leader') AND lower(coalesce(pr.business_role, '')) <> 'commercial'
    AND NOT EXISTS (SELECT 1 FROM majordhome.member_org_roles m WHERE m.user_id = om.user_id AND m.org_id = om.org_id)
  LIMIT 1;
  IF v_tech IS NULL THEN RAISE EXCEPTION 'fixture : aucun technicien Mayer (sans profil maison) dans le snapshot'; END IF;
  SELECT e.id INTO v_eq FROM majordhome.equipments e WHERE majordhome.project_org_id(e.project_id) = v_mayer LIMIT 1;
  IF v_eq IS NULL THEN RAISE EXCEPTION 'fixture : aucun équipement Mayer'; END IF;
  SELECT c.org_id, c.id, c.project_id INTO v_autre, v_cli_a, v_proj_a FROM majordhome.clients c
  WHERE c.org_id <> v_mayer AND c.project_id IS NOT NULL LIMIT 1;
  SELECT c.id, c.project_id INTO v_cli, v_proj FROM majordhome.clients c WHERE c.org_id = v_mayer AND c.project_id IS NOT NULL LIMIT 1;
  IF v_cli IS NULL OR v_cli_a IS NULL THEN RAISE EXCEPTION 'fixture : il faut un client Mayer et un client d''une autre org'; END IF;
  INSERT INTO majordhome.interventions (project_id, client_id, intervention_type) VALUES (v_proj, v_cli, 'sav') RETURNING id INTO v_inter;
  INSERT INTO majordhome.interventions (project_id, client_id, intervention_type) VALUES (v_proj_a, v_cli_a, 'sav') RETURNING id INTO v_inter_a;

  -- ── 1. structure : vue security_invoker + insérable, privilèges ──────────────────────────────────────────
  IF to_regclass('public.majordhome_sav_part_selections') IS NULL THEN RAISE EXCEPTION '(1) vue absente'; END IF;
  IF ((SELECT array_to_string(c.reloptions, ',') FROM pg_class c WHERE c.oid = 'public.majordhome_sav_part_selections'::regclass)
      LIKE '%security_invoker=true%') IS NOT TRUE THEN
    RAISE EXCEPTION '(1) vue sans security_invoker';
  END IF;
  IF (SELECT is_insertable_into FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'majordhome_sav_part_selections') IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '(1) vue non insérable';
  END IF;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF has_table_privilege('anon', 'public.majordhome_sav_part_selections', p) THEN RAISE EXCEPTION '(1) anon a % sur la vue', p; END IF;
    IF has_table_privilege('anon', 'majordhome.sav_part_selections', p) THEN RAISE EXCEPTION '(1) anon a % sur la table', p; END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'majordhome.sav_part_selections', 'SELECT') THEN RAISE EXCEPTION '(1) service_role sans SELECT sur la table'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.sav_part_selections'::regclass) THEN RAISE EXCEPTION '(1) RLS non activée'; END IF;

  -- ── 2. technicien membre : INSERT sur une carte SAV de son org ───────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_tech, 'role', 'authenticated')::text, true);
  INSERT INTO public.majordhome_sav_part_selections (org_id, intervention_id, equipment_id, piece_reference, piece_name, repere, quantity)
  VALUES (v_mayer, v_inter, v_eq, 'REF-TEST-1', 'Joint de porte', '12', 1);
  SELECT count(*) INTO v_n FROM public.majordhome_sav_part_selections WHERE intervention_id = v_inter;
  IF v_n <> 1 THEN RAISE EXCEPTION '(2) pièce insérée non relue par la vue (% ligne)', v_n; END IF;
  IF (SELECT added_by FROM public.majordhome_sav_part_selections WHERE intervention_id = v_inter) IS DISTINCT FROM v_tech THEN
    RAISE EXCEPTION '(2) added_by n''est pas auth.uid()';
  END IF;

  -- ── 3. org forgé / intervention d'une autre org : refusés ────────────────────────────────────────────────
  v_ok := false;
  BEGIN
    INSERT INTO public.majordhome_sav_part_selections (org_id, intervention_id, equipment_id, piece_reference, quantity)
    VALUES (v_autre, v_inter, v_eq, 'REF-TEST-2', 1);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(3) un org_id forgé (autre org) est accepté'; END IF;
  v_ok := false;
  BEGIN
    INSERT INTO public.majordhome_sav_part_selections (org_id, intervention_id, equipment_id, piece_reference, quantity)
    VALUES (v_mayer, v_inter_a, v_eq, 'REF-TEST-3', 1);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(3) une intervention d''une autre org est acceptée'; END IF;

  -- ── 4. même clé : la quantité est remplacée (1 -> 3, pas 4) ──────────────────────────────────────────────
  INSERT INTO public.majordhome_sav_part_selections (org_id, intervention_id, equipment_id, piece_reference, repere, quantity)
  VALUES (v_mayer, v_inter, v_eq, 'REF-TEST-1', '12', 3)
  ON CONFLICT (intervention_id, equipment_id, piece_reference, repere) DO UPDATE SET quantity = excluded.quantity;
  SELECT count(*), max(quantity) INTO v_n, v_q FROM public.majordhome_sav_part_selections WHERE intervention_id = v_inter;
  IF v_n <> 1 OR v_q <> 3 THEN RAISE EXCEPTION '(4) upsert : % ligne(s), quantité % (1 ligne, 3 attendues)', v_n, v_q; END IF;

  -- ── 5. quantité 0, référence vide : refusées ─────────────────────────────────────────────────────────────
  v_ok := false;
  BEGIN
    INSERT INTO public.majordhome_sav_part_selections (org_id, intervention_id, equipment_id, piece_reference, quantity)
    VALUES (v_mayer, v_inter, v_eq, 'REF-TEST-4', 0);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(5) quantité 0 acceptée'; END IF;
  v_ok := false;
  BEGIN
    INSERT INTO public.majordhome_sav_part_selections (org_id, intervention_id, equipment_id, piece_reference, quantity)
    VALUES (v_mayer, v_inter, v_eq, '   ', 1);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(5) référence vide acceptée'; END IF;

  -- ── 6. sans utilisateur : rien de visible ────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM public.majordhome_sav_part_selections;
  IF v_n <> 0 THEN RAISE EXCEPTION '(6) un appel sans utilisateur voit % pièce(s)', v_n; END IF;
  SET LOCAL ROLE postgres;

  -- ── 7. supprimer la carte SAV supprime ses pièces ────────────────────────────────────────────────────────
  DELETE FROM majordhome.interventions WHERE id = v_inter;
  SELECT count(*) INTO v_n FROM majordhome.sav_part_selections WHERE intervention_id = v_inter;
  IF v_n <> 0 THEN RAISE EXCEPTION '(7) % pièce(s) restent après suppression de la carte', v_n; END IF;

  -- ── Nettoyage ────────────────────────────────────────────────────────────────────────────────────────────
  DELETE FROM majordhome.interventions WHERE id IN (v_inter, v_inter_a);
  RAISE NOTICE 'assert-sav-pieces-identifiees : OK';
END $$;
