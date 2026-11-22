-- assert-clients-import.sql — vérifie 20261121_13 (import des clients d'un autre logiciel) sur le cluster de
-- répétition. Autonome : crée ses imports et ses fiches dans Mayer (A) et vérifie l'étanchéité avec Cimaj (B).
-- Chaque écart lève une exception. Membres relevés dans le snapshot du 2026-11-21 :
--   A = Mayer 3c68193e… : org_admin 8a4907a3…, team_leader 6c3a9488…
--   B = Cimaj 62cd2073… : org_admin 8ebd6637…, team_leader fe6e3954…
-- Se mettre à la place d'un membre : request.jwt.claim.sub (stub auth.uid() du harnais) + request.jwt.claims
-- (forme de la prod) puis SET LOCAL ROLE authenticated.

-- Aide de test : exécute une instruction et exige qu'elle échoue avec ce message (et ce SQLSTATE s'il est donné).
-- SECURITY INVOKER : l'instruction s'exécute avec le rôle courant (authenticated).
CREATE OR REPLACE FUNCTION public.zz_assert_erreur(p_sql text, p_message text, p_etat text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_passe boolean := false; v_msg text; v_etat text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_passe := true;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM; v_etat := SQLSTATE;
  END;
  IF v_passe THEN RAISE EXCEPTION 'aurait dû échouer (%) : %', p_message, p_sql; END IF;
  IF v_msg IS DISTINCT FROM p_message THEN RAISE EXCEPTION 'attendu « % », reçu « % » [%] : %', p_message, v_msg, v_etat, p_sql; END IF;
  IF p_etat IS NOT NULL AND v_etat IS DISTINCT FROM p_etat THEN RAISE EXCEPTION 'SQLSTATE attendu %, reçu % : %', p_etat, v_etat, p_sql; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.zz_assert_erreur(text, text, text) TO authenticated;

-- ── 1. Structure et droits ────────────────────────────────────────────────────
DO $$
DECLARE f text; n int; v_last text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.majordhome_clients', 'public.majordhome_clients_all', 'public.majordhome_client_imports'] LOOP
    IF (SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = f::regclass) IS NOT TRUE THEN
      RAISE EXCEPTION '% sans security_invoker=true', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['majordhome_clients', 'majordhome_clients_all'] LOOP
    SELECT column_name INTO v_last FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = f ORDER BY ordinal_position DESC LIMIT 1;
    IF v_last IS DISTINCT FROM 'external_ref' THEN RAISE EXCEPTION '% : dernière colonne = %, external_ref attendue', f, v_last; END IF;
    SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = f;
    IF n <> 49 THEN RAISE EXCEPTION '% : 49 colonnes attendues (48 + external_ref), % trouvées', f, n; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.majordhome_client_imports', f) THEN RAISE EXCEPTION 'majordhome_client_imports : anon a %', f; END IF;
    IF has_table_privilege('anon', 'majordhome.client_imports', f) THEN RAISE EXCEPTION 'client_imports : anon a %', f; END IF;
    IF has_table_privilege('anon', 'public.majordhome_clients', f) THEN RAISE EXCEPTION 'majordhome_clients : anon a %', f; END IF;
    IF has_table_privilege('anon', 'public.majordhome_clients_all', f) THEN RAISE EXCEPTION 'majordhome_clients_all : anon a %', f; END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.majordhome_client_imports', 'SELECT') IS NOT TRUE THEN RAISE EXCEPTION 'majordhome_client_imports illisible par authenticated'; END IF;
  IF has_table_privilege('service_role', 'majordhome.client_imports', 'SELECT') IS NOT TRUE THEN RAISE EXCEPTION 'client_imports illisible par service_role'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.client_imports', 'INSERT')
     OR has_table_privilege('authenticated', 'majordhome.client_imports', 'UPDATE')
     OR has_table_privilege('authenticated', 'majordhome.client_imports', 'DELETE')
     OR has_table_privilege('authenticated', 'public.majordhome_client_imports', 'INSERT')
     OR has_table_privilege('authenticated', 'public.majordhome_client_imports', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.majordhome_client_imports', 'DELETE') THEN
    RAISE EXCEPTION 'client_imports : authenticated ne doit pas pouvoir écrire (seules les RPC écrivent)';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.client_imports'::regclass) IS NOT TRUE THEN RAISE EXCEPTION 'client_imports sans RLS'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'client_imports';
  IF n <> 1 THEN RAISE EXCEPTION 'client_imports : 1 policy attendue, % trouvée(s)', n; END IF;
  IF (SELECT cmd FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'client_imports') <> 'SELECT' THEN
    RAISE EXCEPTION 'client_imports : la seule policy doit être une lecture';
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'public.clients_import_start(uuid, text, text, jsonb, jsonb)',
    'public.clients_import_batch(uuid, jsonb)',
    'public.clients_import_finish(uuid, jsonb)',
    'public.clients_import_removal_preview(uuid)',
    'public.clients_import_remove(uuid, integer)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par anon', f; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '% exécutable par PUBLIC', f;
    END IF;
    IF has_function_privilege('authenticated', f, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION '% non exécutable par authenticated', f; END IF;
    IF has_function_privilege('service_role', f, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION '% non exécutable par service_role', f; END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '% doit être SECURITY DEFINER', f; END IF;
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'majordhome' AND p.proname LIKE 'clients\_import\_%' LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION 'interne % exécutable par anon', f; END IF;
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION 'interne % exécutable par authenticated', f; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'majordhome' AND p.proname IN ('clients_import_org_admin', 'clients_import_retirables');
  IF n <> 2 THEN RAISE EXCEPTION 'fonctions internes attendues : clients_import_org_admin, clients_import_retirables (% trouvées)', n; END IF;

  -- search_path de chaque fonction de la migration : pg_temp en dernier
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname IN ('majordhome', 'public') AND p.proname LIKE 'clients\_import\_%' LOOP
    IF (SELECT 'search_path=majordhome, public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE oid = f::regprocedure) IS NOT TRUE THEN
      RAISE EXCEPTION '% : search_path « majordhome, public, pg_temp » attendu, trouvé %', f, (SELECT proconfig FROM pg_proc WHERE oid = f::regprocedure);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'majordhome' AND tablename = 'clients'
                  AND indexdef LIKE 'CREATE UNIQUE INDEX%(import_id, import_line)%WHERE (import_id IS NOT NULL)%') THEN
    RAISE EXCEPTION 'index unique partiel (import_id, import_line) absent';
  END IF;
  RAISE NOTICE '§1 structure et droits : OK';
END $$;

-- ── 2-4. Écriture par lots (org_admin de A) ──────────────────────────────────
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp   uuid;
  v_rows  jsonb := jsonb_build_array(
    jsonb_build_object('import_line', 2, 'display_name', 'DURAND Marie', 'client_category', 'particulier',
      'last_name', 'DURAND', 'first_name', 'Marie', 'email', 'marie@example.test', 'phone', '0612345678',
      'address', '12 chemin des Vignes', 'postal_code', '81600', 'city', 'Gaillac', 'housing_type', 'maison',
      'surface', 120.5, 'construction_year', 1985, 'mail_optin', false, 'sms_optin', true, 'external_ref', 'EXT-001',
      'notes', 'client fidèle', 'org_id', '62cd2073-96e0-4300-adae-4c1bb8934546', 'client_number', 1),
    jsonb_build_object('import_line', 3, 'display_name', 'SARL DUPONT', 'client_category', 'entreprise',
      'company_name', 'SARL DUPONT', 'surface', '80,5', 'construction_year', '2001', 'external_ref', 'EXT-002'),
    jsonb_build_object('import_line', 4, 'display_name', 'MARTIN Paul', 'last_name', 'MARTIN', 'first_name', 'Paul',
      'mail_optin', NULL, 'sms_optin', NULL, 'housing_type', NULL, 'external_ref', 'EXT-003'));
  r jsonb; n int; fiche record;
BEGIN
  -- La séquence du harnais repart de 1 alors que les fiches de la prod sont chargées (en prod elle est à jour).
  PERFORM setval('majordhome.client_number_seq', 98000);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_imp := public.clients_import_start(v_a, '  export-ancien-logiciel.xlsx  ', 'Ancien logiciel',
             '[{"colonne":"Nom","champ":"last_name"}]'::jsonb, '{"lignes":3}'::jsonb);
  IF v_imp IS NULL THEN RAISE EXCEPTION 'start ne rend pas d''identifiant'; END IF;
  PERFORM set_config('test.imp_a', v_imp::text, false);

  -- 2. Trois lignes créées
  r := public.clients_import_batch(v_imp, v_rows);
  IF r IS DISTINCT FROM '{"created": 3, "skipped": 0}'::jsonb THEN RAISE EXCEPTION 'batch : % au lieu de created 3, skipped 0', r; END IF;

  SET LOCAL ROLE postgres;
  IF (SELECT file_name FROM majordhome.client_imports WHERE id = v_imp) <> 'export-ancien-logiciel.xlsx' THEN RAISE EXCEPTION 'file_name non nettoyé'; END IF;
  IF (SELECT created_by FROM majordhome.client_imports WHERE id = v_imp) IS DISTINCT FROM v_admin THEN RAISE EXCEPTION 'client_imports.created_by faux'; END IF;
  SELECT count(*) INTO n FROM majordhome.clients WHERE import_id = v_imp;
  IF n <> 3 THEN RAISE EXCEPTION '3 fiches attendues, % trouvées', n; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.clients WHERE import_id = v_imp AND org_id IS DISTINCT FROM v_a) THEN RAISE EXCEPTION 'une fiche hors de A (org_id de la ligne lu ?)'; END IF;
  SELECT count(DISTINCT client_number) INTO n FROM majordhome.clients WHERE import_id = v_imp AND client_number IS NOT NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'client_number : 3 distincts attendus, %', n; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.clients WHERE import_id = v_imp AND client_number = '1') THEN RAISE EXCEPTION 'client_number de la ligne lu'; END IF;
  SELECT count(*) INTO n FROM majordhome.clients c JOIN core.projects p ON p.id = c.project_id
   WHERE c.import_id = v_imp AND p.org_id = v_a AND p.identity->>'created_from' = 'import_clients' AND p.created_by = v_admin
     AND p.name = c.display_name AND p.slug ~ '^[a-z0-9-]+-[0-9a-f]{8}$';
  IF n <> 3 THEN RAISE EXCEPTION 'projets : 3 attendus dans A (identity import_clients, slug), % trouvés', n; END IF;
  IF (SELECT count(DISTINCT project_id) FROM majordhome.clients WHERE import_id = v_imp) <> 3 THEN RAISE EXCEPTION 'projets non distincts'; END IF;

  SELECT * INTO fiche FROM majordhome.clients WHERE import_id = v_imp AND import_line = 2;
  IF fiche.mail_optin IS DISTINCT FROM false OR fiche.sms_optin IS DISTINCT FROM true THEN RAISE EXCEPTION 'ligne 2 : opt-in % / %', fiche.mail_optin, fiche.sms_optin; END IF;
  IF fiche.display_name <> 'DURAND Marie' OR fiche.email <> 'marie@example.test' OR fiche.city <> 'Gaillac' OR fiche.housing_type::text <> 'maison'
     OR fiche.surface <> 120.5 OR fiche.construction_year <> 1985 OR fiche.external_ref <> 'EXT-001' OR fiche.notes <> 'client fidèle'
     OR fiche.import_source <> 'Ancien logiciel' OR fiche.created_by IS DISTINCT FROM v_admin OR fiche.client_category::text <> 'particulier' THEN
    RAISE EXCEPTION 'ligne 2 mal écrite : %', row_to_json(fiche);
  END IF;
  SELECT * INTO fiche FROM majordhome.clients WHERE import_id = v_imp AND import_line = 3;
  IF fiche.client_category::text <> 'entreprise' OR fiche.surface <> 80.5 OR fiche.construction_year <> 2001 OR fiche.company_name <> 'SARL DUPONT'
     OR fiche.mail_optin IS DISTINCT FROM true OR fiche.sms_optin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ligne 3 mal écrite : %', row_to_json(fiche);
  END IF;
  SELECT * INTO fiche FROM majordhome.clients WHERE import_id = v_imp AND import_line = 4;
  IF fiche.mail_optin IS DISTINCT FROM true OR fiche.sms_optin IS DISTINCT FROM true OR fiche.housing_type IS NOT NULL OR fiche.client_category::text <> 'particulier' THEN
    RAISE EXCEPTION 'ligne 4 : opt-in null ⇒ true, catégorie par défaut : %', row_to_json(fiche);
  END IF;
  IF (SELECT external_ref FROM public.majordhome_clients_all WHERE id = fiche.id) <> 'EXT-003' THEN RAISE EXCEPTION 'external_ref absent de la vue'; END IF;
  -- Journal d'audit : la création est tracée (trigger trg_audit_clients rejoué par le harnais)
  SELECT count(*) INTO n FROM majordhome.audit_log WHERE table_name = 'clients' AND client_id IN (SELECT id FROM majordhome.clients WHERE import_id = v_imp);
  IF n < 3 THEN RAISE EXCEPTION 'journal d''audit : 3 créations attendues, %', n; END IF;

  -- 3. Le même lot renvoyé : rien de recréé
  SET LOCAL ROLE authenticated;
  r := public.clients_import_batch(v_imp, v_rows);
  IF r IS DISTINCT FROM '{"created": 0, "skipped": 3}'::jsonb THEN RAISE EXCEPTION 'lot rejoué : % au lieu de created 0, skipped 3', r; END IF;

  -- 4. Une ligne invalide : rien du lot n'est écrit
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": 5, "display_name": "LEROY Anne"}, {"import_line": 6, "display_name": "   "}]'), 'row_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": 5, "display_name": "LEROY Anne", "client_category": "copropriete"}]'), 'row_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": 5, "display_name": "LEROY Anne", "housing_type": "chateau"}]'), 'row_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": 5, "display_name": "LEROY Anne", "surface": "grande"}]'), 'row_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": 5, "display_name": "LEROY Anne", "mail_optin": "oui"}]'), 'row_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": "5", "display_name": "LEROY Anne"}]'), 'row_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"display_name": "LEROY Anne"}]'), 'row_invalid');
  -- Deux lignes du même numéro (5 et 5.0 sont le même nombre JSON) ; élément qui n'est pas un objet
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": 5, "display_name": "LEROY Anne"}, {"import_line": 5, "display_name": "LEROY Paul"}]'), 'rows_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": 5, "display_name": "LEROY Anne"}, {"import_line": 5.0, "display_name": "LEROY Paul"}]'), 'rows_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": 5, "display_name": "LEROY Anne"}, 3]'), 'rows_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp,
    '[{"import_line": 5, "display_name": "LEROY Anne"}, "texte"]'), 'rows_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp, '[]'), 'rows_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp, '{"a": 1}'), 'rows_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, NULL)$q$, v_imp), 'rows_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, (SELECT jsonb_agg(jsonb_build_object('import_line', g, 'display_name', 'X')) FROM generate_series(1000, 1500) g))$q$, v_imp), 'rows_invalid');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, '[{"import_line": 5, "display_name": "X"}]'::jsonb)$q$, gen_random_uuid()), 'import_not_found', 'P0002');
  PERFORM public.zz_assert_erreur($q$SELECT public.clients_import_start('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', '   ', NULL, '[]', '{}')$q$, 'file_name_required');

  SET LOCAL ROLE postgres;
  SELECT count(*) INTO n FROM majordhome.clients WHERE import_id = v_imp;
  IF n <> 3 THEN RAISE EXCEPTION 'un lot refusé a écrit : % fiches au lieu de 3', n; END IF;
  RAISE NOTICE '§2-4 écriture par lots : OK';
