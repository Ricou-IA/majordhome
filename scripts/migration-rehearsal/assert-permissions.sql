-- assert-permissions.sql — vérifie 20260930_12..15 (droits app-level, phases 4-6) sur le
-- cluster de répétition. Un écart lève une exception → run.mjs sort en ECHEC.
-- Identifiants figés sur la prod du 2026-09-30 (membres Mayer par rôle effectif).
--
-- A. défauts app regénérés (123 lignes, nouvelles ressources)
-- B. policies : plus aucune écriture « tout membre », tout passe par role_can
-- C. role_can par rôle (impersonation authenticated) — dont « supprimer = org_admin seul »
-- D. écritures réelles : tasks et quotes en technicien / commercial / admin / anonyme
-- E. purge des surcharges : Mayer 10, Cimaj 0, aucune org_admin, aucune redondante, aucun delete=true
-- F. org_seed_permissions supprimée

-- ── A. Défauts app ──────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM majordhome.app_role_permissions;
  IF n <> 123 THEN RAISE EXCEPTION '(A) 123 défauts app attendus, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.app_role_permissions
   WHERE resource IN ('pv_calculator', 'thermal_study') AND action = 'view';
  IF n <> 6 THEN RAISE EXCEPTION '(A) pv_calculator / thermal_study : 6 lignes attendues, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.app_role_permissions WHERE resource = 'maintenance';
  IF n <> 6 THEN RAISE EXCEPTION '(A) maintenance : 6 lignes attendues, trouvé %', n; END IF;
  -- suppression = jamais par défaut pour un non-admin
  SELECT count(*) INTO n FROM majordhome.app_role_permissions WHERE action = 'delete' AND allowed;
  IF n <> 0 THEN RAISE EXCEPTION '(A) % défaut(s) app avec delete=true', n; END IF;
END $$;

