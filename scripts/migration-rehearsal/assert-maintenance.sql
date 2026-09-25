-- assert-maintenance.sql — vérifie 20260925_1_maintenance_module.sql sur le cluster de répétition.
-- Un écart lève une exception → run.mjs sort en ECHEC.
-- Couvre : structure, RLS, privilèges (dont pin_hash illisible), puis parcours en rôle
-- authenticated : paramétrage org_admin, PIN, 5 échecs ⇒ blocage PERSISTÉ (preuve que la
-- RPC retourne au lieu de lever), réalisation, journal non modifiable, « pas pu faire » sans
-- commentaire refusé, membre d'une autre org refusé, anon refusé.

-- ── A. Structure et privilèges ─────────────────────────────────────────────
DO $$
DECLARE n int; r record;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relrowsecurity
     AND c.relname IN ('maint_units', 'maint_tasks', 'maint_operators', 'maint_task_logs', 'maint_digest_runs');
  IF n <> 5 THEN RAISE EXCEPTION 'RLS activée sur % table(s) au lieu de 5', n; END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'maint_task_logs' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'maint_task_logs : % policy(ies) d''écriture', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'maint_digest_runs';
  IF n <> 0 THEN RAISE EXCEPTION 'maint_digest_runs : % policy(ies)', n; END IF;

  FOR r IN SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname LIKE 'majordhome_maint_%' LOOP
    IF coalesce(r.reloptions::text, '') NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'vue % sans security_invoker', r.relname; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM information_schema.views
   WHERE table_schema = 'public' AND table_name IN ('majordhome_maint_units', 'majordhome_maint_tasks', 'majordhome_maint_operators')
     AND is_updatable = 'YES';
  IF n <> 3 THEN RAISE EXCEPTION '% vue(s) de paramétrage updatable(s) au lieu de 3', n; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'majordhome_maint_operators' AND column_name = 'pin_hash') THEN
    RAISE EXCEPTION 'la vue opérateurs expose pin_hash';
  END IF;
  IF has_column_privilege('authenticated', 'majordhome.maint_operators', 'pin_hash', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated peut lire pin_hash';
  END IF;
  IF has_column_privilege('authenticated', 'majordhome.maint_operators', 'pin_hash', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated peut écrire pin_hash';
  END IF;
  IF has_table_privilege('baikal_reader', 'majordhome.maint_operators', 'SELECT') THEN
    RAISE EXCEPTION 'baikal_reader (app voisine) lit maint_operators';
  END IF;
  IF has_table_privilege('authenticated', 'majordhome.maint_task_logs', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated peut insérer dans le journal';
  END IF;

  FOR r IN SELECT unnest(ARRAY['maint_units', 'maint_tasks', 'maint_operators', 'maint_task_logs', 'maint_digest_runs']) AS t LOOP
    IF NOT has_table_privilege('service_role', 'majordhome.' || r.t, 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur %', r.t; END IF;
    IF has_table_privilege('anon', 'majordhome.' || r.t, 'SELECT') THEN RAISE EXCEPTION 'anon lit %', r.t; END IF;
  END LOOP;

  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND p.proname LIKE 'maint\_%' LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN RAISE EXCEPTION 'anon peut exécuter %', r.proname; END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.maint_digest_mark_sent(uuid, date, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated peut exécuter maint_digest_mark_sent';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.maint_digest_mark_sent(uuid, date, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role ne peut pas exécuter maint_digest_mark_sent';
  END IF;
  RAISE NOTICE 'A. structure et privilèges : OK';
END;
$$;

-- ── B. Parcours fonctionnel ────────────────────────────────────────────────
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_etranger uuid;
  v_unit uuid; v_task uuid; v_op uuid; v_log uuid;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_res jsonb; i int; n int; ok boolean; v_failed int; v_locked timestamptz;
BEGIN
  SELECT om.user_id INTO v_admin FROM core.organization_members om
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role = 'org_admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'fixture : aucun org_admin Mayer'; END IF;
  SELECT om.user_id INTO v_etranger FROM core.organization_members om
   WHERE om.org_id <> v_mayer AND om.user_id IS NOT NULL
     AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;
  IF v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : aucun membre d''une autre org'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  SET LOCAL ROLE authenticated;

  -- (1) Paramétrage via les vues publiques
  INSERT INTO public.majordhome_maint_units (org_id, name, sort_order) VALUES (v_mayer, 'REHEARSAL Presse', 1)
    RETURNING id INTO v_unit;
  INSERT INTO public.majordhome_maint_tasks (org_id, unit_id, label, frequency_kind, weekdays, start_date)
    VALUES (v_mayer, v_unit, 'Graissage', 'weekdays', ARRAY[1,2,3,4,5]::smallint[], v_today - 7)
    RETURNING id INTO v_task;
  INSERT INTO public.majordhome_maint_operators (org_id, first_name) VALUES (v_mayer, 'Kevin')
    RETURNING id INTO v_op;
  IF v_unit IS NULL OR v_task IS NULL OR v_op IS NULL THEN RAISE EXCEPTION '(1) paramétrage non créé'; END IF;

  -- (1b) Fréquence incohérente refusée
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_maint_tasks (org_id, unit_id, label, frequency_kind, weekdays)
      VALUES (v_mayer, v_unit, 'X', 'interval', ARRAY[1]::smallint[]);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(1b) fréquence incohérente acceptée'; END IF;

  -- (2) Sans PIN : refus explicite
  v_res := public.maint_record_completion(v_task, v_op, '1234', 'done', NULL, v_today);
  IF v_res->>'error' <> 'no_pin' THEN RAISE EXCEPTION '(2) attendu no_pin, reçu %', v_res; END IF;

  -- (3) PIN invalide au format : refusé
  ok := false;
  BEGIN
    PERFORM public.maint_set_operator_pin(v_op, '12a4');
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(3) PIN non numérique accepté'; END IF;
  PERFORM public.maint_set_operator_pin(v_op, '4821');

  -- (4) 4 PIN faux ⇒ pin_invalid avec essais restants, compteur PERSISTÉ (pas de RAISE)
  FOR i IN 1..4 LOOP
    v_res := public.maint_record_completion(v_task, v_op, '0000', 'done', NULL, v_today);
    IF v_res->>'error' <> 'pin_invalid' OR (v_res->>'remaining')::int <> 5 - i THEN
      RAISE EXCEPTION '(4) essai % : réponse inattendue %', i, v_res;
    END IF;
  END LOOP;
  SELECT failed_attempts INTO v_failed FROM public.majordhome_maint_operators WHERE id = v_op;
  IF v_failed <> 4 THEN RAISE EXCEPTION '(4) compteur d''échecs = % au lieu de 4', v_failed; END IF;

  -- (5) 5ᵉ échec ⇒ bloqué ; même le bon PIN est refusé pendant le blocage
  v_res := public.maint_record_completion(v_task, v_op, '9999', 'done', NULL, v_today);
  IF v_res->>'error' <> 'locked' THEN RAISE EXCEPTION '(5) attendu locked, reçu %', v_res; END IF;
  v_res := public.maint_record_completion(v_task, v_op, '4821', 'done', NULL, v_today);
  IF v_res->>'error' <> 'locked' THEN RAISE EXCEPTION '(5) bon PIN accepté pendant le blocage : %', v_res; END IF;
  SELECT locked_until INTO v_locked FROM public.majordhome_maint_operators WHERE id = v_op;
  IF v_locked IS NULL OR v_locked <= now() THEN RAISE EXCEPTION '(5) blocage non persisté'; END IF;

  -- (6) Déblocage org_admin puis réalisation avec le bon PIN
  PERFORM public.maint_unlock_operator(v_op);
  v_res := public.maint_record_completion(v_task, v_op, '4821', 'done', '  ', v_today);
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '(6) réalisation refusée : %', v_res; END IF;
  v_log := (v_res->>'log_id')::uuid;
  SELECT count(*) INTO n FROM public.majordhome_maint_task_logs
   WHERE id = v_log AND recorded_by = v_admin AND unit_id = v_unit AND status = 'done' AND comment IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION '(6) log absent ou incomplet'; END IF;

  -- (7) « Pas pu faire » sans commentaire : refusé ; avec : accepté
  ok := false;
  BEGIN
    PERFORM public.maint_record_completion(v_task, v_op, '4821', 'not_done', ' ', v_today);
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(7) pas pu faire sans commentaire accepté'; END IF;
  v_res := public.maint_record_completion(v_task, v_op, '4821', 'not_done', 'Graisse épuisée', v_today);
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '(7) pas pu faire refusé : %', v_res; END IF;

  -- (8) Échéance future refusée
  ok := false;
  BEGIN
    PERFORM public.maint_record_completion(v_task, v_op, '4821', 'done', NULL, v_today + 1);
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(8) échéance future acceptée'; END IF;

  -- (9) Journal non modifiable (même au travers d'une écriture directe)
  ok := false;
  BEGIN
    UPDATE majordhome.maint_task_logs SET comment = 'triche' WHERE id = v_log;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(9) journal modifié'; END IF;

  -- (10) Membre d'une autre org : ne voit rien, ne peut pas signer, ne peut pas poser de PIN
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, false);
  SELECT count(*) INTO n FROM public.majordhome_maint_tasks WHERE id = v_task;
  IF n <> 0 THEN RAISE EXCEPTION '(10) tâche visible d''une autre org'; END IF;
  ok := false;
  BEGIN
    PERFORM public.maint_record_completion(v_task, v_op, '4821', 'done', NULL, v_today);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(10) signature cross-org acceptée'; END IF;
  ok := false;
  BEGIN
    PERFORM public.maint_set_operator_pin(v_op, '1111');
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(10) PIN posé cross-org'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_maint_units (org_id, name) VALUES (v_mayer, 'intrusion');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(10) unité insérée cross-org'; END IF;

  -- (11) Sans utilisateur (auth.uid() NULL) : refusé d'entrée
  PERFORM set_config('request.jwt.claim.sub', '', false);
  ok := false;
  BEGIN
    PERFORM public.maint_record_completion(v_task, v_op, '4821', 'done', NULL, v_today);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(11) appel sans utilisateur accepté'; END IF;

  RESET ROLE;
  -- (12) service_role : digest marqué une seule fois
  SET LOCAL ROLE service_role;
  IF public.maint_digest_mark_sent(v_mayer, v_today, 'prov-1') IS NOT TRUE THEN RAISE EXCEPTION '(12) premier marquage refusé'; END IF;
  IF public.maint_digest_mark_sent(v_mayer, v_today, 'prov-2') IS NOT FALSE THEN RAISE EXCEPTION '(12) double marquage accepté'; END IF;
  RESET ROLE;

  RAISE NOTICE 'B. parcours fonctionnel : OK';
END;
$$;