END $$;

-- ── 5. Refus ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_a       uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_a_tl    uuid := '6c3a9488-92ee-42cc-b010-6646ca299139';
  v_b_admin uuid := '8ebd6637-489e-473e-9583-807ab1e3154e';
  v_imp     uuid := current_setting('test.imp_a')::uuid;
  v_lot     text := '[{"import_line": 9, "display_name": "INTRUS"}]';
  n int;
BEGIN
  SET LOCAL ROLE authenticated;
  -- Membre non administrateur de A
  PERFORM set_config('request.jwt.claim.sub', v_a_tl::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a_tl, 'role', 'authenticated')::text, true);
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_start(%L, 'f.csv', NULL, '[]', '{}')$q$, v_a), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp, v_lot), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_finish(%L, '{}')$q$, v_imp), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_removal_preview(%L)$q$, v_imp), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_remove(%L)$q$, v_imp), 'org_admin_required', '42501');

  -- org_admin de B sur l'import de A
  PERFORM set_config('request.jwt.claim.sub', v_b_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b_admin, 'role', 'authenticated')::text, true);
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_start(%L, 'f.csv', NULL, '[]', '{}')$q$, v_a), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp, v_lot), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_finish(%L, '{}')$q$, v_imp), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_removal_preview(%L)$q$, v_imp), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_remove(%L)$q$, v_imp), 'org_admin_required', '42501');

  -- Sans identité
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_start(%L, 'f.csv', NULL, '[]', '{}')$q$, v_a), 'unauthenticated', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, %L::jsonb)$q$, v_imp, v_lot), 'unauthenticated', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_finish(%L, '{}')$q$, v_imp), 'unauthenticated', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_removal_preview(%L)$q$, v_imp), 'unauthenticated', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_remove(%L)$q$, v_imp), 'unauthenticated', '42501');

  -- anon ne peut rien appeler du tout
  SET LOCAL ROLE anon;
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_start(%L, 'f.csv', NULL, '[]', '{}')$q$, v_a),
    'permission denied for function clients_import_start', '42501');
  SET LOCAL ROLE postgres;
  -- une fonction interne n'est pas appelable par authenticated
  SET LOCAL ROLE authenticated;
  PERFORM public.zz_assert_erreur(format($q$SELECT majordhome.clients_import_retirables(%L)$q$, v_imp),
    'permission denied for function clients_import_retirables', '42501');
  SET LOCAL ROLE postgres;

  SELECT count(*) INTO n FROM majordhome.clients WHERE import_id = v_imp;
  IF n <> 3 THEN RAISE EXCEPTION 'un refus a écrit : % fiches', n; END IF;
  IF (SELECT status FROM majordhome.client_imports WHERE id = v_imp) <> 'en_cours' THEN RAISE EXCEPTION 'un refus a changé le statut'; END IF;
  SELECT count(*) INTO n FROM majordhome.client_imports WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  IF n <> 1 THEN RAISE EXCEPTION 'un start refusé a créé un import (% imports dans A)', n; END IF;
  RAISE NOTICE '§5 refus : OK';
