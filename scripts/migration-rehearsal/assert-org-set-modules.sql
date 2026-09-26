-- assert-org-set-modules.sql — vérifie 20260926_1_org_set_modules.sql sur le cluster de répétition.
-- Couvre : privilèges (service_role seul exécute ; journal invisible des membres), fusion dans
-- settings.modules sans toucher aux autres clés, refus des corps invalides, org inconnue, journal.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_avant jsonb; v_apres jsonb; v_res jsonb; n int; ok boolean;
BEGIN
  IF has_function_privilege('anon', 'public.org_set_modules(uuid, jsonb, text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute org_set_modules'; END IF;
  IF has_function_privilege('authenticated', 'public.org_set_modules(uuid, jsonb, text)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute org_set_modules'; END IF;
  IF NOT has_function_privilege('service_role', 'public.org_set_modules(uuid, jsonb, text)', 'EXECUTE') THEN RAISE EXCEPTION 'service_role ne peut pas exécuter org_set_modules'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.org_modules_journal', 'SELECT') THEN RAISE EXCEPTION 'authenticated lit le journal'; END IF;
  IF has_table_privilege('anon', 'majordhome.org_modules_journal', 'SELECT') THEN RAISE EXCEPTION 'anon lit le journal'; END IF;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relname = 'org_modules_journal' AND c.relrowsecurity;
  IF n <> 1 THEN RAISE EXCEPTION 'RLS inactive sur le journal'; END IF;

  SELECT settings INTO v_avant FROM core.organizations WHERE id = v_mayer;
  IF v_avant IS NULL THEN RAISE EXCEPTION 'fixture : org Mayer absente du snapshot'; END IF;

  SET LOCAL ROLE service_role;
  v_res := public.org_set_modules(v_mayer, '{"maintenance": true, "solaire": false}'::jsonb, 'eric@test');
  RESET ROLE;

  SELECT settings INTO v_apres FROM core.organizations WHERE id = v_mayer;
  IF (v_apres->'modules'->>'maintenance')::boolean IS NOT TRUE OR (v_apres->'modules'->>'solaire')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'modules non fusionnés : %', v_apres->'modules';
  END IF;
  IF (v_avant->'modules' ? 'communication') AND (v_apres->'modules'->'communication') IS DISTINCT FROM (v_avant->'modules'->'communication') THEN
    RAISE EXCEPTION 'drapeau existant écrasé';
  END IF;
  IF (v_apres - 'modules') IS DISTINCT FROM (v_avant - 'modules') THEN RAISE EXCEPTION 'autres clés de settings modifiées'; END IF;
  IF v_res->>'nom' IS NULL OR (v_res->'modules'->>'maintenance')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'réponse inattendue : %', v_res; END IF;

  SELECT count(*) INTO n FROM majordhome.org_modules_journal WHERE org_id = v_mayer AND auteur = 'eric@test' AND demande = '{"maintenance": true, "solaire": false}'::jsonb;
  IF n <> 1 THEN RAISE EXCEPTION 'journal absent'; END IF;

  SET LOCAL ROLE service_role;
  ok := false;
  BEGIN PERFORM public.org_set_modules(v_mayer, '{}'::jsonb, 'x'); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'objet vide accepté'; END IF;
  ok := false;
  BEGIN PERFORM public.org_set_modules(v_mayer, '{"crm": "false"}'::jsonb, 'x'); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'valeur non booléenne acceptée'; END IF;
  ok := false;
  BEGIN PERFORM public.org_set_modules(v_mayer, '[true]'::jsonb, 'x'); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'tableau accepté'; END IF;
  ok := false;
  BEGIN PERFORM public.org_set_modules(gen_random_uuid(), '{"crm": true}'::jsonb, 'x'); EXCEPTION WHEN SQLSTATE 'P0002' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'org inconnue acceptée'; END IF;
  RESET ROLE;

  RAISE NOTICE 'org_set_modules : OK';
END;
$$;
