-- assert-equipment-models-fichiers.sql — vérifie 20261111_3_equipment_models_fichiers.sql
-- (chaîne : 20261028_5 → 20261111_1 → 20261111_2 → 20261111_3 ; equipment_documents n'est pas photographiée).
-- Couvre : droits ; types de document étendus ; equipment_models_set_files (photo / vues posées et jamais vidées,
-- documents remplacés par la liste, rejouable, chemin hors org refusé, modèle inconnu refusé, type invalide refusé) ;
-- vue par équipement : document relevé visible par le RATTACHEMENT seulement, document manuel par la clé seulement,
-- jamais en double ; garde « même organisation » sur equipments.equipment_model_id ; un membre ne peut pas insérer
-- un document rattaché à un modèle. Fixture nettoyée en fin.
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid; v_sup uuid; v_proj uuid; v_e1 uuid; v_e2 uuid; v_m uuid; v_m_autre uuid;
  v_res jsonb; v_n int; ok boolean; v_txt text;
  v_base text := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1/equipment-models/site/';
BEGIN
  -- (0) droits et structure
  IF has_function_privilege('anon', 'public.equipment_models_set_files(uuid, text, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.equipment_models_set_files(uuid, text, text, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.equipment_models_set_files(uuid, text, text, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '(0) privilèges de equipment_models_set_files inattendus';
  END IF;
  IF has_function_privilege('authenticated', 'majordhome.equipments_check_model_org()', 'EXECUTE') THEN RAISE EXCEPTION '(0) trigger exécutable'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_equipment_model_files', 'SELECT') OR has_table_privilege('anon', 'public.majordhome_equipment_model_documents', 'SELECT')
     OR has_table_privilege('anon', 'public.majordhome_equipment_documents', 'SELECT') THEN
    RAISE EXCEPTION '(0) anon lit une vue de documents';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_equipment_model_files', 'SELECT') OR has_table_privilege('authenticated', 'public.majordhome_equipment_model_files', 'INSERT') THEN
    RAISE EXCEPTION '(0) droits de majordhome_equipment_model_files inattendus';
  END IF;
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_txt FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_equipment_model_documents';
  IF v_txt NOT LIKE '%,created_at,equipment_model_id,from_site' THEN RAISE EXCEPTION '(0) colonnes de la vue par équipement : %', v_txt; END IF;

  -- fixture
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_org, 'TEST FICHIERS fournisseur', true) RETURNING id INTO v_sup;
  PERFORM public.supplier_pieces_upsert(v_org, v_sup, 'f1', 'TestFich',
    '[{"reference":"TFA","name":"TEST pièce","brand":"TestFich","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":7,"selling_price_ht_defaut":10,"tarif_public":10,"taux_remise":30,"specs":{"source_version":"f1","canonical":{}}}]'::jsonb);
  PERFORM public.equipment_models_upsert(v_org, v_sup, 'TestFich', 'f1',
    '[{"source_id":"FS1","reference":"P700001","name":"POELE FICH - P700001","model_name":"FICH","category":"Poêles","lifecycle":"en_vente","source":{"site":"https://exemple"}}]'::jsonb,
    '[{"modele_source_id":"FS1","position":1,"repere":"1","piece_reference":"TFA","quantity":1,"notes":"","prix_public":10}]'::jsonb);
  SELECT id INTO v_m FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testfich' AND source_id = 'FS1';

  -- (1) premier dépôt : photo, 1 vue, 2 documents
  v_res := public.equipment_models_set_files(v_org, 'TestFich', 'f1', jsonb_build_array(jsonb_build_object(
    'source_id', 'FS1', 'photo_path', v_base || 'img-a.webp',
    'exploded_views', jsonb_build_array(jsonb_build_object('path', v_base || 'img-b.webp', 'width', 692, 'height', 787)),
    'documents', jsonb_build_array(
      jsonb_build_object('id', 'D1', 'type', 'notice', 'label', 'Notice', 'file_name', 'Notice.pdf', 'storage_path', v_base || 'doc-e1.pdf', 'file_size', 1000, 'mime_type', 'application/pdf', 'fileKey', 'K1'),
      jsonb_build_object('id', 'D2', 'type', 'fiche_technique', 'label', 'datasheet', 'file_name', 'datasheet.pdf', 'storage_path', v_base || 'doc-e2.pdf', 'file_size', 2000, 'mime_type', 'application/pdf', 'fileKey', 'K2')))));
  IF (v_res ->> 'modeles')::int <> 1 OR (v_res ->> 'documents')::int <> 2 THEN RAISE EXCEPTION '(1) résultat inattendu : %', v_res; END IF;
  IF (SELECT photo_path FROM majordhome.equipment_models WHERE id = v_m) <> v_base || 'img-a.webp'
     OR (SELECT exploded_views -> 0 ->> 'path' FROM majordhome.equipment_models WHERE id = v_m) <> v_base || 'img-b.webp' THEN
    RAISE EXCEPTION '(1) photo / vue non posées';
  END IF;
  IF (SELECT count(*) FROM public.majordhome_equipment_model_files WHERE equipment_model_id = v_m) <> 2 THEN RAISE EXCEPTION '(1) vue par modèle : 2 documents attendus'; END IF;
  IF (SELECT model FROM majordhome.equipment_documents WHERE equipment_model_id = v_m AND source ->> 'id' = 'D1') <> 'P700001' THEN RAISE EXCEPTION '(1) modèle du document ≠ référence'; END IF;

  -- (2) rejeu avec D1 seul (D2 retiré du site), sans photo ni vue : document retiré, photo et vue CONSERVÉES
  v_res := public.equipment_models_set_files(v_org, 'TestFich', 'f2', jsonb_build_array(jsonb_build_object(
    'source_id', 'FS1',
    'documents', jsonb_build_array(
      jsonb_build_object('id', 'D1', 'type', 'notice', 'label', 'Notice v2', 'file_name', 'Notice.pdf', 'storage_path', v_base || 'doc-e3.pdf', 'file_size', 1500, 'mime_type', 'application/pdf', 'fileKey', 'K1')))));
  IF (v_res ->> 'documents_retires')::int <> 1 OR (SELECT count(*) FROM majordhome.equipment_documents WHERE equipment_model_id = v_m) <> 1 THEN
    RAISE EXCEPTION '(2) remplacement inattendu : %', v_res;
  END IF;
  IF (SELECT storage_path || '|' || label FROM majordhome.equipment_documents WHERE equipment_model_id = v_m) <> v_base || 'doc-e3.pdf|Notice v2' THEN RAISE EXCEPTION '(2) document non mis à jour'; END IF;
  IF (SELECT photo_path FROM majordhome.equipment_models WHERE id = v_m) IS NULL OR jsonb_array_length((SELECT exploded_views FROM majordhome.equipment_models WHERE id = v_m)) <> 1 THEN
    RAISE EXCEPTION '(2) photo / vue vidées par un dépôt sans image';
  END IF;

  -- (2 bis) dépôt SANS la clé documents (copie incomplète pour ce modèle) : les documents en place ne bougent pas
  v_res := public.equipment_models_set_files(v_org, 'TestFich', 'f2', jsonb_build_array(jsonb_build_object('source_id', 'FS1', 'photo_path', v_base || 'img-c.webp')));
  IF (v_res ->> 'documents_retires')::int <> 0 OR (SELECT count(*) FROM majordhome.equipment_documents WHERE equipment_model_id = v_m) <> 1 THEN
    RAISE EXCEPTION '(2 bis) documents retirés par un dépôt sans liste : %', v_res;
  END IF;
  IF (SELECT photo_path FROM majordhome.equipment_models WHERE id = v_m) <> v_base || 'img-c.webp' THEN RAISE EXCEPTION '(2 bis) photo non mise à jour'; END IF;

  -- (3) refus : chemin hors org, modèle inconnu, type invalide, liste vide
  ok := false;
  BEGIN PERFORM public.equipment_models_set_files(v_org, 'TestFich', 'f2', '[{"source_id":"FS1","photo_path":"autre-org/equipment-models/site/x.webp"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'chemin_hors_org:%'; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) chemin hors org accepté'; END IF;
  ok := false;
  BEGIN PERFORM public.equipment_models_set_files(v_org, 'TestFich', 'f2', '[{"source_id":"INCONNU"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'modele_introuvable: INCONNU%'; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) modèle inconnu accepté'; END IF;
  ok := false;
  BEGIN PERFORM public.equipment_models_set_files(v_org, 'TestFich', 'f2', jsonb_build_array(jsonb_build_object('source_id', 'FS1',
    'documents', jsonb_build_array(jsonb_build_object('id', 'D9', 'type', 'Program', 'file_name', 'x.zip', 'storage_path', v_base || 'x.zip')))));
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'document_invalide: D9%'; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) type de document invalide accepté'; END IF;
  ok := false;
  BEGIN PERFORM public.equipment_models_set_files(v_org, 'TestFich', 'f2', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'files_empty'; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) liste vide acceptée'; END IF;
  IF (SELECT count(*) FROM majordhome.equipment_documents WHERE equipment_model_id = v_m) <> 1 THEN RAISE EXCEPTION '(3) documents touchés par un appel refusé'; END IF;

  -- (4) vue par équipement : relevé par le rattachement seulement, manuel par la clé seulement, jamais en double
  INSERT INTO core.projects (org_id, name, status) VALUES (v_org, 'TEST FICHIERS projet', 'active') RETURNING id INTO v_proj;
  -- e1 : même marque + modèle saisi = référence, NON rattaché → ne voit pas le document relevé
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'TestFich', 'P700001') RETURNING id INTO v_e1;
  IF (SELECT count(*) FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e1) <> 0 THEN RAISE EXCEPTION '(4) document relevé visible sans rattachement (par la clé)'; END IF;
  UPDATE majordhome.equipments SET equipment_model_id = v_m WHERE id = v_e1;
  IF (SELECT count(*) FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e1 AND from_site) <> 1 THEN RAISE EXCEPTION '(4) document relevé non visible après rattachement'; END IF;
  -- document manuel sur la même clé : visible une fois, from_site faux ; total 2, pas 3
  INSERT INTO majordhome.equipment_documents (org_id, brand, model, document_type, file_name, storage_path)
  VALUES (v_org, 'TestFich', 'P700001', 'notice', 'manuel.pdf', v_org::text || '/equipment-models/manuel.pdf');
  IF (SELECT count(*) FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e1) <> 2
     OR (SELECT count(*) FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e1 AND NOT from_site) <> 1 THEN
    RAISE EXCEPTION '(4) document en double ou manquant sur l''équipement rattaché';
  END IF;
  -- e2 : autre modèle saisi, non rattaché → rien
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'TestFich', 'autre chose') RETURNING id INTO v_e2;
  IF (SELECT count(*) FROM public.majordhome_equipment_model_documents WHERE equipment_id = v_e2) <> 0 THEN RAISE EXCEPTION '(4) documents visibles sur un équipement sans rapport'; END IF;

  -- (5) contraintes : document relevé sans modèle ou manuel avec modèle refusés
  ok := false;
  BEGIN INSERT INTO majordhome.equipment_documents (org_id, brand, model, document_type, file_name, storage_path, source)
        VALUES (v_org, 'TestFich', 'X1', 'notice', 'x.pdf', v_org::text || '/equipment-models/x.pdf', '{"id":"Z"}'::jsonb);
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(5) source sans modèle acceptée'; END IF;
  ok := false;
  BEGIN INSERT INTO majordhome.equipment_documents (org_id, brand, model, document_type, file_name, storage_path)
        VALUES (v_org, 'TestFich', 'X1', 'micrologiciel', 'x.zip', v_org::text || '/equipment-models/x.zip');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(5) type inconnu accepté'; END IF;
  IF NOT (SELECT with_check LIKE '%equipment_model_id IS NULL%' FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'equipment_documents' AND policyname = 'equipment_documents_insert_role_can') THEN
    RAISE EXCEPTION '(5) la policy d''insertion n''interdit pas un document rattaché à un modèle';
  END IF;

  -- (6) garde « même organisation »
  INSERT INTO core.organizations (name) VALUES ('TEST FICHIERS autre org') RETURNING id INTO v_autre;
  INSERT INTO majordhome.equipment_models (org_id, brand, source_id, reference, name, model_name) VALUES (v_autre, 'TestFich', 'AUTRE1', 'P800001', 'n', 'n') RETURNING id INTO v_m_autre;
  ok := false;
  BEGIN UPDATE majordhome.equipments SET equipment_model_id = v_m_autre WHERE id = v_e2;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'equipment_model_other_org'; END;
  IF NOT ok THEN RAISE EXCEPTION '(6) équipement rattaché au modèle d''une autre organisation'; END IF;
  UPDATE majordhome.equipments SET equipment_model_id = NULL WHERE id = v_e1; -- détacher reste permis
  UPDATE majordhome.equipments SET notes = 'x' WHERE id = v_e2;               -- une écriture sans rapport passe

  -- nettoyage
  DELETE FROM majordhome.equipments WHERE id IN (v_e1, v_e2);
  DELETE FROM core.projects WHERE id = v_proj;
  DELETE FROM majordhome.equipment_documents WHERE org_id = v_org AND brand_key = 'testfich';
  DELETE FROM majordhome.equipment_models WHERE brand_key = 'testfich';
  CREATE TEMP TABLE t_items_fich ON COMMIT DROP AS SELECT catalog_item_id AS id FROM majordhome.supplier_products WHERE supplier_id = v_sup AND catalog_item_id IS NOT NULL;
  DELETE FROM majordhome.supplier_products WHERE supplier_id = v_sup;
  DELETE FROM majordhome.catalog_items WHERE id IN (SELECT id FROM t_items_fich);
  DELETE FROM majordhome.suppliers WHERE id = v_sup;
  DELETE FROM core.organizations WHERE id = v_autre;
  RAISE NOTICE 'assert-equipment-models-fichiers : OK';
END $$;
