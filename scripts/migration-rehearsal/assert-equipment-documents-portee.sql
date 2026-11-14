-- assert-equipment-documents-portee.sql — vérifie 20261114_1_equipment_documents_portee.sql
-- (chaîne : 20261028_5 → 20261111_1 → _2 → _3 → _4 → _5 → _6 → 20261112_4 → _5 → _6 → _7 → _8 → 20261114_1 ;
-- equipment_documents n'est pas photographiée). À lancer avec assert-equipment-documents.sql (comportement d'avant).
-- Couvre : (1) structure, contraintes, vues security_invoker fermées à anon ; (2) dépôt « cet appareil » par un
-- technicien ; (3) défaut `modele` ; (4) portée marque ; (5) exigences de marque / modèle par portée ; (6) garde
-- d'équipement et de chemin ; (7) retrait selon la portée ; (8) immuabilité de la portée et de l'équipement ;
-- (9) vue par équipement : chaque document n'apparaît que là où sa portée le dit, relevé inchangé.
-- Les écarts lèvent une exception → run.mjs sort en ECHEC. Fixtures annulées par le ROLLBACK final.

-- ── (1) Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE v_txt text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'equipment_documents'
                 AND column_name = 'scope' AND is_nullable = 'NO' AND column_default LIKE '''modele''%') THEN
    RAISE EXCEPTION '(1) colonne scope absente, NULLable ou sans défaut ''modele''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'equipment_documents'
                 AND column_name = 'equipment_id' AND is_nullable = 'YES' AND data_type = 'uuid') THEN
    RAISE EXCEPTION '(1) colonne equipment_id absente ou NOT NULL';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'equipment_documents'
      AND column_name IN ('brand', 'model', 'brand_key', 'model_key') AND is_nullable = 'YES') <> 4 THEN
    RAISE EXCEPTION '(1) brand / model / brand_key / model_key doivent être NULLables';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'majordhome.equipment_documents'::regclass AND contype = 'f'
                 AND confrelid = 'majordhome.equipments'::regclass AND confdeltype = 'c') THEN
    RAISE EXCEPTION '(1) FK equipment_id → equipments ON DELETE CASCADE absente';
  END IF;
  SELECT string_agg(conname, ',' ORDER BY conname) INTO v_txt FROM pg_constraint
  WHERE conrelid = 'majordhome.equipment_documents'::regclass AND contype = 'c'
    AND conname IN ('equipment_documents_scope_check', 'equipment_documents_scope_equipment', 'equipment_documents_scope_releve', 'equipment_documents_scope_marque',
                    'equipment_documents_storage_path_org', 'equipment_documents_site_path_reserved', 'equipment_documents_source_model');
  IF v_txt IS DISTINCT FROM 'equipment_documents_scope_check,equipment_documents_scope_equipment,equipment_documents_scope_marque,equipment_documents_scope_releve,equipment_documents_site_path_reserved,equipment_documents_source_model,equipment_documents_storage_path_org' THEN
    RAISE EXCEPTION '(1) contraintes CHECK : %', v_txt;
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'majordhome.equipment_documents'::regclass AND conname = 'equipment_documents_scope_check'))
     NOT LIKE '%marque%modele%appareil%' THEN
    RAISE EXCEPTION '(1) CHECK portée inattendu';
  END IF;
  -- vues : security_invoker, fermées à anon, colonnes nouvelles en fin
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.majordhome_equipment_documents'::regclass AND c.reloptions::text LIKE '%security_invoker=true%')
     OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.majordhome_equipment_model_documents'::regclass AND c.reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION '(1) vue sans security_invoker';
  END IF;
  IF has_table_privilege('anon', 'public.majordhome_equipment_model_documents', 'SELECT') THEN RAISE EXCEPTION '(1) anon lit majordhome_equipment_model_documents'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_equipment_documents', 'SELECT') THEN RAISE EXCEPTION '(1) anon lit majordhome_equipment_documents'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_equipment_documents', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.majordhome_equipment_model_documents', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.majordhome_equipment_model_documents', 'SELECT') THEN
    RAISE EXCEPTION '(1) droits authenticated / service_role perdus sur les vues';
  END IF;
  IF (SELECT is_updatable FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_equipment_documents') <> 'YES' THEN
    RAISE EXCEPTION '(1) miroir majordhome_equipment_documents plus updatable';
  END IF;
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_txt FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'majordhome_equipment_documents';
  IF v_txt NOT LIKE '%,equipment_model_id,source,scope,equipment_id' THEN RAISE EXCEPTION '(1) colonnes du miroir : %', v_txt; END IF;
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_txt FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'majordhome_equipment_model_documents';
  IF v_txt NOT LIKE 'equipment_id,id,%,equipment_model_id,from_site,scope' THEN RAISE EXCEPTION '(1) colonnes de la vue par équipement : %', v_txt; END IF;
  -- le trigger ne se limite plus à UPDATE OF brand, model (sinon l'immuabilité ne serait pas tenue)
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'majordhome.equipment_documents'::regclass AND t.tgname = 'equipment_documents_set_keys'
             AND t.tgattr::text <> '') THEN
    RAISE EXCEPTION '(1) trigger equipment_documents_set_keys encore limité à certaines colonnes';
  END IF;
  -- policy de retrait : relevé jamais, appareil sous clients.edit, sinon clients.delete
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'equipment_documents' AND cmd = 'DELETE'
                 AND qual LIKE '%equipment_model_id IS NULL%' AND qual LIKE '%''appareil''%' AND qual LIKE '%''edit''%' AND qual LIKE '%''delete''%') THEN
    RAISE EXCEPTION '(1) policy de retrait par portée absente';
  END IF;
  IF has_function_privilege('authenticated', 'majordhome.equipment_documents_set_keys()', 'EXECUTE') THEN RAISE EXCEPTION '(1) fonction de trigger exécutable par authenticated'; END IF;
  RAISE NOTICE 'assert-equipment-documents-portee (1) structure : OK';
END $$;

-- ── (2)-(9) Fonctionnel (impersonation) ──────────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre_org uuid; v_admin uuid; v_tech uuid; v_proj uuid; v_proj_autre uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_e4 uuid; v_e_autre uuid; v_m uuid;
  v_app uuid; v_app2 uuid; v_mod uuid; v_marque uuid; v_releve uuid;
  v_r record; v_n int; ok boolean; v_err text;
BEGIN
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role = 'org_admin' LIMIT 1;
  SELECT om.user_id INTO v_tech FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role <> 'org_admin' LIMIT 1;
  IF v_admin IS NULL OR v_tech IS NULL THEN RAISE EXCEPTION 'fixture : il faut un org_admin et un membre non admin Mayer'; END IF;
  SELECT o.id INTO v_autre_org FROM core.organizations o WHERE o.id <> v_mayer ORDER BY o.id LIMIT 1;
  IF v_autre_org IS NULL THEN RAISE EXCEPTION 'fixture : il faut une seconde organisation dans le snapshot'; END IF;

  -- fixtures (postgres) : e1 / e4 = même marque + modèle ; e2 = même marque, autre modèle ; e3 = autre marque, même
  -- nom de modèle ; e_autre = équipement d'une autre org. e1 est rattaché à un modèle fabricant qui porte un relevé.
  INSERT INTO core.projects (org_id, name, status) VALUES (v_mayer, 'TEST PORTEE projet', 'active') RETURNING id INTO v_proj;
  INSERT INTO core.projects (org_id, name, status) VALUES (v_autre_org, 'TEST PORTEE projet autre org', 'active') RETURNING id INTO v_proj_autre;
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'TestPortee', 'Modele Un') RETURNING id INTO v_e1;
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'TestPortee', 'Modele Deux') RETURNING id INTO v_e2;
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'AutrePortee', 'Modele Un') RETURNING id INTO v_e3;
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'TESTPORTEE', 'modele-un') RETURNING id INTO v_e4;
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj_autre, 'autre', 'TestPortee', 'Modele Un') RETURNING id INTO v_e_autre;
  INSERT INTO majordhome.equipment_models (org_id, brand, source_id, reference, name, model_name)
  VALUES (v_mayer, 'TestPortee', 'TP1', 'TPREF1', 'POELE TEST PORTEE', 'TEST PORTEE') RETURNING id INTO v_m;
  UPDATE majordhome.equipments SET equipment_model_id = v_m WHERE id = v_e1;
  -- relevé par l'écrivain réel, deux fois (le second passage emprunte ON CONFLICT DO UPDATE, donc le trigger en UPDATE)
  PERFORM public.equipment_models_set_files(v_mayer, 'TestPortee', 'p1', jsonb_build_array(jsonb_build_object('source_id', 'TP1',
    'documents', jsonb_build_array(jsonb_build_object('id', 'R1', 'type', 'notice', 'label', 'Notice', 'file_name', 'r1.pdf',
      'storage_path', v_mayer || '/equipment-models/site/doc-r1.pdf', 'file_size', 10, 'mime_type', 'application/pdf', 'fileKey', 'K')))));
  PERFORM public.equipment_models_set_files(v_mayer, 'TestPortee', 'p2', jsonb_build_array(jsonb_build_object('source_id', 'TP1',
    'documents', jsonb_build_array(jsonb_build_object('id', 'R1', 'type', 'notice', 'label', 'Notice v2', 'file_name', 'r1.pdf',
      'storage_path', v_mayer || '/equipment-models/site/doc-r1.pdf', 'file_size', 10, 'mime_type', 'application/pdf', 'fileKey', 'K')))));
  SELECT id INTO v_releve FROM majordhome.equipment_documents WHERE equipment_model_id = v_m AND source ->> 'id' = 'R1' AND label = 'Notice v2';
  IF v_releve IS NULL THEN RAISE EXCEPTION 'fixture : document relevé non écrit par equipment_models_set_files'; END IF;
  IF (SELECT scope FROM majordhome.equipment_documents WHERE id = v_releve) <> 'modele' THEN RAISE EXCEPTION '(9) document relevé hors portée modele'; END IF;
  -- un relevé ne peut pas être d'une autre portée (même écrit par le serveur)
  ok := false;
  BEGIN
    INSERT INTO majordhome.equipment_documents (org_id, brand, document_type, file_name, storage_path, equipment_model_id, source, scope)
    VALUES (v_mayer, 'TestPortee', 'notice', 'x.pdf', v_mayer || '/equipment-models/site/x.pdf', v_m, '{"id":"R9"}'::jsonb, 'marque');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(1) document relevé de portée marque accepté'; END IF;

  -- technicien
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);

  -- (2) dépôt « cet appareil » accepté, chemin sous l'équipement
  INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, label, file_name, storage_path, mime_type, scope, equipment_id)
  VALUES (v_mayer, 'TestPortee', 'Modele Un', 'autre', 'Photo installation', 'x.pdf', v_mayer || '/equipments/' || v_e1 || '/x.pdf', 'application/pdf', 'appareil', v_e1)
  RETURNING id INTO v_app;
  SELECT * INTO v_r FROM public.majordhome_equipment_documents WHERE id = v_app;
  IF v_r.scope <> 'appareil' OR v_r.equipment_id <> v_e1 OR v_r.storage_path <> v_mayer || '/equipments/' || v_e1 || '/x.pdf' THEN
    RAISE EXCEPTION '(2) dépôt appareil inattendu : % / % / %', v_r.scope, v_r.equipment_id, v_r.storage_path;
  END IF;

  -- (3) sans portée ⇒ modele (ancien écran en cache)
  INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, file_name, storage_path)
  VALUES (v_mayer, 'TestPortee', 'Modele Un', 'notice', 'm.pdf', v_mayer || '/equipment-models/m.pdf')
  RETURNING id INTO v_mod;
  SELECT * INTO v_r FROM public.majordhome_equipment_documents WHERE id = v_mod;
  IF v_r.scope <> 'modele' OR v_r.equipment_id IS NOT NULL OR v_r.model_key <> 'modeleun' THEN RAISE EXCEPTION '(3) défaut de portée : % / %', v_r.scope, v_r.model_key; END IF;

  -- (4) marque : marque utile exigée ; modèle fourni effacé
  v_err := NULL;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, file_name, storage_path, scope)
    VALUES (v_mayer, '---', 'Modele Un', 'autre', 'b.pdf', v_mayer || '/equipment-models/b.pdf', 'marque');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'equipment_document_brand_required' THEN RAISE EXCEPTION '(4) marque vide : %', coalesce(v_err, 'acceptée'); END IF;
  v_err := NULL;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, document_type, file_name, storage_path, scope)
    VALUES (v_mayer, 'autre', 'b.pdf', v_mayer || '/equipment-models/b.pdf', 'marque');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'equipment_document_brand_required' THEN RAISE EXCEPTION '(4) marque absente : %', coalesce(v_err, 'acceptée'); END IF;
  INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, file_name, storage_path, scope)
  VALUES (v_mayer, 'TestPortee', 'Modele Deux', 'autre', 'b.pdf', v_mayer || '/equipment-models/b.pdf', 'marque')
  RETURNING id INTO v_marque;
  SELECT * INTO v_r FROM public.majordhome_equipment_documents WHERE id = v_marque;
  IF v_r.model IS NOT NULL OR v_r.model_key IS NOT NULL OR v_r.brand_key <> 'testportee' THEN
    RAISE EXCEPTION '(4) document de marque : model=% model_key=% brand_key=%', v_r.model, v_r.model_key, v_r.brand_key;
  END IF;

  -- (5) appareil sans marque ni modèle accepté ; modele sans modèle refusé
  INSERT INTO public.majordhome_equipment_documents (org_id, document_type, file_name, storage_path, scope, equipment_id)
  VALUES (v_mayer, 'autre', 'y.pdf', v_mayer || '/equipments/' || v_e2 || '/y.pdf', 'appareil', v_e2)
  RETURNING id INTO v_app2;
  IF (SELECT brand_key IS NULL AND model_key IS NULL FROM public.majordhome_equipment_documents WHERE id = v_app2) IS NOT TRUE THEN
    RAISE EXCEPTION '(5) clés inattendues sur un document appareil sans marque ni modèle';
  END IF;
  v_err := NULL;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, brand, document_type, file_name, storage_path, scope)
    VALUES (v_mayer, 'TestPortee', 'notice', 'z.pdf', v_mayer || '/equipment-models/z.pdf', 'modele');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'equipment_document_model_required' THEN RAISE EXCEPTION '(5) modele sans modèle : %', coalesce(v_err, 'accepté'); END IF;

  -- (6) garde d'équipement et de chemin
  v_err := NULL;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, document_type, file_name, storage_path, scope, equipment_id)
    VALUES (v_mayer, 'autre', 'g.pdf', v_mayer || '/equipments/00000000-0000-0000-0000-000000000000/g.pdf', 'appareil', '00000000-0000-0000-0000-000000000000');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'equipment_document_equipment_required' THEN RAISE EXCEPTION '(6) équipement inexistant : %', coalesce(v_err, 'accepté'); END IF;
  v_err := NULL;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, document_type, file_name, storage_path, scope, equipment_id)
    VALUES (v_mayer, 'autre', 'g.pdf', v_mayer || '/equipments/' || v_e_autre || '/g.pdf', 'appareil', v_e_autre);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'equipment_document_equipment_required' THEN RAISE EXCEPTION '(6) équipement d''une autre org : %', coalesce(v_err, 'accepté'); END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, document_type, file_name, storage_path, scope)
    VALUES (v_mayer, 'autre', 'g.pdf', v_mayer || '/equipments/x/g.pdf', 'appareil');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(6) appareil sans equipment_id accepté'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, document_type, file_name, storage_path, scope, equipment_id)
    VALUES (v_mayer, 'autre', 'g.pdf', v_mayer || '/equipment-models/g.pdf', 'appareil', v_e1);
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(6) appareil rangé sous equipment-models accepté'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, document_type, file_name, storage_path, scope, equipment_id)
    VALUES (v_mayer, 'autre', 'g.pdf', v_mayer || '/equipments/' || v_e2 || '/g.pdf', 'appareil', v_e1);
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(6) appareil rangé sous le dossier d''un autre équipement accepté'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, file_name, storage_path, scope, equipment_id)
    VALUES (v_mayer, 'TestPortee', 'Modele Un', 'autre', 'g.pdf', v_mayer || '/equipment-models/g.pdf', 'modele', v_e1);
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(6) document modele avec equipment_id accepté'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, file_name, storage_path)
    VALUES (v_mayer, 'TestPortee', 'Modele Un', 'autre', 'g.pdf', v_mayer || '/equipments/' || v_e1 || '/g.pdf');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(6) document modele rangé sous equipments accepté'; END IF;

  -- (9) vue par équipement
  -- e1 : appareil (v_app) + modèle (v_mod) + marque (v_marque) + relevé (v_releve) = 4, chacun une fois
  SELECT count(*) INTO v_n FROM public.majordhome_equipment_model_documents WHERE org_id = v_mayer AND equipment_id = v_e1;
  IF v_n <> 4 THEN RAISE EXCEPTION '(9) e1 : % documents au lieu de 4', v_n; END IF;
  IF (SELECT count(DISTINCT id) FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e1) <> 4 THEN RAISE EXCEPTION '(9) e1 : document en double'; END IF;
  IF (SELECT scope FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e1 AND id = v_app) IS DISTINCT FROM 'appareil'
     OR (SELECT scope FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e1 AND id = v_mod) IS DISTINCT FROM 'modele'
     OR (SELECT scope FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e1 AND id = v_marque) IS DISTINCT FROM 'marque' THEN
    RAISE EXCEPTION '(9) portée exposée par la vue inattendue';
  END IF;
  SELECT * INTO v_r FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e1 AND id = v_releve;
  IF v_r.scope IS DISTINCT FROM 'modele' OR v_r.from_site IS NOT TRUE THEN RAISE EXCEPTION '(9) relevé : scope=% from_site=%', v_r.scope, v_r.from_site; END IF;
  -- l'appareil ne sort pas de son équipement (e4 a pourtant la même marque + le même modèle)
  IF EXISTS (SELECT 1 FROM public.majordhome_equipment_model_documents WHERE id = v_app AND equipment_id <> v_e1) THEN
    RAISE EXCEPTION '(9) document appareil visible sur un autre équipement';
  END IF;
  IF EXISTS (SELECT 1 FROM public.majordhome_equipment_model_documents WHERE id = v_app2 AND equipment_id <> v_e2) THEN
    RAISE EXCEPTION '(9) document appareil (sans marque) visible sur un autre équipement';
  END IF;
  -- e4 (même marque + modèle, autre saisie, non rattaché) : modèle + marque, ni appareil ni relevé
  IF (SELECT string_agg(scope, ',' ORDER BY scope) FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e4) IS DISTINCT FROM 'marque,modele' THEN
    RAISE EXCEPTION '(9) e4 : %', (SELECT string_agg(scope, ',' ORDER BY scope) FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e4);
  END IF;
  -- e2 (même marque, autre modèle) : marque + son appareil, pas le modèle
  IF NOT EXISTS (SELECT 1 FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e2 AND id = v_marque) THEN
    RAISE EXCEPTION '(9) document de marque absent d''un équipement de même marque, autre modèle';
  END IF;
  IF EXISTS (SELECT 1 FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e2 AND id = v_mod) THEN
    RAISE EXCEPTION '(9) document de modèle visible sur un autre modèle';
  END IF;
  -- e3 (autre marque, même nom de modèle) : rien
  IF EXISTS (SELECT 1 FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e3) THEN
    RAISE EXCEPTION '(9) documents visibles sur un équipement d''une autre marque';
  END IF;

  -- (8) immuabilité ; une modification ordinaire passe
  UPDATE public.majordhome_equipment_documents SET label = 'Photo de la chaufferie' WHERE id = v_app;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '(8) modification du libellé d''un document appareil refusée'; END IF;
  v_err := NULL;
  BEGIN UPDATE public.majordhome_equipment_documents SET scope = 'modele' WHERE id = v_marque;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'equipment_document_scope_immutable' THEN RAISE EXCEPTION '(8) changement de portée : %', coalesce(v_err, 'accepté'); END IF;
  v_err := NULL;
  BEGIN UPDATE public.majordhome_equipment_documents SET scope = 'modele', equipment_id = NULL WHERE id = v_app;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'equipment_document_scope_immutable' THEN RAISE EXCEPTION '(8) appareil → modele : %', coalesce(v_err, 'accepté'); END IF;
  v_err := NULL;
  BEGIN UPDATE public.majordhome_equipment_documents SET equipment_id = v_e1, storage_path = v_mayer || '/equipments/' || v_e1 || '/y.pdf' WHERE id = v_app2;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'equipment_document_scope_immutable' THEN RAISE EXCEPTION '(8) changement d''équipement : %', coalesce(v_err, 'accepté'); END IF;

  -- (7) retrait : technicien → son document appareil oui, modèle / marque / relevé non
  DELETE FROM public.majordhome_equipment_documents WHERE id = v_app;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '(7) technicien : retrait du document appareil = % ligne(s)', v_n; END IF;
  DELETE FROM public.majordhome_equipment_documents WHERE id = v_mod;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION '(7) technicien : document modèle retiré'; END IF;
  DELETE FROM public.majordhome_equipment_documents WHERE id = v_marque;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION '(7) technicien : document de marque retiré'; END IF;
  RESET ROLE;

  -- org_admin : modèle et marque oui, relevé toujours non
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  DELETE FROM public.majordhome_equipment_documents WHERE id IN (v_mod, v_marque);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 2 THEN RAISE EXCEPTION '(7) org_admin : retrait modèle + marque = % ligne(s)', v_n; END IF;
  DELETE FROM public.majordhome_equipment_documents WHERE id = v_releve;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION '(7) org_admin : document relevé retiré'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- suppression de l'équipement ⇒ ses documents appareil partent avec lui (ON DELETE CASCADE)
  DELETE FROM majordhome.equipments WHERE id = v_e2;
  IF EXISTS (SELECT 1 FROM majordhome.equipment_documents WHERE id = v_app2) THEN RAISE EXCEPTION '(1) document appareil survivant à son équipement'; END IF;

  RAISE NOTICE 'assert-equipment-documents-portee : OK';
END $$;
ROLLBACK;