END $$;

-- ── 8. Lecture de la vue des imports ─────────────────────────────────────────
DO $$
DECLARE
  v_admin   uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_a_tl    uuid := '6c3a9488-92ee-42cc-b010-6646ca299139';
  v_b_admin uuid := '8ebd6637-489e-473e-9583-807ab1e3154e';
  v_b_tl    uuid := 'fe6e3954-3ba7-412f-a822-d4b2844b085f';
  v_imp     uuid := current_setting('test.imp_a')::uuid;
  v_nom     text;
  n int; u uuid;
BEGIN
  SELECT full_name INTO v_nom FROM core.profiles WHERE id = v_admin;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.majordhome_client_imports WHERE id = v_imp;
  IF n <> 1 THEN RAISE EXCEPTION 'org_admin de A ne lit pas son import (%)', n; END IF;
  IF (SELECT created_by_name FROM public.majordhome_client_imports WHERE id = v_imp) IS DISTINCT FROM v_nom THEN
    RAISE EXCEPTION 'created_by_name faux';
  END IF;
  FOREACH u IN ARRAY ARRAY[v_a_tl, v_b_admin, v_b_tl] LOOP
    PERFORM set_config('request.jwt.claim.sub', u::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO n FROM public.majordhome_client_imports WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
    IF n <> 0 THEN RAISE EXCEPTION '% lit % import(s) de A', u, n; END IF;
    SELECT count(*) INTO n FROM majordhome.client_imports;
    IF n <> 0 THEN RAISE EXCEPTION '% lit % ligne(s) de client_imports', u, n; END IF;
  END LOOP;
  SET LOCAL ROLE postgres;
  RAISE NOTICE '§8 lecture : OK';
END $$;

-- ── 6. Clôture ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp   uuid := current_setting('test.imp_a')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.clients_import_finish(v_imp, '{"crees": 3, "ignorees": 0}'::jsonb);
  SET LOCAL ROLE postgres;
  IF (SELECT status FROM majordhome.client_imports WHERE id = v_imp) <> 'termine' THEN RAISE EXCEPTION 'finish : statut non termine'; END IF;
  IF (SELECT counts FROM majordhome.client_imports WHERE id = v_imp) <> '{"crees": 3, "ignorees": 0}'::jsonb THEN RAISE EXCEPTION 'finish : counts non enregistrés'; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, '[{"import_line": 7, "display_name": "TARDIF"}]'::jsonb)$q$, v_imp), 'import_closed');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_finish(%L, '{}')$q$, v_imp), 'import_closed');
  SET LOCAL ROLE postgres;
  RAISE NOTICE '§6 clôture : OK';
