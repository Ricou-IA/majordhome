-- Assertions 20261005_1 — commercial_set_for_user
DO $$
DECLARE
  v_org   uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid;
  v_tech  uuid;
  v_other uuid;
  v_id    uuid;
  v_id2   uuid;
  v_n     int;
BEGIN
  -- ACL : anon/PUBLIC sans EXECUTE, authenticated avec
  IF has_function_privilege('anon', 'public.commercial_set_for_user(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon peut exécuter commercial_set_for_user';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.commercial_set_for_user(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ne peut pas exécuter commercial_set_for_user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='majordhome' AND tablename='commercials' AND indexname='commercials_org_profile_uniq') THEN
    RAISE EXCEPTION 'index commercials_org_profile_uniq absent';
  END IF;

  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_org AND role = 'org_admin' LIMIT 1;
  SELECT om.user_id INTO v_tech FROM core.organization_members om
   WHERE om.org_id = v_org AND om.role <> 'org_admin'
     AND NOT EXISTS (SELECT 1 FROM majordhome.commercials c WHERE c.org_id = v_org AND c.profile_id = om.user_id)
   LIMIT 1;
  IF v_admin IS NULL OR v_tech IS NULL THEN RAISE EXCEPTION 'fixtures insuffisantes'; END IF;

  -- Sans auth.uid() : refus
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.commercial_set_for_user(v_org, v_tech, true);
    RAISE EXCEPTION 'appel anonyme accepté';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Non admin : refus
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  BEGIN
    PERFORM public.commercial_set_for_user(v_org, v_tech, true);
    RAISE EXCEPTION 'appel non-admin accepté';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Admin : création, idempotence, désactivation sans DELETE
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_id := public.commercial_set_for_user(v_org, v_tech, true);
  IF v_id IS NULL THEN RAISE EXCEPTION 'création : aucun id'; END IF;
  SELECT count(*) INTO v_n FROM majordhome.commercials WHERE org_id = v_org AND profile_id = v_tech AND is_active;
  IF v_n <> 1 THEN RAISE EXCEPTION 'création : % lignes actives', v_n; END IF;

  v_id2 := public.commercial_set_for_user(v_org, v_tech, true);
  IF v_id2 <> v_id THEN RAISE EXCEPTION 'idempotence : nouvelle ligne %', v_id2; END IF;

  v_id2 := public.commercial_set_for_user(v_org, v_tech, false);
  IF v_id2 <> v_id THEN RAISE EXCEPTION 'désactivation : id %', v_id2; END IF;
  SELECT count(*) INTO v_n FROM majordhome.commercials WHERE id = v_id AND is_active = false;
  IF v_n <> 1 THEN RAISE EXCEPTION 'désactivation : ligne supprimée ou toujours active'; END IF;

  -- Membre d'une autre org (ou inconnu) : refus
  v_other := gen_random_uuid();
  BEGIN
    PERFORM public.commercial_set_for_user(v_org, v_other, true);
    RAISE EXCEPTION 'non-membre accepté';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Les 2 lignes historiques (Michel, Philippe) sont intactes
  SELECT count(*) INTO v_n FROM majordhome.commercials WHERE org_id = v_org AND is_active AND profile_id IS NOT NULL AND profile_id <> v_tech;
  IF v_n < 2 THEN RAISE EXCEPTION 'lignes historiques touchées (% actives)', v_n; END IF;

  RAISE NOTICE 'assert-commercial-set-for-user OK';
END $$;
