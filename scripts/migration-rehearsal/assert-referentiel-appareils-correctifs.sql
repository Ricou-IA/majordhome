-- assert-referentiel-appareils-correctifs.sql — vérifie 20261112_6_referentiel_appareils_correctifs.sql
-- (chaîne : celle d'assert-referentiel-appareils-rpc.sql + 20261112_6).
-- Couvre les deux défauts relevés en relecture finale :
--   (1) un document web passé sur une fiche fabricant par une fusion survit à la copie des fichiers du relevé suivant ;
--   (2) deux validations web du même appareil SANS référence fabricant donnent une seule fiche.
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_tech uuid; v_sup uuid; v_fab uuid; v_web uuid; v_a uuid; v_b uuid; v_res jsonb; v_n int;
BEGIN
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_org AND om.role = 'org_admin' LIMIT 1;
  SELECT om.user_id INTO v_tech FROM core.organization_members om WHERE om.org_id = v_org AND om.user_id <> v_admin LIMIT 1;

  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_org, 'TEST CORRECTIFS fournisseur', true) RETURNING id INTO v_sup;
  PERFORM public.equipment_models_upsert(v_org, v_sup, 'TestCor', 'c1',
    '[{"source_id":"C1","reference":"P910001","name":"POELE COR - P910001","model_name":"COR","category":"Poêles","lifecycle":"en_vente","source":{"site":"https://exemple"}}]'::jsonb,
    '[]'::jsonb);
  SELECT id INTO v_fab FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testcor' AND source_id = 'C1';

  -- (1) fiche web avec une notice, fusionnée dans la fiche fabricant, puis copie des fichiers du relevé
  v_res := public.equipment_model_create_from_web(v_org, v_tech, '{"brand":"TestCor","model_name":"COR WEB","reference":"CW-1"}'::jsonb,
    jsonb_build_object('documents', jsonb_build_array(jsonb_build_object('storage_path', v_org::text || '/equipment-models/web/cw.pdf',
      'document_type', 'notice', 'file_name', 'cw.pdf', 'url', 'https://exemple.fr/cw.pdf'))));
  v_web := (v_res ->> 'model_id')::uuid;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.equipment_model_merge(v_web, v_fab);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (SELECT count(*) FROM majordhome.equipment_documents WHERE equipment_model_id = v_fab) <> 1 THEN RAISE EXCEPTION '(1) notice non passée sur la fiche fabricant'; END IF;
  PERFORM public.equipment_models_set_files(v_org, 'TestCor', 'c1', '[{"source_id":"C1","documents":[]}]'::jsonb);
  SELECT count(*) INTO v_n FROM majordhome.equipment_documents WHERE equipment_model_id = v_fab AND storage_path LIKE '%/equipment-models/web/cw.pdf';
  IF v_n <> 1 THEN RAISE EXCEPTION '(1) la copie des fichiers du relevé a effacé la notice web fusionnée'; END IF;

  -- (2) deux validations sans référence, même appareil
  v_a := (public.equipment_model_create_from_web(v_org, v_tech, '{"brand":"TestCor","model_name":"Kelly 9"}'::jsonb, '{}'::jsonb) ->> 'model_id')::uuid;
  v_res := public.equipment_model_create_from_web(v_org, v_tech, '{"brand":"testcor","model_name":"KELLY 9"}'::jsonb, '{}'::jsonb);
  v_b := (v_res ->> 'model_id')::uuid;
  IF v_a <> v_b OR (v_res ->> 'existante')::boolean IS NOT TRUE THEN RAISE EXCEPTION '(2) doublon sans référence : % / %', v_a, v_res; END IF;

  -- nettoyage
  DELETE FROM majordhome.equipment_documents WHERE equipment_model_id IN (SELECT id FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testcor');
  UPDATE majordhome.equipment_models SET merged_into = NULL WHERE org_id = v_org AND brand_key = 'testcor';
  DELETE FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testcor';
  DELETE FROM majordhome.suppliers WHERE id = v_sup;
  DELETE FROM majordhome.equipment_brand_refs WHERE org_id = v_org AND brand_key = 'testcor';
  RAISE NOTICE 'assert-referentiel-appareils-correctifs : OK';
END $$;