END $$;

-- ── 7. Retrait ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp   uuid := current_setting('test.imp_a')::uuid;
  v_c2 uuid; v_c3 uuid; v_c4 uuid; v_p3 uuid; v_p4 uuid;
  r jsonb; n int;
BEGIN
  SELECT id INTO v_c2 FROM majordhome.clients WHERE import_id = v_imp AND import_line = 2;
  SELECT id, project_id INTO v_c3, v_p3 FROM majordhome.clients WHERE import_id = v_imp AND import_line = 3;
  SELECT id, project_id INTO v_c4, v_p4 FROM majordhome.clients WHERE import_id = v_imp AND import_line = 4;
  INSERT INTO majordhome.contracts (org_id, client_id, status) VALUES (v_a, v_c2, 'pending');
  INSERT INTO majordhome.client_dpe (org_id, client_id, etat) VALUES (v_a, v_c3, 'aucun_dpe');

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.clients_import_removal_preview(v_imp);
  IF r IS DISTINCT FROM '{"retirables": 2, "conservees": 1}'::jsonb THEN RAISE EXCEPTION 'preview : %', r; END IF;
  r := public.clients_import_remove(v_imp);
  IF r IS DISTINCT FROM '{"retirees": 2, "conservees": 1, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'remove : %', r; END IF;
  SET LOCAL ROLE postgres;

  -- 20261122_1 : une fiche reste (contrat) ⇒ l'import n'est PAS « retire » ; counts garde le bilan et reçoit le retrait.
  IF (SELECT status FROM majordhome.client_imports WHERE id = v_imp) <> 'termine' THEN RAISE EXCEPTION 'remove : une fiche reste, statut termine attendu'; END IF;
  IF (SELECT removed_at IS NULL AND removed_by IS NULL FROM majordhome.client_imports WHERE id = v_imp) IS NOT TRUE THEN RAISE EXCEPTION 'removed_at / removed_by posés alors qu''une fiche reste'; END IF;
  IF (SELECT counts FROM majordhome.client_imports WHERE id = v_imp) IS DISTINCT FROM '{"crees": 3, "ignorees": 0, "retirees": 2, "conservees": 1}'::jsonb THEN
    RAISE EXCEPTION 'remove : counts = %', (SELECT counts FROM majordhome.client_imports WHERE id = v_imp);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.clients WHERE id = v_c2) THEN RAISE EXCEPTION 'la fiche au contrat a été retirée'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.clients WHERE id IN (v_c3, v_c4)) THEN RAISE EXCEPTION 'fiches non retirées'; END IF;
  IF EXISTS (SELECT 1 FROM core.projects WHERE id IN (v_p3, v_p4)) THEN RAISE EXCEPTION 'projets non retirés'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.client_dpe WHERE client_id = v_c3) THEN RAISE EXCEPTION 'ligne client_dpe restée'; END IF;
  IF (SELECT count(*) FROM majordhome.audit_log WHERE table_name = 'clients' AND action = 'DELETE' AND client_id IN (v_c3, v_c4)) <> 2 THEN
    RAISE EXCEPTION 'journal d''audit : 2 suppressions attendues';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, '[{"import_line": 7, "display_name": "TARDIF"}]'::jsonb)$q$, v_imp), 'import_closed');
  r := public.clients_import_remove(v_imp);
  IF r IS DISTINCT FROM '{"retirees": 0, "conservees": 1, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'remove rejoué : %', r; END IF;
  SET LOCAL ROLE postgres;
  IF (SELECT counts FROM majordhome.client_imports WHERE id = v_imp) IS DISTINCT FROM '{"crees": 3, "ignorees": 0, "retirees": 2, "conservees": 1}'::jsonb THEN
    RAISE EXCEPTION 'remove rejoué : retirees doit rester cumulé à 2, counts = %', (SELECT counts FROM majordhome.client_imports WHERE id = v_imp);
  END IF;
  -- La fiche se libère (contrat supprimé) : un nouveau retrait la retire et l'import passe enfin à « retire ».
  DELETE FROM majordhome.contracts WHERE client_id = v_c2;
  SET LOCAL ROLE authenticated;
  r := public.clients_import_remove(v_imp);
  IF r IS DISTINCT FROM '{"retirees": 1, "conservees": 0, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'remove après libération : %', r; END IF;
  SET LOCAL ROLE postgres;
  IF (SELECT status = 'retire' AND removed_at IS NOT NULL AND removed_by = v_admin AND counts ->> 'retirees' = '3' AND counts ->> 'conservees' = '0'
        FROM majordhome.client_imports WHERE id = v_imp) IS NOT TRUE THEN
    RAISE EXCEPTION 'import vidé : retire / removed_* / counts attendus, trouvé %', (SELECT row_to_json(i) FROM majordhome.client_imports i WHERE id = v_imp);
  END IF;
  RAISE NOTICE '§7 retrait : OK';
