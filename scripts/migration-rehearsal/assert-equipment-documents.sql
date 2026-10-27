-- assert-equipment-documents.sql — vérifie 20261028_5_equipment_documents.sql.
-- Un écart lève une exception → run.mjs sort en ECHEC.

-- ── A. Structure + clé de rapprochement ─────────────────────────────────────
DO $$
DECLARE v_k text;
BEGIN
  IF to_regclass('majordhome.equipment_documents') IS NULL THEN RAISE EXCEPTION 'table equipment_documents absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'majordhome.equipment_documents'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'equipment_documents sans RLS'; END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'majordhome.equipment_model_key(text)'::regprocedure) <> 'i' THEN
    RAISE EXCEPTION 'equipment_model_key pas IMMUTABLE'; END IF;
  IF has_function_privilege('anon', 'majordhome.equipment_model_key(text)', 'EXECUTE') THEN RAISE EXCEPTION 'equipment_model_key exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'majordhome.equipment_model_key(text)', 'EXECUTE') THEN RAISE EXCEPTION 'equipment_model_key non exécutable par authenticated (la vue par équipement en a besoin)'; END IF;

  -- la clé : « Jøtul F 370 » et « JOTUL F-370 » sont le même modèle, les accents tombent, le vide est NULL
  v_k := majordhome.equipment_model_key('Jøtul');            IF v_k <> 'jotul' THEN RAISE EXCEPTION 'clé Jøtul = %', v_k; END IF;
  v_k := majordhome.equipment_model_key('JØTUL');            IF v_k <> 'jotul' THEN RAISE EXCEPTION 'clé JØTUL = %', v_k; END IF;
  v_k := majordhome.equipment_model_key(' F-370 ');          IF v_k <> 'f370' THEN RAISE EXCEPTION 'clé F-370 = %', v_k; END IF;
  v_k := majordhome.equipment_model_key('F 370');            IF v_k <> 'f370' THEN RAISE EXCEPTION 'clé F 370 = %', v_k; END IF;
  v_k := majordhome.equipment_model_key('Édition Été Ça');   IF v_k <> 'editioneteca' THEN RAISE EXCEPTION 'clé accents = %', v_k; END IF;
  v_k := majordhome.equipment_model_key('Straße Œuvre');     IF v_k <> 'strasseoeuvre' THEN RAISE EXCEPTION 'clé ß/œ = %', v_k; END IF;
  IF majordhome.equipment_model_key('- / -') IS NOT NULL THEN RAISE EXCEPTION 'clé vide doit être NULL'; END IF;
  IF majordhome.equipment_model_key('À renseigner') IS NOT NULL THEN RAISE EXCEPTION '« À renseigner » (placeholder import) doit donner NULL'; END IF;
  IF majordhome.equipment_model_key('Inconnu') IS NOT NULL THEN RAISE EXCEPTION '« Inconnu » doit donner NULL'; END IF;
  IF majordhome.equipment_model_key(NULL) IS NOT NULL THEN RAISE EXCEPTION 'clé de NULL doit être NULL'; END IF;

  -- policies : écritures sous role_can(clients), lecture membre
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='majordhome' AND tablename='equipment_documents' AND cmd='INSERT' AND with_check LIKE '%role_can(org_id, ''clients''::text, ''edit''::text)%') THEN
    RAISE EXCEPTION 'policy INSERT role_can(clients, edit) absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='majordhome' AND tablename='equipment_documents' AND cmd='DELETE' AND qual LIKE '%role_can(org_id, ''clients''::text, ''delete''::text)%') THEN
    RAISE EXCEPTION 'policy DELETE role_can(clients, delete) absente'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='majordhome' AND tablename='equipment_documents' AND cmd IN ('INSERT','UPDATE','DELETE') AND coalesce(with_check, qual) NOT LIKE '%role_can(%') THEN
    RAISE EXCEPTION 'policy d''écriture « tout membre » sur equipment_documents'; END IF;

  -- ACL table / vues
  IF has_table_privilege('anon', 'majordhome.equipment_documents', 'SELECT') THEN RAISE EXCEPTION 'anon lit equipment_documents'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.equipment_documents', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur equipment_documents'; END IF;
  IF has_table_privilege('service_role', 'majordhome.equipment_documents', 'INSERT') THEN RAISE EXCEPTION 'service_role avec INSERT sur equipment_documents'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname='majordhome_equipment_documents' AND c.reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'majordhome_equipment_documents sans security_invoker'; END IF;
  IF (SELECT is_updatable FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_equipment_documents') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_equipment_documents pas updatable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname='majordhome_equipment_model_documents' AND c.reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'majordhome_equipment_model_documents sans security_invoker'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'majordhome.equipment_documents'::regclass AND t.tgname = 'equipment_documents_set_keys' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'trigger equipment_documents_set_keys absent'; END IF;
  RAISE NOTICE 'assert-equipment-documents A (structure) : OK';
END $$;

-- ── B. Fonctionnel (rollback, impersonation) ────────────────────────────────
-- Un technicien dépose la notice depuis la fiche d'un client ; elle apparaît sur TOUS les équipements de
-- même marque + modèle de l'org (clé insensible à la casse / ponctuation) ; il ne peut pas la retirer ;
-- l'org_admin le peut. Modèle vide refusé. Chemin Storage hors du préfixe org refusé.
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_tech uuid; v_eq uuid; v_eq2 uuid; v_brand text; v_model text; v_doc uuid; v_n int; ok boolean;
BEGIN
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role = 'org_admin' LIMIT 1;
  SELECT om.user_id INTO v_tech FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role <> 'org_admin' LIMIT 1;
  IF v_admin IS NULL OR v_tech IS NULL THEN RAISE EXCEPTION 'fixture : il faut un org_admin et un membre non admin Mayer'; END IF;

  -- deux équipements Mayer de même marque + modèle (il y en a : parc de 900 appareils), sinon on en fabrique un second
  SELECT e.brand, e.model, min(e.id::text)::uuid INTO v_brand, v_model, v_eq
    FROM majordhome.equipments e JOIN core.projects p ON p.id = e.project_id
   WHERE p.org_id = v_mayer AND e.brand IS NOT NULL AND e.model IS NOT NULL
     AND majordhome.equipment_model_key(e.brand) IS NOT NULL AND majordhome.equipment_model_key(e.model) IS NOT NULL
   GROUP BY e.brand, e.model ORDER BY count(*) DESC, e.brand LIMIT 1;
  IF lower(v_brand) LIKE '%renseigner%' THEN RAISE EXCEPTION 'la fixture a retenu le placeholder « À renseigner » : la clé ne l''exclut pas'; END IF;
  IF v_eq IS NULL THEN RAISE EXCEPTION 'fixture : aucun équipement Mayer avec marque + modèle dans le snapshot'; END IF;
  SELECT e.id INTO v_eq2 FROM majordhome.equipments e JOIN core.projects p ON p.id = e.project_id
   WHERE p.org_id = v_mayer AND e.id <> v_eq AND e.brand = v_brand AND e.model = v_model LIMIT 1;
  IF v_eq2 IS NULL THEN
    INSERT INTO majordhome.equipments (project_id, brand, model) SELECT project_id, v_brand, v_model FROM majordhome.equipments WHERE id = v_eq RETURNING id INTO v_eq2;
  END IF;

  -- (1) technicien : dépôt accepté (clients.edit = tous), marque / modèle saisis AUTREMENT (majuscules, tirets)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, label, file_name, storage_path, mime_type)
  VALUES (v_mayer, upper(v_brand), replace(v_model, ' ', '-'), 'notice', 'Notice', 'notice.pdf', v_mayer || '/equipment-models/x.pdf', 'application/pdf')
  RETURNING id INTO v_doc;

  -- (2) visible sur les DEUX équipements par la vue par équipement
  SELECT count(*) INTO v_n FROM public.majordhome_equipment_model_documents WHERE org_id = v_mayer AND equipment_id IN (v_eq, v_eq2) AND id = v_doc;
  IF v_n <> 2 THEN RAISE EXCEPTION 'document du modèle vu sur % équipement(s) au lieu de 2', v_n; END IF;

  -- (3) modèle sans lettre ni chiffre refusé ; « À renseigner » refusé ; chemin hors préfixe org refusé
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, file_name, storage_path)
    VALUES (v_mayer, 'À renseigner', 'À renseigner', 'notice', 'x.pdf', v_mayer || '/equipment-models/y.pdf');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un dépôt sur « À renseigner » a été accepté'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, file_name, storage_path)
    VALUES (v_mayer, v_brand, '---', 'autre', 'x.pdf', v_mayer || '/equipment-models/y.pdf');
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un modèle vide a été accepté'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, file_name, storage_path)
    VALUES (v_mayer, v_brand, v_model, 'autre', 'x.pdf', gen_random_uuid() || '/equipment-models/y.pdf');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un chemin Storage hors de l''org a été accepté'; END IF;

  -- (4) technicien : retrait refusé (RLS filtre : 0 ligne)
  DELETE FROM public.majordhome_equipment_documents WHERE id = v_doc;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'un membre non admin a retiré un document du modèle'; END IF;
  RESET ROLE;

  -- (5) org_admin : retrait accepté
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  DELETE FROM public.majordhome_equipment_documents WHERE id = v_doc;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'l''org_admin n''a pas pu retirer le document'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- (6) anon : rien
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN
    PERFORM 1 FROM public.majordhome_equipment_documents;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'anon lit la vue majordhome_equipment_documents'; END IF;

  RAISE NOTICE 'assert-equipment-documents B (fonctionnel) : OK — modèle testé « % % » sur % / %', v_brand, v_model, v_eq, v_eq2;
END $$;
ROLLBACK;
