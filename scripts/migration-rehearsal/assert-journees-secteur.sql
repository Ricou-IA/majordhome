-- assert-journees-secteur.sql — vérifie 20260930_1_journees_secteur_planification_runs.sql
-- sur le cluster de répétition. Un écart lève une exception → run.mjs sort en ECHEC.
-- Couvre : structure, RLS, privilèges, exposition des RPC (cron = service_role only,
-- bouton = authenticated only, interne = personne), garde auth.uid() NULL de la RPC user.

-- ── A. Structure et privilèges ─────────────────────────────────────────────
DO $$
DECLARE n int; r record;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relrowsecurity AND c.relname IN ('journees_secteur', 'planification_runs');
  IF n <> 2 THEN RAISE EXCEPTION 'RLS activée sur % table(s) au lieu de 2', n; END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'planification_runs' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'planification_runs : % policy(ies) d''écriture', n; END IF;

  FOR r IN SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname IN ('majordhome_journees_secteur', 'majordhome_planification_runs') LOOP
    IF coalesce(r.reloptions::text, '') NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'vue % sans security_invoker', r.relname; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM information_schema.views
   WHERE table_schema = 'public' AND table_name = 'majordhome_journees_secteur' AND is_updatable = 'YES';
  IF n <> 1 THEN RAISE EXCEPTION 'majordhome_journees_secteur non updatable'; END IF;

  IF NOT has_table_privilege('service_role', 'majordhome.journees_secteur', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur journees_secteur'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.planification_runs', 'INSERT') THEN RAISE EXCEPTION 'service_role sans INSERT sur planification_runs'; END IF;
  IF has_table_privilege('anon', 'majordhome.journees_secteur', 'SELECT') THEN RAISE EXCEPTION 'anon lit journees_secteur'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_planification_runs', 'SELECT') THEN RAISE EXCEPTION 'anon lit majordhome_planification_runs'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.planification_runs', 'INSERT') THEN RAISE EXCEPTION 'authenticated écrit planification_runs'; END IF;

  IF has_function_privilege('anon', 'public.tournees_figer_journee(uuid, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute tournees_figer_journee'; END IF;
  IF has_function_privilege('authenticated', 'public.tournees_figer_journee(uuid, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute tournees_figer_journee'; END IF;
  IF NOT has_function_privilege('service_role', 'public.tournees_figer_journee(uuid, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'service_role n''exécute pas tournees_figer_journee'; END IF;
  IF has_function_privilege('anon', 'public.tournees_figer_journee_user(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute tournees_figer_journee_user'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.tournees_figer_journee_user(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated n''exécute pas tournees_figer_journee_user'; END IF;
  IF has_function_privilege('authenticated', 'majordhome.figer_journee(uuid, jsonb, text)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute figer_journee interne'; END IF;
  IF has_function_privilege('anon', 'majordhome.figer_journee(uuid, jsonb, text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute figer_journee interne'; END IF;
END $$;

-- ── B. Gardes ───────────────────────────────────────────────────────────────
-- B1. Sans session, la RPC user refuse en première instruction.
DO $$ BEGIN
  BEGIN
    PERFORM public.tournees_figer_journee_user('[{"id":"00000000-0000-0000-0000-000000000000"}]'::jsonb);
    RAISE EXCEPTION 'la RPC user a accepté un appel sans auth.uid()';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'not_authenticated' THEN RAISE EXCEPTION 'attendu not_authenticated, obtenu %', SQLERRM; END IF;
  END;
END $$;

-- B2. La RPC cron refuse une org inconnue (org_not_found) et des arguments invalides.
DO $$ BEGIN
  BEGIN
    PERFORM public.tournees_figer_journee('00000000-0000-0000-0000-000000000000'::uuid, '[]'::jsonb);
    RAISE EXCEPTION 'org inconnue acceptée';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'org_not_found' THEN RAISE EXCEPTION 'attendu org_not_found, obtenu %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.tournees_figer_journee(NULL, '[]'::jsonb);
    RAISE EXCEPTION 'args nuls acceptés';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'invalid_args' THEN RAISE EXCEPTION 'attendu invalid_args, obtenu %', SQLERRM; END IF;
  END;
END $$;

-- B3. Un RDV inconnu est refusé (figes = 0, id dans refuses) sans rien écrire, pour une org existante.
DO $$
DECLARE v_mdh uuid; v_res jsonb;
BEGIN
  SELECT id INTO v_mdh FROM majordhome.organizations LIMIT 1;
  IF v_mdh IS NULL THEN RAISE NOTICE 'aucune org majordhome dans le snapshot : B3 sauté'; RETURN; END IF;
  v_res := public.tournees_figer_journee(v_mdh,
    '[{"id":"00000000-0000-0000-0000-000000000001","attendu":"09:00","scheduled_start":"09:05","scheduled_end":"10:05","duration_minutes":60}]'::jsonb);
  IF (v_res->>'figes')::int <> 0 OR jsonb_array_length(v_res->'refuses') <> 1 THEN
    RAISE EXCEPTION 'RDV inconnu : attendu figes=0 refuses=1, obtenu %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.journees_secteur) THEN RAISE EXCEPTION 'un refus a écrit une étiquette'; END IF;
END $$;