END $$;

-- ── 7 bis. Retrait par tranches ; un projet référencé retient sa fiche ──────
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp   uuid; v_p uuid; v_c uuid;
  r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_imp := public.clients_import_start(v_a, 'tranches.csv', NULL, '[]', '{}');
  PERFORM public.clients_import_batch(v_imp, (SELECT jsonb_agg(jsonb_build_object('import_line', g, 'display_name', 'TRANCHE ' || g)) FROM generate_series(1, 4) g));
  SET LOCAL ROLE postgres;
  -- un lead posé sur le projet de la ligne 1 et une autre fiche qui a la ligne 2 pour parrain
  SELECT project_id INTO v_p FROM majordhome.clients WHERE import_id = v_imp AND import_line = 1;
  SELECT id INTO v_c FROM majordhome.clients WHERE import_id = v_imp AND import_line = 2;
  INSERT INTO majordhome.leads (org_id, last_name, project_id, is_deleted) VALUES (v_a, 'TRANCHE', v_p, false);
  UPDATE majordhome.clients SET parrain_id = v_c WHERE id = (SELECT id FROM majordhome.clients WHERE import_id IS NULL AND org_id = v_a LIMIT 1);
  SET LOCAL ROLE authenticated;
  r := public.clients_import_removal_preview(v_imp);
  IF r IS DISTINCT FROM '{"retirables": 2, "conservees": 2}'::jsonb THEN RAISE EXCEPTION 'preview tranches : %', r; END IF;
  r := public.clients_import_remove(v_imp, 1);
  IF r IS DISTINCT FROM '{"retirees": 1, "conservees": 2, "restantes": 1}'::jsonb THEN RAISE EXCEPTION 'remove(1) : %', r; END IF;
  IF (SELECT status FROM public.majordhome_client_imports WHERE id = v_imp) <> 'en_cours' THEN RAISE EXCEPTION 'retire posé avant la fin'; END IF;
  r := public.clients_import_remove(v_imp, 0); -- borné à 1
  IF r IS DISTINCT FROM '{"retirees": 1, "conservees": 2, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'remove(0→1) : %', r; END IF;
  -- Deux fiches conservées : l'import reste dans la liste, retirable plus tard.
  IF (SELECT status FROM public.majordhome_client_imports WHERE id = v_imp) <> 'en_cours' THEN RAISE EXCEPTION 'deux fiches restent : statut en_cours attendu'; END IF;
  IF (SELECT counts FROM public.majordhome_client_imports WHERE id = v_imp) IS DISTINCT FROM '{"retirees": 2, "conservees": 2}'::jsonb THEN
    RAISE EXCEPTION 'tranches : counts = %', (SELECT counts FROM public.majordhome_client_imports WHERE id = v_imp);
  END IF;
  SET LOCAL ROLE postgres;
  RAISE NOTICE '§7 bis retrait par tranches : OK';
