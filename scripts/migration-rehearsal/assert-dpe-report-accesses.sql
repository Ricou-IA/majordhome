-- assert-dpe-report-accesses.sql — vérifie 20261112_1_dpe_report_accesses.sql.
-- Couvre : RLS active ; anon ne lit ni la table ni la vue ; authenticated lit mais n'écrit pas ; la RPC n'est
-- exécutable que par service_role ; deux enregistrements pour le même (org, numéro) → une ligne, jeton remplacé ;
-- client d'une autre organisation refusé ; un membre d'une autre organisation lit zéro ligne par la vue.
-- Fixture nettoyée en fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;
  v_client uuid;
  v_membre uuid;
  v_etranger uuid := gen_random_uuid();
  v_n int;
  v_token text;
  ok boolean;
  sig text := 'public.dpe_report_access_record(uuid, uuid, text, text, text, uuid)';
BEGIN
  -- (0) structure et privilèges
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.dpe_report_accesses'::regclass) THEN
    RAISE EXCEPTION 'RLS inactive sur dpe_report_accesses';
  END IF;
  IF has_table_privilege('anon', 'majordhome.dpe_report_accesses', 'SELECT') OR has_table_privilege('anon', 'public.majordhome_dpe_report_accesses', 'SELECT') THEN
    RAISE EXCEPTION 'anon lit les accès DPE';
  END IF;
  IF has_table_privilege('authenticated', 'majordhome.dpe_report_accesses', 'INSERT')
     OR has_table_privilege('authenticated', 'majordhome.dpe_report_accesses', 'UPDATE')
     OR has_table_privilege('authenticated', 'majordhome.dpe_report_accesses', 'DELETE')
     OR has_table_privilege('authenticated', 'public.majordhome_dpe_report_accesses', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated peut écrire les accès DPE';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_dpe_report_accesses', 'SELECT')
     OR NOT has_table_privilege('service_role', 'majordhome.dpe_report_accesses', 'SELECT') THEN
    RAISE EXCEPTION 'lecture manquante (authenticated sur la vue ou service_role sur la table)';
  END IF;
  IF has_function_privilege('anon', sig, 'EXECUTE') OR has_function_privilege('authenticated', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'dpe_report_access_record exécutable par anon / authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'dpe_report_access_record non exécutable par service_role';
  END IF;
  IF (SELECT reloptions::text FROM pg_class WHERE oid = 'public.majordhome_dpe_report_accesses'::regclass) NOT LIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION 'vue sans security_invoker';
  END IF;

  -- fixture
  SELECT id INTO v_client FROM majordhome.clients WHERE org_id = v_mayer LIMIT 1;
  IF v_client IS NULL THEN RAISE EXCEPTION 'fixture : aucun client Mayer dans le snapshot'; END IF;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'fixture : aucun membre Mayer dans le snapshot'; END IF;
  INSERT INTO core.organizations (name) VALUES ('TEST DPE autre org') RETURNING id INTO v_autre;

  -- (1) idempotence : deux enregistrements, une ligne, le jeton suit
  PERFORM public.dpe_report_access_record(v_mayer, v_client, '2662E2065219C', 'jeton-1', 'https://exemple/1', v_membre);
  PERFORM public.dpe_report_access_record(v_mayer, NULL, '2662E2065219C', 'jeton-2', 'https://exemple/2', v_membre);
  SELECT count(*), max(token) INTO v_n, v_token FROM majordhome.dpe_report_accesses WHERE org_id = v_mayer AND dpe_number = '2662E2065219C';
  IF v_n <> 1 OR v_token <> 'jeton-2' THEN RAISE EXCEPTION 'idempotence : % ligne(s), jeton %', v_n, v_token; END IF;
  IF (SELECT client_id FROM majordhome.dpe_report_accesses WHERE org_id = v_mayer AND dpe_number = '2662E2065219C') IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'un client NULL au second appel a effacé le client du premier';
  END IF;

  -- (2) client d'une autre organisation refusé
  ok := false;
  BEGIN
    PERFORM public.dpe_report_access_record(v_autre, v_client, '2669E2067091J', 'jeton-x', 'https://exemple/x', NULL);
  EXCEPTION WHEN OTHERS THEN ok := (SQLERRM = 'dpe_report_access_client_org_mismatch');
  END;
  IF NOT ok THEN RAISE EXCEPTION 'client d''une autre organisation accepté'; END IF;

  -- (3) numéro mal formé refusé par le CHECK
  ok := false;
  BEGIN
    PERFORM public.dpe_report_access_record(v_mayer, NULL, 'trop-court', 'jeton-y', 'https://exemple/y', NULL);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'numéro mal formé accepté'; END IF;

  -- (4) RLS : un membre lit sa ligne, un étranger ne lit rien
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.majordhome_dpe_report_accesses WHERE dpe_number = '2662E2065219C';
  RESET ROLE;
  IF v_n <> 1 THEN RAISE EXCEPTION 'un membre Mayer lit % ligne(s) au lieu de 1', v_n; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.majordhome_dpe_report_accesses;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'un utilisateur hors organisation lit % ligne(s)', v_n; END IF;

  -- nettoyage
  DELETE FROM majordhome.dpe_report_accesses WHERE org_id IN (v_mayer, v_autre) AND dpe_number IN ('2662E2065219C', '2669E2067091J');
  DELETE FROM core.organizations WHERE id = v_autre;

  RAISE NOTICE 'assert-dpe-report-accesses : OK';
END $$;