-- ── B. Policies ─────────────────────────────────────────────────────────────
DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('leads'), ('contracts'), ('quotes'), ('tasks')) AS t(tbl) LOOP
    -- 3 policies d'écriture, toutes sur role_can
    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname = 'majordhome' AND tablename = r.tbl AND cmd IN ('INSERT', 'UPDATE', 'DELETE');
    IF n <> 3 THEN RAISE EXCEPTION '(B) % : 3 policies d''écriture attendues, trouvé %', r.tbl, n; END IF;
    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname = 'majordhome' AND tablename = r.tbl AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
       AND coalesce(qual, '') || coalesce(with_check, '') NOT ILIKE '%role_can(%';
    IF n <> 0 THEN RAISE EXCEPTION '(B) % : % policy(ies) d''écriture hors role_can', r.tbl, n; END IF;
    -- les lectures n'ont pas bougé (org member + baikal, + portail client pour contracts)
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = r.tbl AND cmd = 'SELECT';
    IF n < 2 THEN RAISE EXCEPTION '(B) % : policies SELECT perdues (%)', r.tbl, n; END IF;
  END LOOP;
  -- legacy disparu
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome'
    AND policyname IN ('leads_insert_org_members', 'leads_update_org_members', 'leads_delete_org_members',
                       'contracts_insert_org_member', 'contracts_update_org_member', 'contracts_delete_org_member',
                       'quotes_insert', 'quotes_update', 'quotes_delete', 'tasks_insert', 'tasks_update', 'tasks_delete');
  IF n <> 0 THEN RAISE EXCEPTION '(B) % policy(ies) legacy encore présentes', n; END IF;
  -- arbitre : authenticated oui, anon non
  IF NOT has_function_privilege('authenticated', 'majordhome.role_can(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '(B) authenticated sans EXECUTE sur role_can';
  END IF;
  IF has_function_privilege('anon', 'majordhome.role_can(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '(B) anon a EXECUTE sur role_can';
  END IF;
END $$;

-- ── C. role_can par rôle (Mayer) ────────────────────────────────────────────
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_cimaj uuid := '62cd2073-96e0-4300-adae-4c1bb8934546';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';   -- org_admin
  v_tl    uuid := '69e365ef-b0a0-48b2-bd58-9c6c4f415c3f';   -- team_leader
  v_com   uuid := 'c5abedd8-3b15-47e2-9817-47ba491e5607';   -- member + Commercial
  v_tech  uuid := '3fb86975-5f01-4162-ad68-bc2e7eb52343';   -- user + Technicien
  v_ludo  uuid := 'd37f2b59-d32e-4fdb-a348-28a8f22f9ea7';   -- member sans business_role → technicien
BEGIN
  -- technicien
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  SET LOCAL ROLE authenticated;
  IF majordhome.user_effective_role(v_mayer) <> 'technicien' THEN RAISE EXCEPTION '(C) rôle effectif technicien attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'clients', 'edit')     THEN RAISE EXCEPTION '(C) tech clients.edit = true attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'clients', 'create')       THEN RAISE EXCEPTION '(C) tech clients.create = false attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'clients', 'delete')       THEN RAISE EXCEPTION '(C) tech clients.delete = false attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'pipeline', 'create')      THEN RAISE EXCEPTION '(C) tech pipeline.create = false attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'devis', 'create')         THEN RAISE EXCEPTION '(C) tech devis.create = false attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'tasks', 'create')     THEN RAISE EXCEPTION '(C) tech tasks.create = true attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'tasks', 'delete')         THEN RAISE EXCEPTION '(C) tech tasks.delete = false attendu (surcharge Mayer purgée)'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'tasks', 'edit')       THEN RAISE EXCEPTION '(C) tech tasks.edit = true attendu (surcharge Mayer conservée)'; END IF;
  IF majordhome.role_can(v_mayer, 'pv_calculator', 'view')   THEN RAISE EXCEPTION '(C) tech pv_calculator.view = false attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'maintenance', 'view') THEN RAISE EXCEPTION '(C) tech maintenance.view = true attendu'; END IF;
  RESET ROLE;

  -- membre sans business_role = technicien
  PERFORM set_config('request.jwt.claim.sub', v_ludo::text, true);
  SET LOCAL ROLE authenticated;
  IF majordhome.user_effective_role(v_mayer) <> 'technicien' THEN RAISE EXCEPTION '(C) membre sans business_role → technicien attendu'; END IF;
  RESET ROLE;

  -- commercial
  PERFORM set_config('request.jwt.claim.sub', v_com::text, true);
  SET LOCAL ROLE authenticated;
  IF majordhome.user_effective_role(v_mayer) <> 'commercial' THEN RAISE EXCEPTION '(C) rôle effectif commercial attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'pipeline', 'create')   THEN RAISE EXCEPTION '(C) com pipeline.create = true attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'pipeline', 'edit')         THEN RAISE EXCEPTION '(C) com pipeline.edit = false attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'pipeline', 'edit_own') THEN RAISE EXCEPTION '(C) com pipeline.edit_own = true attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'pipeline', 'delete')       THEN RAISE EXCEPTION '(C) com pipeline.delete = false attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'devis', 'create')      THEN RAISE EXCEPTION '(C) com devis.create = true attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'devis', 'delete')          THEN RAISE EXCEPTION '(C) com devis.delete = false attendu (surcharge Mayer purgée)'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'clients', 'create')    THEN RAISE EXCEPTION '(C) com clients.create = true attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'pv_calculator', 'view') THEN RAISE EXCEPTION '(C) com pv_calculator.view = true attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'voice_recorder', 'use') THEN RAISE EXCEPTION '(C) com voice_recorder.use = true attendu (surcharge Mayer conservée)'; END IF;
  RESET ROLE;

  -- team_leader
  PERFORM set_config('request.jwt.claim.sub', v_tl::text, true);
  SET LOCAL ROLE authenticated;
  IF majordhome.user_effective_role(v_mayer) <> 'team_leader' THEN RAISE EXCEPTION '(C) rôle effectif team_leader attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'clients', 'create')   THEN RAISE EXCEPTION '(C) TL clients.create = true attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'clients', 'edit')     THEN RAISE EXCEPTION '(C) TL clients.edit = true attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'clients', 'delete')       THEN RAISE EXCEPTION '(C) TL clients.delete = false attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'pipeline', 'delete')      THEN RAISE EXCEPTION '(C) TL pipeline.delete = false attendu'; END IF;
  IF majordhome.role_can(v_mayer, 'devis', 'delete')         THEN RAISE EXCEPTION '(C) TL devis.delete = false attendu (surcharge Mayer purgée)'; END IF;
  IF majordhome.role_can(v_mayer, 'tasks', 'delete')         THEN RAISE EXCEPTION '(C) TL tasks.delete = false attendu (surcharge Mayer purgée)'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'tasks', 'edit')       THEN RAISE EXCEPTION '(C) TL tasks.edit = true attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'thermal_study', 'view') THEN RAISE EXCEPTION '(C) TL thermal_study.view = true attendu'; END IF;
  -- membre de Mayer, pas de Cimaj → rien
  IF majordhome.role_can(v_cimaj, 'clients', 'view') THEN RAISE EXCEPTION '(C) TL Mayer ne doit rien pouvoir chez Cimaj'; END IF;
  RESET ROLE;

  -- org_admin : bypass
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT majordhome.role_can(v_mayer, 'contracts_inexistante', 'delete') THEN RAISE EXCEPTION '(C) admin bypass attendu'; END IF;
  IF NOT majordhome.role_can(v_mayer, 'clients', 'delete') THEN RAISE EXCEPTION '(C) admin clients.delete = true attendu'; END IF;
  RESET ROLE;

  -- anonyme : rien
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF majordhome.role_can(v_mayer, 'clients', 'view') IS DISTINCT FROM false THEN RAISE EXCEPTION '(C) anonyme : false attendu'; END IF;
END $$;