END $$;

-- ── Adhésion non active : un org_admin suspendu est refusé ──────────────────
DO $$
DECLARE
  v_b        uuid := '62cd2073-96e0-4300-adae-4c1bb8934546';
  v_b_admin  uuid := '8ebd6637-489e-473e-9583-807ab1e3154e';
  v_suspendu uuid := '19500c66-20a9-46fb-8ffa-089577d9512f';
  v_imp uuid; n int;
BEGIN
  IF (SELECT role FROM core.organization_members WHERE org_id = v_b AND user_id = v_suspendu) IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'donnée de test : % n''est plus org_admin de B', v_suspendu;
  END IF;
  UPDATE core.organization_members SET status = 'suspended' WHERE org_id = v_b AND user_id = v_suspendu;
  PERFORM set_config('request.jwt.claim.sub', v_b_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_imp := public.clients_import_start(v_b, 'cimaj.csv', NULL, '[]', '{}');
  PERFORM set_config('request.jwt.claim.sub', v_suspendu::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_suspendu, 'role', 'authenticated')::text, true);
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_start(%L, 'f.csv', NULL, '[]', '{}')$q$, v_b), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_batch(%L, '[{"import_line": 1, "display_name": "SUSPENDU"}]'::jsonb)$q$, v_imp), 'org_admin_required', '42501');
  SET LOCAL ROLE postgres;
  SELECT count(*) INTO n FROM majordhome.clients WHERE import_id = v_imp;
  IF n <> 0 THEN RAISE EXCEPTION 'un org_admin suspendu a écrit % fiche(s)', n; END IF;
  UPDATE core.organization_members SET status = 'active' WHERE org_id = v_b AND user_id = v_suspendu;
  RAISE NOTICE 'adhésion non active : OK';
