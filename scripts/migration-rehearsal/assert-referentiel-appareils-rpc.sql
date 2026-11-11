-- assert-referentiel-appareils-rpc.sql — vérifie 20261112_5_referentiel_appareils_rpc.sql
-- (chaîne : celle d'assert-referentiel-appareils.sql + 20261112_4 + 20261112_5).
-- Couvre : droits mesurés (has_function_privilege) ; un technicien crée une fiche depuis un article et la rejoue ;
-- fiche web dédoublonnée par marque + référence ; chemin d'une autre org refusé ; contrôle refusé au technicien,
-- accepté par l'admin ; fiche fabricant non corrigeable ; fusion web → fabricant (équipements re-pointés) ; fusion
-- d'une fiche fabricant refusée ; plafond de recherches. Fixture nettoyée en fin.
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_tech uuid; v_sup uuid; v_item uuid; v_proj uuid; v_e1 uuid; v_e2 uuid;
  v_fab uuid; v_cat uuid; v_web uuid; v_web2 uuid; v_res jsonb; ok boolean; fn text; v_n int;
BEGIN
  -- (0) droits
  FOREACH fn IN ARRAY ARRAY['public.equipment_model_create_from_catalog(uuid)', 'public.equipment_model_review(uuid, jsonb)',
                            'public.equipment_model_merge(uuid, uuid)'] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN RAISE EXCEPTION '(0) anon exécute %', fn; END IF;
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN RAISE EXCEPTION '(0) authenticated n''exécute pas %', fn; END IF;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['public.equipment_model_create_from_web(uuid, uuid, jsonb, jsonb)', 'public.increment_equipment_enrich_quota(uuid, uuid, integer)'] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN RAISE EXCEPTION '(0) % exécutable par le front', fn; END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN RAISE EXCEPTION '(0) service_role n''exécute pas %', fn; END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'majordhome.equipment_models_is_admin(uuid)', 'EXECUTE') THEN RAISE EXCEPTION '(0) garde admin exécutable'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_equipment_models_a_controler', 'SELECT')
     OR has_table_privilege('authenticated', 'majordhome.equipment_enrich_quotas', 'SELECT') THEN
    RAISE EXCEPTION '(0) lecture non voulue';
  END IF;

  -- membres : un org_admin, un technicien (sans rôle d'encadrement ni profil maison)
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_org AND om.role = 'org_admin' LIMIT 1;
  SELECT om.user_id INTO v_tech FROM core.organization_members om LEFT JOIN core.profiles p ON p.id = om.user_id
  WHERE om.org_id = v_org AND om.role NOT IN ('org_admin', 'team_leader')
    AND coalesce(p.app_role, '') NOT IN ('org_admin', 'team_leader') AND lower(coalesce(p.business_role, '')) <> 'commercial'
    AND NOT EXISTS (SELECT 1 FROM majordhome.member_org_roles mr WHERE mr.user_id = om.user_id)
  LIMIT 1;
  IF v_admin IS NULL OR v_tech IS NULL THEN RAISE EXCEPTION 'fixture : admin=% tech=%', v_admin, v_tech; END IF;

  -- fixture : article, fiche fabricant, projet, deux équipements
  INSERT INTO majordhome.catalog_items (org_id, name, brand, code) VALUES (v_org, 'TESTRPC POELE', 'TestRpc', 'TR-1') RETURNING id INTO v_item;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_org, 'TEST RPC fournisseur', true) RETURNING id INTO v_sup;
  PERFORM public.equipment_models_upsert(v_org, v_sup, 'TestRpc', 'r1',
    '[{"source_id":"R1","reference":"P900001","name":"POELE FAB - P900001","model_name":"FAB","category":"Poêles","lifecycle":"en_vente","source":{"site":"https://exemple"}}]'::jsonb,
    '[]'::jsonb);
  SELECT id INTO v_fab FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testrpc' AND source_id = 'R1';
  INSERT INTO core.projects (org_id, name, status) VALUES (v_org, 'TEST RPC projet', 'active') RETURNING id INTO v_proj;

  -- (1) technicien : fiche depuis l'article, rejouée = même fiche
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  v_res := public.equipment_model_create_from_catalog(v_item);
  v_cat := (v_res ->> 'model_id')::uuid;
  IF (v_res ->> 'created')::boolean IS NOT TRUE THEN RAISE EXCEPTION '(1) fiche catalogue non créée : %', v_res; END IF;
  IF (public.equipment_model_create_from_catalog(v_item) ->> 'model_id')::uuid <> v_cat THEN RAISE EXCEPTION '(1) rejouée = autre fiche'; END IF;
  -- (3) le technicien ne contrôle ni ne fusionne
  ok := false; BEGIN PERFORM public.equipment_model_review(v_cat, '{}'::jsonb); EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'org_admin_required'; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) contrôle accepté pour un technicien'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (SELECT origin || '/' || review_status || '/' || brand FROM majordhome.equipment_models WHERE id = v_cat) <> 'catalogue/controle/TESTRPC' THEN
    RAISE EXCEPTION '(1) fiche catalogue mal posée';
  END IF;

  -- (2) fiche web (service_role) : création, dédoublonnage, chemin hors org
  v_res := public.equipment_model_create_from_web(v_org, v_tech,
    '{"brand":"testrpc","model_name":"WEB UN","reference":"W-77","category":"Poêle","en_vente":false,"specs":{"power_nominal_kw":8},"source_urls":["https://exemple.fr"]}'::jsonb,
    jsonb_build_object('photo_path', v_org::text || '/equipment-models/web/a.jpg', 'documents',
      jsonb_build_array(jsonb_build_object('storage_path', v_org::text || '/equipment-models/web/n.pdf', 'document_type', 'notice', 'file_name', 'n.pdf', 'url', 'https://exemple.fr/n.pdf'))));
  v_web := (v_res ->> 'model_id')::uuid;
  IF (v_res ->> 'created')::boolean IS NOT TRUE OR (v_res ->> 'documents')::int <> 1 THEN RAISE EXCEPTION '(2) fiche web : %', v_res; END IF;
  IF (SELECT origin || '/' || review_status || '/' || lifecycle FROM majordhome.equipment_models WHERE id = v_web) <> 'web/a_controler/arrete' THEN
    RAISE EXCEPTION '(2) fiche web mal posée';
  END IF;
  v_res := public.equipment_model_create_from_web(v_org, v_tech, '{"brand":"TESTRPC","model_name":"WEB UN bis","reference":"w77"}'::jsonb, '{}'::jsonb);
  IF (v_res ->> 'model_id')::uuid <> v_web OR (v_res ->> 'existante')::boolean IS NOT TRUE THEN RAISE EXCEPTION '(2) doublon créé : %', v_res; END IF;
  ok := false;
  BEGIN PERFORM public.equipment_model_create_from_web(v_org, v_tech, '{"brand":"TestRpc","model_name":"X","reference":"X-1"}'::jsonb,
    '{"photo_path":"00000000-0000-0000-0000-000000000000/equipment-models/web/x.jpg"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'chemin_hors_org'; END;
  IF NOT ok THEN RAISE EXCEPTION '(2) chemin d''une autre org accepté'; END IF;
  v_res := public.equipment_model_create_from_web(v_org, v_tech, '{"brand":"TestRpc","model_name":"WEB DEUX"}'::jsonb, '{}'::jsonb);
  v_web2 := (v_res ->> 'model_id')::uuid;

  INSERT INTO majordhome.equipments (project_id, category, brand, model, equipment_model_id) VALUES (v_proj, 'autre', 'TESTRPC', 'WEB DEUX', v_web2) RETURNING id INTO v_e1;
  INSERT INTO majordhome.equipments (project_id, category, brand, model, equipment_model_id) VALUES (v_proj, 'autre', 'TESTRPC', 'WEB DEUX', v_web2) RETURNING id INTO v_e2;

  -- (4) admin : fiche fabricant non corrigeable, correction d'une fiche web, fusions
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  ok := false; BEGIN PERFORM public.equipment_model_review(v_fab, '{}'::jsonb); EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'fiche_fabricant'; END;
  IF NOT ok THEN RAISE EXCEPTION '(4) fiche fabricant corrigée'; END IF;
  v_res := public.equipment_model_review(v_web, '{"model_name":"WEB UN corrigé","documents_retires":[]}'::jsonb);
  ok := false; BEGIN PERFORM public.equipment_model_merge(v_fab, v_web2); EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'fiche_fabricant_survit'; END;
  IF NOT ok THEN RAISE EXCEPTION '(4) fiche fabricant absorbée'; END IF;
  v_res := public.equipment_model_merge(v_web2, v_fab);
  IF (v_res ->> 'equipements')::int <> 2 THEN RAISE EXCEPTION '(4) fusion : %', v_res; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (SELECT review_status || '/' || model_name FROM majordhome.equipment_models WHERE id = v_web) <> 'controle/WEB UN corrigé' THEN RAISE EXCEPTION '(4) correction non appliquée'; END IF;
  IF (SELECT count(*) FROM majordhome.equipments WHERE equipment_model_id = v_fab AND id IN (v_e1, v_e2)) <> 2 THEN RAISE EXCEPTION '(4) équipements non re-pointés'; END IF;
  IF (SELECT merged_into FROM majordhome.equipment_models WHERE id = v_web2) IS DISTINCT FROM v_fab THEN RAISE EXCEPTION '(4) absorbée non marquée'; END IF;
  SELECT count(*) INTO v_n FROM public.majordhome_equipment_models_a_controler WHERE id IN (v_web, v_web2);
  IF v_n <> 0 THEN RAISE EXCEPTION '(4) fiches contrôlées encore dans la file'; END IF;

  -- (5) plafond
  FOR v_n IN 1..3 LOOP PERFORM public.increment_equipment_enrich_quota(v_tech, v_org, 3); END LOOP;
  ok := false; BEGIN PERFORM public.increment_equipment_enrich_quota(v_tech, v_org, 3); EXCEPTION WHEN SQLSTATE 'P0001' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(5) plafond non tenu'; END IF;

  -- nettoyage
  DELETE FROM majordhome.equipment_enrich_quotas WHERE user_id = v_tech AND org_id = v_org;
  DELETE FROM majordhome.equipments WHERE id IN (v_e1, v_e2);
  DELETE FROM core.projects WHERE id = v_proj;
  DELETE FROM majordhome.equipment_documents WHERE equipment_model_id IN (SELECT id FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testrpc');
  UPDATE majordhome.equipment_models SET merged_into = NULL WHERE org_id = v_org AND brand_key = 'testrpc';
  DELETE FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testrpc';
  DELETE FROM majordhome.catalog_items WHERE id = v_item;
  DELETE FROM majordhome.suppliers WHERE id = v_sup;
  DELETE FROM majordhome.equipment_brand_refs WHERE org_id = v_org AND brand_key = 'testrpc';
  RAISE NOTICE 'assert-referentiel-appareils-rpc : OK';
END $$;
