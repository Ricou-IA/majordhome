-- assert-exec-sql-revoke.sql — vérifie 20260922_3_exec_sql_revoke.sql sur le cluster de répétition.
-- Un écart lève une exception → run.mjs sort en ECHEC.
-- Mesure l'EFFET (has_function_privilege), jamais le texte de la migration.

DO $$
DECLARE
  v_secdef boolean;
  v_res jsonb;
BEGIN
  -- A. La fonction existe et reste SECURITY INVOKER (P0.0.1 conservé)
  SELECT prosecdef INTO v_secdef FROM pg_proc WHERE oid = 'public.exec_sql(text)'::regprocedure;
  IF v_secdef IS DISTINCT FROM false THEN RAISE EXCEPTION 'exec_sql attendu SECURITY INVOKER (prosecdef=%)', v_secdef; END IF;

  -- B. Plus d'EXECUTE pour anon ni authenticated
  IF has_function_privilege('anon', 'public.exec_sql(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exec_sql exécutable par anon';
  END IF;
  IF has_function_privilege('authenticated', 'public.exec_sql(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exec_sql exécutable par authenticated';
  END IF;

  -- C. service_role conserve l'EXECUTE (snapshot.mjs du harnais)
  IF NOT has_function_privilege('service_role', 'public.exec_sql(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exec_sql plus exécutable par service_role';
  END IF;

  -- D. Preuve par l'appel : anon est refusé (42501), service_role passe.
  --    Les rôles du cluster sont NOLOGIN → SET ROLE depuis postgres.
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.exec_sql('select 1 as x');
    RAISE EXCEPTION 'anon a pu appeler exec_sql';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- attendu
  END;
  RESET ROLE;

  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT public.exec_sql('select 1 as x') INTO v_res;
  RESET ROLE;
  IF v_res IS DISTINCT FROM '[{"x": 1}]'::jsonb THEN
    RAISE EXCEPTION 'service_role : résultat inattendu %', v_res;
  END IF;

  RAISE NOTICE 'assert-exec-sql-revoke : OK';
END $$;