END $$;

-- ── Parrain dans le même import : la fiche libérée est retirée, « retire » seulement à la fin ──
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp uuid; v_x uuid; v_y uuid; r jsonb; i int := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_imp := public.clients_import_start(v_a, 'parrains.csv', NULL, '[]', '{}');
  PERFORM public.clients_import_batch(v_imp, '[{"import_line": 1, "display_name": "FILLEUL X"}, {"import_line": 2, "display_name": "PARRAIN Y"}]');
  SET LOCAL ROLE postgres;
  SELECT id INTO v_x FROM majordhome.clients WHERE import_id = v_imp AND import_line = 1;
  SELECT id INTO v_y FROM majordhome.clients WHERE import_id = v_imp AND import_line = 2;
  UPDATE majordhome.clients SET parrain_id = v_y WHERE id = v_x;
  SET LOCAL ROLE authenticated;
  r := public.clients_import_remove(v_imp);
  IF r IS DISTINCT FROM '{"retirees": 1, "conservees": 0, "restantes": 1}'::jsonb THEN RAISE EXCEPTION 'parrain, 1er appel : %', r; END IF;
  IF (SELECT status FROM public.majordhome_client_imports WHERE id = v_imp) <> 'en_cours' THEN RAISE EXCEPTION 'retire posé alors que le parrain reste'; END IF;
  WHILE (r->>'restantes')::int > 0 LOOP
    i := i + 1;
    IF i > 5 THEN RAISE EXCEPTION 'retrait qui ne converge pas : %', r; END IF;
    r := public.clients_import_remove(v_imp);
  END LOOP;
  IF (SELECT status FROM public.majordhome_client_imports WHERE id = v_imp) <> 'retire' THEN RAISE EXCEPTION 'statut retire attendu à la fin'; END IF;
  SET LOCAL ROLE postgres;
  IF EXISTS (SELECT 1 FROM majordhome.clients WHERE id IN (v_x, v_y)) THEN RAISE EXCEPTION 'parrain ou filleul resté'; END IF;
  RAISE NOTICE 'parrain dans le même import : OK';
END $$;

-- ── Suppression incomplète : un projet que la base ne supprime pas annule tout ──
-- Le trigger de test avale la suppression du projet « BLOQUE », comme le ferait une RLS qui masquerait la ligne.
CREATE OR REPLACE FUNCTION public.zz_projet_bloque() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.name = 'BLOQUE' THEN RETURN NULL; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER zz_projet_bloque BEFORE DELETE ON core.projects FOR EACH ROW EXECUTE FUNCTION public.zz_projet_bloque();
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp uuid; n int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_imp := public.clients_import_start(v_a, 'bloque.csv', NULL, '[]', '{}');
  PERFORM public.clients_import_batch(v_imp, '[{"import_line": 1, "display_name": "BLOQUE"}, {"import_line": 2, "display_name": "LIBRE"}]');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.clients_import_remove(%L)$q$, v_imp), 'removal_incomplete', 'P0001');
  SET LOCAL ROLE postgres;
  SELECT count(*) INTO n FROM majordhome.clients WHERE import_id = v_imp;
  IF n <> 2 THEN RAISE EXCEPTION 'removal_incomplete n''a pas tout annulé : % fiche(s) sur 2', n; END IF;
  IF (SELECT status FROM majordhome.client_imports WHERE id = v_imp) <> 'en_cours' THEN RAISE EXCEPTION 'statut changé malgré removal_incomplete'; END IF;
  RAISE NOTICE 'suppression incomplète : OK';
END $$;
DROP TRIGGER zz_projet_bloque ON core.projects;
DROP FUNCTION public.zz_projet_bloque();

-- ── Mesure (Step 5) : 200 lignes écrites puis retirées ──────────────────────
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp uuid; v_rows jsonb; t0 timestamptz; d_lot numeric; d_ret numeric; r jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('import_line', g, 'display_name', 'MESURE Client ' || g, 'last_name', 'MESURE',
           'first_name', 'Client ' || g, 'email', 'mesure' || g || '@example.test', 'phone', '06' || lpad(g::text, 8, '0'),
           'address', g || ' rue des Essais', 'postal_code', '81600', 'city', 'Gaillac', 'housing_type', 'maison',
           'surface', 100, 'construction_year', 1990, 'notes', 'note ' || g, 'external_ref', 'M-' || g))
    INTO v_rows FROM generate_series(1, 200) g;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_imp := public.clients_import_start(v_a, 'mesure.csv', 'Mesure', '[]', '{}');
  t0 := clock_timestamp();
  r := public.clients_import_batch(v_imp, v_rows);
  d_lot := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  IF (r->>'created')::int <> 200 THEN RAISE EXCEPTION 'mesure : %', r; END IF;
  t0 := clock_timestamp();
  r := public.clients_import_remove(v_imp, 200);
  d_ret := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  IF r IS DISTINCT FROM '{"retirees": 200, "conservees": 0, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'mesure retrait : %', r; END IF;
  SET LOCAL ROLE postgres;
  RAISE NOTICE 'MESURE duree_ms lot de 200 = % ; retrait de 200 = % (trigger d''audit actif : %)', d_lot, d_ret,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'majordhome.clients'::regclass AND tgname = 'trg_audit_clients' AND tgenabled <> 'D');
  IF d_lot > 2000 OR d_ret > 2000 THEN RAISE EXCEPTION 'mesure au-dessus de 2 000 ms : lot %, retrait %', d_lot, d_ret; END IF;
