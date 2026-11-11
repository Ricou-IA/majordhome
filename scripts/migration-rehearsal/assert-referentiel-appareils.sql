-- assert-referentiel-appareils.sql — vérifie 20261112_4_referentiel_appareils.sql
-- (chaîne : 20261111_1 → _2 → _3 → _4 → _5 → _6 → 20261112_4 ; equipment_models n'est pas photographiée).
-- Couvre : droits (aucune écriture authenticated, anon ne lit rien, ensure non exécutable) ; valeurs par défaut d'une
-- fiche relevée ; la clôture d'un relevé ne désactive pas une fiche web et ne rattache pas d'office sur elle ;
-- amorçage des marques (une par clé) ; lien vers un article d'une autre organisation refusé ; vue : nouvelles colonnes
-- en fin. Fixture nettoyée en fin.
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid; v_sup uuid; v_proj uuid; v_e1 uuid; v_e2 uuid; v_fs1 uuid; v_fs2 uuid; v_web uuid; v_item uuid;
  v_res jsonb; v_n int; ok boolean; v_txt text;
BEGIN
  -- (0) droits
  IF has_table_privilege('authenticated', 'majordhome.equipment_models', 'INSERT') OR has_table_privilege('authenticated', 'majordhome.equipment_models', 'UPDATE')
     OR has_table_privilege('authenticated', 'majordhome.equipment_brand_refs', 'INSERT') OR has_table_privilege('authenticated', 'majordhome.equipment_brand_refs', 'UPDATE') THEN
    RAISE EXCEPTION '(0) authenticated écrit dans le référentiel';
  END IF;
  IF has_table_privilege('anon', 'public.majordhome_equipment_models', 'SELECT') OR has_table_privilege('anon', 'public.majordhome_equipment_brand_refs', 'SELECT') THEN
    RAISE EXCEPTION '(0) anon lit une vue du référentiel';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_equipment_brand_refs', 'SELECT')
     OR NOT has_table_privilege('service_role', 'majordhome.equipment_brand_refs', 'SELECT') THEN
    RAISE EXCEPTION '(0) lecture des marques non accordée';
  END IF;
  IF has_function_privilege('authenticated', 'majordhome.equipment_brand_ref_ensure(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'majordhome.equipment_brand_ref_ensure(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '(0) equipment_brand_ref_ensure exécutable par le front';
  END IF;
  IF has_function_privilege('authenticated', 'public.equipment_models_close(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '(0) equipment_models_close exécutable par authenticated';
  END IF;
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_txt FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'majordhome_equipment_models';
  IF v_txt NOT LIKE '%,updated_at,origin,review_status,catalog_item_id,equipment_type_id,specs,source_urls,created_by,reviewed_by,reviewed_at,merged_into,catalog_source_product_id' THEN
    RAISE EXCEPTION '(0) colonnes de majordhome_equipment_models : %', v_txt;
  END IF;

  -- (3) amorçage des marques : une ligne par clé, en majuscules
  SELECT count(*) INTO v_n FROM (SELECT org_id, brand_key FROM majordhome.equipment_brand_refs GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF v_n > 0 THEN RAISE EXCEPTION '(3) % clés de marque en double', v_n; END IF;
  SELECT count(*) INTO v_n FROM majordhome.equipment_brand_refs WHERE name <> upper(name);
  IF v_n > 0 THEN RAISE EXCEPTION '(3) % marques hors majuscules', v_n; END IF;
  IF (SELECT count(*) FROM majordhome.equipment_brand_refs WHERE org_id = v_org AND brand_key = 'jollymec') <> 1 THEN
    RAISE EXCEPTION '(3) JOLLY MEC absent ou en double';
  END IF;
  IF majordhome.equipment_brand_ref_ensure(v_org, 'jolly-mec') <> 'JOLLY MEC' THEN RAISE EXCEPTION '(3) ensure ne renvoie pas l''écriture de référence'; END IF;
  IF majordhome.equipment_brand_ref_ensure(v_org, 'Testref Marque') <> 'TESTREF MARQUE' THEN RAISE EXCEPTION '(3) ensure ne crée pas la marque'; END IF;
  IF majordhome.equipment_brand_ref_ensure(v_org, 'À renseigner') IS NOT NULL THEN RAISE EXCEPTION '(3) ensure accepte un vide déguisé'; END IF;

  -- fixture : relevé v1 (FS1, FS2), fiche web de la même marque
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_org, 'TEST REFERENTIEL fournisseur', true) RETURNING id INTO v_sup;
  PERFORM public.equipment_models_upsert(v_org, v_sup, 'TestRef', 'v1',
    '[{"source_id":"FS1","reference":"P800001","name":"POELE UN - P800001","model_name":"UN","category":"Poêles","lifecycle":"en_vente","source":{"site":"https://exemple"}},
      {"source_id":"FS2","reference":"P800002","name":"POELE DEUX - P800002","model_name":"DEUX","category":"Poêles","lifecycle":"en_vente","source":{"site":"https://exemple"}}]'::jsonb,
    '[]'::jsonb);
  SELECT id INTO v_fs1 FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testref' AND source_id = 'FS1';
  SELECT id INTO v_fs2 FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testref' AND source_id = 'FS2';
  -- (1) valeurs par défaut d'une fiche relevée
  IF (SELECT origin || '/' || review_status FROM majordhome.equipment_models WHERE id = v_fs1) <> 'releve_fabricant/controle' THEN
    RAISE EXCEPTION '(1) fiche relevée sans origine / état par défaut';
  END IF;
  INSERT INTO majordhome.equipment_models (org_id, brand, source_id, reference, name, model_name, origin, review_status)
  VALUES (v_org, 'TestRef', 'web:test', 'P800003', 'TROIS', 'TROIS', 'web', 'a_controler') RETURNING id INTO v_web;

  INSERT INTO core.projects (org_id, name, status) VALUES (v_org, 'TEST REFERENTIEL projet', 'active') RETURNING id INTO v_proj;
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'TestRef', '800001') RETURNING id INTO v_e1;
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'testref', 'P800003') RETURNING id INTO v_e2;

  -- (2) relevé v2 (FS1 seul) puis clôture : FS2 désactivée, fiche web intacte, aucun rattachement sur la fiche web
  PERFORM public.equipment_models_upsert(v_org, v_sup, 'TestRef', 'v2',
    '[{"source_id":"FS1","reference":"P800001","name":"POELE UN - P800001","model_name":"UN","category":"Poêles","lifecycle":"en_vente","source":{"site":"https://exemple"}}]'::jsonb,
    '[]'::jsonb);
  v_res := public.equipment_models_close(v_org, 'TestRef', 'v2');
  IF (v_res ->> 'modeles_desactives')::int <> 1 THEN RAISE EXCEPTION '(2) désactivés attendus 1 : %', v_res; END IF;
  IF (SELECT is_active FROM majordhome.equipment_models WHERE id = v_fs2) THEN RAISE EXCEPTION '(2) FS2 restée active'; END IF;
  IF NOT (SELECT is_active FROM majordhome.equipment_models WHERE id = v_web) THEN RAISE EXCEPTION '(2) fiche web désactivée par la relève'; END IF;
  IF (SELECT equipment_model_id FROM majordhome.equipments WHERE id = v_e1) IS DISTINCT FROM v_fs1 THEN RAISE EXCEPTION '(2) rattachement d''office sur FS1 manquant'; END IF;
  IF (SELECT equipment_model_id FROM majordhome.equipments WHERE id = v_e2) IS NOT NULL THEN RAISE EXCEPTION '(2) rattachement d''office sur la fiche web'; END IF;

  -- (4) lien vers un article d'une autre organisation refusé
  INSERT INTO core.organizations (name) VALUES ('TEST REFERENTIEL autre org') RETURNING id INTO v_autre;
  INSERT INTO majordhome.catalog_items (org_id, name, brand) VALUES (v_autre, 'TEST article autre org', 'TestRef') RETURNING id INTO v_item;
  ok := false;
  BEGIN UPDATE majordhome.equipment_models SET catalog_item_id = v_item WHERE id = v_web;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'catalog_item_other_org'; END;
  IF NOT ok THEN RAISE EXCEPTION '(4) article d''une autre organisation accepté'; END IF;
  ok := false;
  BEGIN UPDATE majordhome.equipment_models SET merged_into = v_web WHERE id = v_web;
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(4) fusion d''une fiche dans elle-même acceptée'; END IF;

  -- nettoyage
  DELETE FROM majordhome.equipments WHERE id IN (v_e1, v_e2);
  DELETE FROM core.projects WHERE id = v_proj;
  DELETE FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testref';
  DELETE FROM majordhome.catalog_items WHERE id = v_item;
  DELETE FROM core.organizations WHERE id = v_autre;
  DELETE FROM majordhome.suppliers WHERE id = v_sup;
  DELETE FROM majordhome.equipment_brand_refs WHERE org_id = v_org AND brand_key IN ('testref', 'testrefmarque');
  RAISE NOTICE 'assert-referentiel-appareils : OK (% marques amorcées)', (SELECT count(*) FROM majordhome.equipment_brand_refs);
END $$;
