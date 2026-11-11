-- assert-referentiel-appareils-liens.sql — vérifie 20261112_8_referentiel_appareils_liens.sql
-- (chaîne : celle d'assert-referentiel-appareils-file.sql + 20261112_7 + 20261112_8).
-- Décision d'Eric (2026-11-11) : pour un site qui refuse les téléchargements automatiques, la fiche garde les LIENS
-- (photo, notice, fiche technique) à ouvrir dans le navigateur. Fixture nettoyée en fin.
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_tech uuid; v_id uuid; v_src jsonb;
BEGIN
  SELECT om.user_id INTO v_tech FROM core.organization_members om WHERE om.org_id = v_org LIMIT 1;
  v_id := (public.equipment_model_create_from_web(v_org, v_tech,
    '{"brand":"TestLiens","model_name":"LIENS UN","liens":{"photo":"https://ex.fr/p.jpg","notice":{"url":"https://ex.fr/dl/3030/","label":"Manuel"},"fiche":null}}'::jsonb,
    '{}'::jsonb) ->> 'model_id')::uuid;
  SELECT source INTO v_src FROM majordhome.equipment_models WHERE id = v_id;
  IF v_src #>> '{liens,notice,url}' IS DISTINCT FROM 'https://ex.fr/dl/3030/' OR v_src #>> '{liens,notice,label}' IS DISTINCT FROM 'Manuel'
     OR v_src #>> '{liens,photo}' IS DISTINCT FROM 'https://ex.fr/p.jpg' THEN
    RAISE EXCEPTION '(1) liens non gardés : %', v_src;
  END IF;
  -- sans liens : source vide, comme avant
  v_id := (public.equipment_model_create_from_web(v_org, v_tech, '{"brand":"TestLiens","model_name":"LIENS DEUX"}'::jsonb, '{}'::jsonb) ->> 'model_id')::uuid;
  IF (SELECT source FROM majordhome.equipment_models WHERE id = v_id) <> '{}'::jsonb THEN RAISE EXCEPTION '(2) source non vide sans liens'; END IF;

  DELETE FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testliens';
  DELETE FROM majordhome.equipment_brand_refs WHERE org_id = v_org AND brand_key = 'testliens';
  RAISE NOTICE 'assert-referentiel-appareils-liens : OK';
END $$;