END $$;

-- ── Import sans aucune fiche (20261122_1) : un appel le passe à « retire » ──
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp uuid; r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_imp := public.clients_import_start(v_a, 'vide.csv', NULL, '[]', '{"lues": 3, "prevues": 3, "doublons_ecartes": 0, "ecartees": 0}');
  r := public.clients_import_removal_preview(v_imp);
  IF r IS DISTINCT FROM '{"retirables": 0, "conservees": 0}'::jsonb THEN RAISE EXCEPTION 'import vide, preview : %', r; END IF;
  r := public.clients_import_remove(v_imp);
  IF r IS DISTINCT FROM '{"retirees": 0, "conservees": 0, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'import vide, remove : %', r; END IF;
  SET LOCAL ROLE postgres;
  IF (SELECT status = 'retire' AND removed_by = v_admin
            AND counts = '{"lues": 3, "prevues": 3, "doublons_ecartes": 0, "ecartees": 0, "retirees": 0, "conservees": 0}'::jsonb
        FROM majordhome.client_imports WHERE id = v_imp) IS NOT TRUE THEN
    RAISE EXCEPTION 'import vide : %', (SELECT row_to_json(i) FROM majordhome.client_imports i WHERE id = v_imp);
  END IF;
  RAISE NOTICE 'import vide retiré de la liste : OK';
END $$;

-- ── Mesure D1 (20261122_1) : un appel de retrait sur un import de 3 000 fiches, p_limit 100 puis 200 ──
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp uuid; t0 timestamptz; d_ins numeric; d_100 numeric; d_200 numeric; d_calc numeric; r jsonb; r2 jsonb; i int;
BEGIN
  -- client_number = 'CLI-' || lpad(n, 5) : au-delà de 99 999 le numéro est tronqué. 3 000 numéros libres à partir de 50 001.
  PERFORM setval('majordhome.client_number_seq', 50000);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_imp := public.clients_import_start(v_a, 'mesure-3000.csv', 'Mesure', '[]', '{}');
  t0 := clock_timestamp();
  FOR i IN 0..14 LOOP
    PERFORM public.clients_import_batch(v_imp, (
      SELECT jsonb_agg(jsonb_build_object('import_line', g, 'display_name', 'TROISMILLE Client ' || g, 'last_name', 'TROISMILLE',
               'first_name', 'Client ' || g, 'email', 'troismille' || g || '@example.test', 'phone', '07' || lpad(g::text, 8, '0'),
               'postal_code', '81600', 'city', 'Gaillac', 'external_ref', 'T-' || g))
        FROM generate_series(i * 200 + 1, i * 200 + 200) g));
  END LOOP;
  d_ins := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  SET LOCAL ROLE postgres;
  t0 := clock_timestamp();
  PERFORM majordhome.clients_import_retirables(v_imp);
  d_calc := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  SET LOCAL ROLE authenticated;
  t0 := clock_timestamp();
  r := public.clients_import_remove(v_imp, 100);
  d_100 := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  t0 := clock_timestamp();
  r2 := public.clients_import_remove(v_imp, 200);
  d_200 := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  SET LOCAL ROLE postgres;
  IF r IS DISTINCT FROM '{"retirees": 100, "conservees": 0, "restantes": 2900}'::jsonb THEN RAISE EXCEPTION 'mesure 3000, p_limit 100 : %', r; END IF;
  IF r2 IS DISTINCT FROM '{"retirees": 200, "conservees": 0, "restantes": 2700}'::jsonb THEN RAISE EXCEPTION 'mesure 3000, p_limit 200 : %', r2; END IF;
  RAISE NOTICE 'MESURE 3000 fiches : 15 lots écrits en % ms ; un calcul des retirables % ms ; retrait p_limit 100 = % ms ; p_limit 200 = % ms (trigger d''audit actif : %, clés étrangères vers clients / projects : %)',
    d_ins, d_calc, d_100, d_200,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'majordhome.clients'::regclass AND tgname = 'trg_audit_clients' AND tgenabled <> 'D'),
    (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('majordhome.clients'::regclass, 'core.projects'::regclass));
  IF d_100 > 8000 OR d_200 > 8000 THEN RAISE EXCEPTION 'retrait au-dessus du plafond PostgREST de 8 s : % / % ms', d_100, d_200; END IF;
END $$;

DROP FUNCTION public.zz_assert_erreur(text, text, text);
