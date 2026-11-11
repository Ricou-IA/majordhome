-- assert-referentiel-appareils-file.sql — vérifie 20261112_7_referentiel_appareils_file.sql
-- (chaîne : celle d'assert-referentiel-appareils-correctifs.sql + 20261112_7).
-- Décision d'Eric (2026-11-11) : la file de contrôle ne montre une fiche web qu'une fois rattachée à au moins un
-- équipement enregistré — une saisie abandonnée ne lui demande rien. Fixture nettoyée en fin.
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_tech uuid; v_proj uuid; v_web uuid; v_eq uuid; v_n int;
BEGIN
  SELECT om.user_id INTO v_tech FROM core.organization_members om WHERE om.org_id = v_org LIMIT 1;
  v_web := (public.equipment_model_create_from_web(v_org, v_tech, '{"brand":"TestFile","model_name":"FILE UN"}'::jsonb, '{}'::jsonb) ->> 'model_id')::uuid;

  -- (1) fiche sans équipement : pas dans la file, mais toujours « à contrôler » dans le référentiel
  SELECT count(*) INTO v_n FROM public.majordhome_equipment_models_a_controler WHERE id = v_web;
  IF v_n <> 0 THEN RAISE EXCEPTION '(1) fiche sans équipement présente dans la file'; END IF;
  IF (SELECT review_status FROM majordhome.equipment_models WHERE id = v_web) <> 'a_controler' THEN RAISE EXCEPTION '(1) état modifié'; END IF;

  -- (2) un équipement s'y rattache : la fiche entre dans la file, avec son client
  INSERT INTO core.projects (org_id, name, status) VALUES (v_org, 'TEST FILE projet', 'active') RETURNING id INTO v_proj;
  INSERT INTO majordhome.equipments (project_id, category, brand, model, equipment_model_id) VALUES (v_proj, 'autre', 'TESTFILE', 'FILE UN', v_web) RETURNING id INTO v_eq;
  SELECT count(*) INTO v_n FROM public.majordhome_equipment_models_a_controler WHERE id = v_web AND nb_equipements = 1;
  IF v_n <> 1 THEN RAISE EXCEPTION '(2) fiche rattachée absente de la file'; END IF;

  DELETE FROM majordhome.equipments WHERE id = v_eq;
  DELETE FROM core.projects WHERE id = v_proj;
  DELETE FROM majordhome.equipment_models WHERE id = v_web;
  DELETE FROM majordhome.equipment_brand_refs WHERE org_id = v_org AND brand_key = 'testfile';
  RAISE NOTICE 'assert-referentiel-appareils-file : OK';
END $$;