-- ── D. Écritures réelles (tasks : NOT NULL minimal org_id + title ; quotes : org_id + quote_number)
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_com   uuid := 'c5abedd8-3b15-47e2-9817-47ba491e5607';
  v_tech  uuid := '3fb86975-5f01-4162-ad68-bc2e7eb52343';
  v_task uuid; v_quote uuid; n int; ok boolean;
BEGIN
  -- technicien : crée une tâche (tasks.create = tous), ne peut PAS la supprimer (delete = admin)
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO majordhome.tasks (org_id, title, created_by) VALUES (v_mayer, 'REHEARSAL tâche tech', v_tech) RETURNING id INTO v_task;
  IF v_task IS NULL THEN RAISE EXCEPTION '(D) technicien : INSERT tasks refusé'; END IF;
  DELETE FROM majordhome.tasks WHERE id = v_task;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '(D) technicien a supprimé sa propre tâche (attendu : org_admin seul)'; END IF;
  -- technicien : pas de devis
  ok := false;
  BEGIN
    INSERT INTO majordhome.quotes (org_id, quote_number) VALUES (v_mayer, 'REHEARSAL-T');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(D) technicien a créé un devis'; END IF;
  RESET ROLE;

  -- commercial : crée et modifie un devis, ne le supprime pas
  PERFORM set_config('request.jwt.claim.sub', v_com::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO majordhome.quotes (org_id, quote_number) VALUES (v_mayer, 'REHEARSAL-C') RETURNING id INTO v_quote;
  IF v_quote IS NULL THEN RAISE EXCEPTION '(D) commercial : INSERT quotes refusé'; END IF;
  UPDATE majordhome.quotes SET quote_number = 'REHEARSAL-C2' WHERE id = v_quote;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '(D) commercial : UPDATE quotes refusé'; END IF;
  DELETE FROM majordhome.quotes WHERE id = v_quote;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '(D) commercial a supprimé un devis (attendu : org_admin seul)'; END IF;
  RESET ROLE;

  -- org_admin : supprime les deux
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM majordhome.tasks WHERE id = v_task;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '(D) org_admin : DELETE tasks refusé'; END IF;
  DELETE FROM majordhome.quotes WHERE id = v_quote;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '(D) org_admin : DELETE quotes refusé'; END IF;
  RESET ROLE;

  -- anonyme : rien
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN
    INSERT INTO majordhome.tasks (org_id, title) VALUES (v_mayer, 'REHEARSAL anon');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(D) anon a créé une tâche'; END IF;
  RESET ROLE;
END $$;

-- ── E. Purge des surcharges ─────────────────────────────────────────────────
DO $$
DECLARE n int; v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'; v_cimaj uuid := '62cd2073-96e0-4300-adae-4c1bb8934546';
BEGIN
  SELECT count(*) INTO n FROM majordhome.role_permissions WHERE org_id = v_mayer;
  IF n <> 10 THEN RAISE EXCEPTION '(E) Mayer : 10 surcharges attendues, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.role_permissions WHERE org_id = v_cimaj;
  IF n <> 0 THEN RAISE EXCEPTION '(E) Cimaj : 0 surcharge attendue, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.role_permissions WHERE role = 'org_admin';
  IF n <> 0 THEN RAISE EXCEPTION '(E) % ligne(s) org_admin restantes', n; END IF;
  SELECT count(*) INTO n FROM majordhome.role_permissions rp
    JOIN majordhome.app_role_permissions a ON a.role = rp.role AND a.resource = rp.resource AND a.action = rp.action
   WHERE a.allowed = rp.allowed;
  IF n <> 0 THEN RAISE EXCEPTION '(E) % surcharge(s) encore égales au défaut app', n; END IF;
  SELECT count(*) INTO n FROM majordhome.role_permissions WHERE action = 'delete' AND allowed;
  IF n <> 0 THEN RAISE EXCEPTION '(E) % surcharge(s) delete=true restantes', n; END IF;
  -- toute surcharge restante porte sur une case du registre (pas de ressource fantôme)
  SELECT count(*) INTO n FROM majordhome.role_permissions rp
   WHERE NOT EXISTS (SELECT 1 FROM majordhome.app_role_permissions a WHERE a.role = rp.role AND a.resource = rp.resource AND a.action = rp.action);
  IF n <> 0 THEN RAISE EXCEPTION '(E) % surcharge(s) hors registre', n; END IF;
END $$;

-- ── F. Fin du gabarit Mayer ─────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.org_seed_permissions(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '(F) org_seed_permissions encore présente';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'assert-permissions : OK'; END $$;
