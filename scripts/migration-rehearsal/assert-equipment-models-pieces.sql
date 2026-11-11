-- assert-equipment-models-pieces.sql — vérifie 20261111_1_equipment_models_pieces.sql.
-- Couvre : structure et droits (anon / authenticated n'exécutent aucune des trois RPC, service_role lit les tables,
-- colonne equipment_model_id en fin de la vue majordhome_equipments) ; relevé de pièces : le TARIF du fournisseur
-- n'est ni désactivé ni réécrit ; pièce disparue désactivée puis réactivée ; prix de vente qui suit le prix public,
-- sauf ajustement manuel ; pièce partagée par deux marques conservée ; référence du tarif refusée ; modèles +
-- nomenclature rejouables ; pièce inconnue refusée ; rattachement d'office par référence exacte seulement ; clôture.
-- Fixture (1 fournisseur, ses lignes, ses articles, 2 modèles, 1 projet, 2 équipements) nettoyée en fin.
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_sup uuid; v_proj uuid; v_e1 uuid; v_e2 uuid; v_m uuid;
  v_res jsonb; v_n int; v_num numeric; v_txt text; ok boolean;
  v_rows jsonb;
  fn text;
BEGIN
  -- (0) structure et droits
  IF to_regclass('majordhome.equipment_models') IS NULL OR to_regclass('majordhome.equipment_model_parts') IS NULL
     OR to_regclass('public.majordhome_equipment_models') IS NULL OR to_regclass('public.majordhome_equipment_model_parts') IS NULL THEN
    RAISE EXCEPTION 'objets absents';
  END IF;
  FOREACH fn IN ARRAY ARRAY['public.supplier_pieces_upsert(uuid, uuid, text, text, jsonb)',
                            'public.equipment_models_upsert(uuid, uuid, text, text, jsonb, jsonb)',
                            'public.equipment_models_close(uuid, text, text)'] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% exécutable par anon / authenticated', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN RAISE EXCEPTION '% non exécutable par service_role', fn; END IF;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['majordhome.equipment_models', 'majordhome.equipment_model_parts',
                            'public.majordhome_equipment_models', 'public.majordhome_equipment_model_parts'] LOOP
    IF has_table_privilege('anon', fn, 'SELECT') THEN RAISE EXCEPTION 'anon lit %', fn; END IF;
    IF NOT has_table_privilege('service_role', fn, 'SELECT') THEN RAISE EXCEPTION 'service_role ne lit pas %', fn; END IF;
    IF NOT has_table_privilege('authenticated', fn, 'SELECT') THEN RAISE EXCEPTION 'authenticated ne lit pas %', fn; END IF;
    IF has_table_privilege('authenticated', fn, 'INSERT') OR has_table_privilege('authenticated', fn, 'UPDATE') OR has_table_privilege('authenticated', fn, 'DELETE') THEN
      RAISE EXCEPTION 'authenticated écrit %', fn;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.equipment_models'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.equipment_model_parts'::regclass) THEN
    RAISE EXCEPTION 'RLS absente';
  END IF;
  SELECT column_name INTO v_txt FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_equipments' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_txt <> 'equipment_model_id' THEN RAISE EXCEPTION 'equipment_model_id pas en fin de majordhome_equipments (%)', v_txt; END IF;
  IF has_table_privilege('anon', 'public.majordhome_equipments', 'SELECT') THEN RAISE EXCEPTION 'anon lit majordhome_equipments'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_equipments', 'UPDATE') THEN RAISE EXCEPTION 'authenticated a perdu UPDATE sur majordhome_equipments'; END IF;

  -- fixture : fournisseur avec 2 lignes de TARIF (dont une référence en double), hors relevé
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_org, 'TEST PIECES fournisseur', true) RETURNING id INTO v_sup;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, category, purchase_price_ht, selling_price_ht, is_active)
  VALUES (v_sup, v_org, 'TP100', 'TEST poêle un', 'poele', 1000, 1500, true),
         (v_sup, v_org, 'TP200', 'TEST accessoire', NULL, 50, 80, true);

  -- (1) premier relevé : 3 pièces
  v_rows := '[
    {"reference":"TPA","name":"TEST pièce A","brand":"TestMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":7,"selling_price_ht_defaut":10,"tarif_public":10,"taux_remise":30,"specs":{"source_version":"v1","canonical":{"cycle_de_vie":"en_vente"}}},
    {"reference":"TPB","name":"TEST pièce B","brand":"TestMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":14,"selling_price_ht_defaut":20,"tarif_public":20,"taux_remise":30,"specs":{"source_version":"v1","canonical":{}}},
    {"reference":"TPC","name":"TEST pièce C","brand":"TestMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":21,"selling_price_ht_defaut":30,"tarif_public":30,"taux_remise":30,"specs":{"source_version":"v1","canonical":{}}}
  ]'::jsonb;
  v_res := public.supplier_pieces_upsert(v_org, v_sup, 'v1', 'TestMarque', v_rows);
  IF (v_res ->> 'inseres')::int <> 3 OR (v_res ->> 'desactives')::int <> 0 OR (v_res ->> 'pieces_desactivees')::int <> 0 THEN
    RAISE EXCEPTION '(1) résultat inattendu : %', v_res;
  END IF;
  SELECT count(*) INTO v_n FROM majordhome.supplier_products WHERE supplier_id = v_sup AND category IS DISTINCT FROM 'piece_detachee' AND is_active AND purchase_price_ht IN (1000, 50) AND selling_price_ht IN (1500, 80);
  IF v_n <> 2 THEN RAISE EXCEPTION '(1) le tarif a été touché par le relevé de pièces (% lignes intactes sur 2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM majordhome.supplier_products WHERE supplier_id = v_sup AND category = 'piece_detachee' AND is_active AND catalog_item_id IS NOT NULL
    AND specs -> 'canonical' -> 'releves_pieces' = '["TestMarque"]'::jsonb;
  IF v_n <> 3 THEN RAISE EXCEPTION '(1) % pièces actives avec article et marque de relevé, 3 attendues', v_n; END IF;

  -- (2) deuxième relevé : C absente, A passe de 10 à 12
  v_rows := '[
    {"reference":"TPA","name":"TEST pièce A","brand":"TestMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":8.4,"selling_price_ht_defaut":12,"tarif_public":12,"taux_remise":30,"specs":{"source_version":"v2","canonical":{}}},
    {"reference":"TPB","name":"TEST pièce B","brand":"TestMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":14,"selling_price_ht_defaut":20,"tarif_public":20,"taux_remise":30,"specs":{"source_version":"v2","canonical":{}}}
  ]'::jsonb;
  v_res := public.supplier_pieces_upsert(v_org, v_sup, 'v2', 'TestMarque', v_rows);
  IF (v_res ->> 'prix_suivis')::int <> 1 OR (v_res ->> 'prix_ajustes_non_suivis')::int <> 0 OR (v_res ->> 'pieces_desactivees')::int <> 1 THEN
    RAISE EXCEPTION '(2) résultat inattendu : %', v_res;
  END IF;
  SELECT selling_price_ht INTO v_num FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TPA';
  IF v_num <> 12 THEN RAISE EXCEPTION '(2) prix de vente de la ligne non suivi : %', v_num; END IF;
  SELECT ci.selling_price_ht INTO v_num FROM majordhome.catalog_items ci JOIN majordhome.supplier_products p ON p.catalog_item_id = ci.id WHERE p.supplier_id = v_sup AND p.reference = 'TPA';
  IF v_num <> 12 THEN RAISE EXCEPTION '(2) prix de vente de l''article non suivi : %', v_num; END IF;
  IF (SELECT is_active FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TPC')
     OR (SELECT (specs ->> 'desactive_par_releve')::boolean FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TPC') IS NOT TRUE THEN
    RAISE EXCEPTION '(2) pièce C absente non désactivée / non marquée';
  END IF;
  SELECT count(*) INTO v_n FROM majordhome.supplier_products WHERE supplier_id = v_sup AND category IS DISTINCT FROM 'piece_detachee' AND is_active;
  IF v_n <> 2 THEN RAISE EXCEPTION '(2) le tarif a été désactivé (% actives sur 2)', v_n; END IF;

  -- (3) prix de vente ajusté à la main (15), puis relevé à 13 : conservé et compté
  UPDATE majordhome.supplier_products SET selling_price_ht = 15 WHERE supplier_id = v_sup AND reference = 'TPA';
  v_rows := '[
    {"reference":"TPA","name":"TEST pièce A","brand":"TestMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":9.1,"selling_price_ht_defaut":13,"tarif_public":13,"taux_remise":30,"specs":{"source_version":"v3","canonical":{}}},
    {"reference":"TPB","name":"TEST pièce B","brand":"TestMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":14,"selling_price_ht_defaut":20,"tarif_public":20,"taux_remise":30,"specs":{"source_version":"v3","canonical":{}}},
    {"reference":"TPC","name":"TEST pièce C","brand":"TestMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":21,"selling_price_ht_defaut":30,"tarif_public":30,"taux_remise":30,"specs":{"source_version":"v3","canonical":{}}}
  ]'::jsonb;
  v_res := public.supplier_pieces_upsert(v_org, v_sup, 'v3', 'TestMarque', v_rows);
  IF (v_res ->> 'prix_suivis')::int <> 0 OR (v_res ->> 'prix_ajustes_non_suivis')::int <> 1 THEN RAISE EXCEPTION '(3) résultat inattendu : %', v_res; END IF;
  SELECT selling_price_ht INTO v_num FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TPA';
  IF v_num <> 15 THEN RAISE EXCEPTION '(3) prix ajusté à la main écrasé : %', v_num; END IF;
  SELECT purchase_price_ht INTO v_num FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TPA';
  IF v_num <> 9.1 THEN RAISE EXCEPTION '(3) prix d''achat non rafraîchi : %', v_num; END IF;
  -- (4) C revenue : réactivée
  IF NOT (SELECT is_active FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TPC') THEN
    RAISE EXCEPTION '(4) pièce C revenue non réactivée';
  END IF;

  -- (5) pièce B vue aussi sous une autre marque, puis absente du relevé de la première : reste active
  v_res := public.supplier_pieces_upsert(v_org, v_sup, 'w1', 'AutreMarque',
    '[{"reference":"TPB","name":"TEST pièce B","brand":"AutreMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":14,"selling_price_ht_defaut":20,"tarif_public":20,"taux_remise":30,"specs":{"source_version":"w1","canonical":{}}}]'::jsonb);
  IF (v_res ->> 'pieces_desactivees')::int <> 0 THEN RAISE EXCEPTION '(5) le relevé d''une autre marque a désactivé des pièces : %', v_res; END IF;
  IF (SELECT count(*) FROM majordhome.supplier_products WHERE supplier_id = v_sup AND category = 'piece_detachee' AND is_active) <> 3 THEN
    RAISE EXCEPTION '(5) pièces de TestMarque désactivées par le relevé d''AutreMarque';
  END IF;
  v_res := public.supplier_pieces_upsert(v_org, v_sup, 'v4', 'TestMarque',
    '[{"reference":"TPA","name":"TEST pièce A","brand":"TestMarque","category":"piece_detachee","product_kind":"accessory","purchase_price_ht":9.1,"selling_price_ht_defaut":13,"tarif_public":13,"taux_remise":30,"specs":{"source_version":"v4","canonical":{}}}]'::jsonb);
  IF NOT (SELECT is_active FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TPB') THEN
    RAISE EXCEPTION '(5) pièce B partagée désactivée';
  END IF;
  IF (SELECT specs -> 'canonical' -> 'releves_pieces' FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TPB') <> '["AutreMarque"]'::jsonb THEN
    RAISE EXCEPTION '(5) marque non retirée de la pièce partagée';
  END IF;
  IF (SELECT is_active FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TPC') THEN
    RAISE EXCEPTION '(5) pièce C (seule marque) non désactivée';
  END IF;

  -- (6) refus : référence du tarif, ligne hors catégorie, relevé vide
  ok := false;
  BEGIN
    PERFORM public.supplier_pieces_upsert(v_org, v_sup, 'v5', 'TestMarque',
      '[{"reference":"TP200","name":"x","category":"piece_detachee","purchase_price_ht":1,"specs":{}}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'reference_au_tarif: TP200%';
  END;
  IF NOT ok THEN RAISE EXCEPTION '(6) référence du tarif acceptée'; END IF;
  IF (SELECT purchase_price_ht FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = 'TP200') <> 50 THEN RAISE EXCEPTION '(6) tarif réécrit'; END IF;
  ok := false;
  BEGIN
    PERFORM public.supplier_pieces_upsert(v_org, v_sup, 'v5', 'TestMarque', '[{"reference":"TPZ","name":"x","category":"poele","purchase_price_ht":1}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'row_not_piece';
  END;
  IF NOT ok THEN RAISE EXCEPTION '(6) ligne hors catégorie acceptée'; END IF;
  ok := false;
  BEGIN PERFORM public.supplier_pieces_upsert(v_org, v_sup, 'v5', 'TestMarque', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'rows_empty';
  END;
  IF NOT ok THEN RAISE EXCEPTION '(6) relevé vide accepté'; END IF;

  -- (7) modèles + nomenclature
  v_res := public.equipment_models_upsert(v_org, v_sup, 'TestMarque', 'v4',
    '[{"source_id":"SRC1","reference":"P601314","name":"POELE TESTOX - P601314","model_name":"TESTOX","category":"Poêles","lifecycle":"en_vente","source":{"site":"https://exemple","publicId":"SRC1"}},
      {"source_id":"SRC2","reference":"P601314","name":"POELE TESTOX EXPORT - P601314","model_name":"TESTOX EXPORT","category":"Poêles","lifecycle":"en_vente","source":{}}]'::jsonb,
    '[{"modele_source_id":"SRC1","position":1,"repere":"30","piece_reference":"TPA","quantity":1,"notes":"","prix_public":13},
      {"modele_source_id":"SRC1","position":2,"repere":"7-14","piece_reference":"TP200","quantity":2,"notes":"(noir)","prix_public":null}]'::jsonb);
  IF (v_res ->> 'modeles')::int <> 2 OR (v_res ->> 'lignes')::int <> 2 THEN RAISE EXCEPTION '(7) résultat inattendu : %', v_res; END IF;
  SELECT id INTO v_m FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testmarque' AND source_id = 'SRC1';
  IF (SELECT reference_key FROM majordhome.equipment_models WHERE id = v_m) <> 'p601314' OR (SELECT source ->> 'version' FROM majordhome.equipment_models WHERE id = v_m) <> 'v4' THEN
    RAISE EXCEPTION '(7) clés / version du modèle inattendues';
  END IF;
  SELECT count(*) INTO v_n FROM public.majordhome_equipment_model_parts WHERE equipment_model_id = v_m;
  IF v_n <> 2 THEN RAISE EXCEPTION '(7) vue nomenclature : % lignes, 2 attendues', v_n; END IF;
  IF (SELECT prix_public_ht FROM public.majordhome_equipment_model_parts WHERE equipment_model_id = v_m AND repere = '30') <> 13
     OR (SELECT piece_reference FROM public.majordhome_equipment_model_parts WHERE equipment_model_id = v_m AND repere = '7-14') <> 'TP200' THEN
    RAISE EXCEPTION '(7) contenu de la vue nomenclature inattendu';
  END IF;
  -- rejouer : pas de doublon ; photo_path jamais écrasé
  UPDATE majordhome.equipment_models SET photo_path = 'x/equipment-models/photo.jpg' WHERE id = v_m;
  v_res := public.equipment_models_upsert(v_org, v_sup, 'TestMarque', 'v4',
    '[{"source_id":"SRC1","reference":"P601314","name":"POELE TESTOX - P601314","model_name":"TESTOX","category":"Poêles","lifecycle":"en_vente","source":{}}]'::jsonb,
    '[{"modele_source_id":"SRC1","position":1,"repere":"30","piece_reference":"TPA","quantity":1,"notes":"","prix_public":13}]'::jsonb);
  IF (SELECT count(*) FROM majordhome.equipment_model_parts WHERE equipment_model_id = v_m) <> 1 THEN RAISE EXCEPTION '(7) nomenclature non remplacée au rejeu'; END IF;
  IF (SELECT photo_path FROM majordhome.equipment_models WHERE id = v_m) IS DISTINCT FROM 'x/equipment-models/photo.jpg' THEN RAISE EXCEPTION '(7) photo_path écrasé par le relevé'; END IF;
  -- pièce inconnue, ligne sans modèle
  ok := false;
  BEGIN
    PERFORM public.equipment_models_upsert(v_org, v_sup, 'TestMarque', 'v4',
      '[{"source_id":"SRC1","reference":"P601314","name":"n","model_name":"n"}]'::jsonb,
      '[{"modele_source_id":"SRC1","position":1,"repere":"1","piece_reference":"INCONNUE","quantity":1}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'piece_introuvable: INCONNUE%';
  END;
  IF NOT ok THEN RAISE EXCEPTION '(7) pièce inconnue acceptée'; END IF;
  IF (SELECT count(*) FROM majordhome.equipment_model_parts WHERE equipment_model_id = v_m) <> 1 THEN RAISE EXCEPTION '(7) nomenclature perdue après un lot refusé'; END IF;
  ok := false;
  BEGIN
    PERFORM public.equipment_models_upsert(v_org, v_sup, 'TestMarque', 'v4',
      '[{"source_id":"SRC1","reference":"P601314","name":"n","model_name":"n"}]'::jsonb,
      '[{"modele_source_id":"AUTRE","position":1,"repere":"1","piece_reference":"TPA","quantity":1}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'ligne_sans_modele: AUTRE%';
  END;
  IF NOT ok THEN RAISE EXCEPTION '(7) ligne sans modèle acceptée'; END IF;

  -- (8) clôture : version inconnue refusée ; rattachement d'office par référence exacte et unique seulement
  ok := false;
  BEGIN PERFORM public.equipment_models_close(v_org, 'TestMarque', 'jamais');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM = 'releve_non_importe';
  END;
  IF NOT ok THEN RAISE EXCEPTION '(8) clôture d''une version non importée acceptée'; END IF;

  INSERT INTO core.projects (org_id, name, status) VALUES (v_org, 'TEST PIECES projet', 'active') RETURNING id INTO v_proj;
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'testmarque', '601314') RETURNING id INTO v_e1;
  INSERT INTO majordhome.equipments (project_id, category, brand, model) VALUES (v_proj, 'autre', 'TestMarque', 'testox') RETURNING id INTO v_e2;
  -- deux modèles actifs portent P601314 → ambigu, personne n'est rattaché
  v_res := public.equipment_models_close(v_org, 'TestMarque', 'v4');
  IF (v_res ->> 'equipements_rattaches')::int <> 0 THEN RAISE EXCEPTION '(8) rattachement malgré deux modèles de même référence : %', v_res; END IF;
  -- un seul modèle actif (SRC2 sort du relevé v5) → l'équipement « 601314 » est rattaché, « testox » ne l'est pas
  PERFORM public.equipment_models_upsert(v_org, v_sup, 'TestMarque', 'v5',
    '[{"source_id":"SRC1","reference":"P601314","name":"POELE TESTOX - P601314","model_name":"TESTOX","category":"Poêles","lifecycle":"en_vente","source":{}}]'::jsonb,
    '[{"modele_source_id":"SRC1","position":1,"repere":"30","piece_reference":"TPA","quantity":1,"notes":"","prix_public":13}]'::jsonb);
  v_res := public.equipment_models_close(v_org, 'TestMarque', 'v5');
  IF (v_res ->> 'modeles_desactives')::int <> 1 OR (v_res ->> 'equipements_rattaches')::int <> 1 THEN RAISE EXCEPTION '(8) clôture inattendue : %', v_res; END IF;
  IF (SELECT equipment_model_id FROM majordhome.equipments WHERE id = v_e1) IS DISTINCT FROM v_m THEN RAISE EXCEPTION '(8) équipement « 601314 » non rattaché'; END IF;
  IF (SELECT equipment_model_id FROM majordhome.equipments WHERE id = v_e2) IS NOT NULL THEN RAISE EXCEPTION '(8) équipement rattaché par le nom'; END IF;
  IF (SELECT is_active FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testmarque' AND source_id = 'SRC2') THEN RAISE EXCEPTION '(8) modèle absent non désactivé'; END IF;
  IF (SELECT equipment_model_id FROM public.majordhome_equipments WHERE id = v_e1) IS DISTINCT FROM v_m THEN RAISE EXCEPTION '(8) la vue majordhome_equipments ne rend pas equipment_model_id'; END IF;

  -- nettoyage
  DELETE FROM majordhome.equipments WHERE id IN (v_e1, v_e2);
  DELETE FROM core.projects WHERE id = v_proj;
  DELETE FROM majordhome.equipment_models WHERE org_id = v_org AND brand_key = 'testmarque';
  CREATE TEMP TABLE t_items_test ON COMMIT DROP AS SELECT catalog_item_id AS id FROM majordhome.supplier_products WHERE supplier_id = v_sup AND catalog_item_id IS NOT NULL;
  DELETE FROM majordhome.supplier_products WHERE supplier_id = v_sup;
  DELETE FROM majordhome.catalog_items WHERE id IN (SELECT id FROM t_items_test);
  DELETE FROM majordhome.suppliers WHERE id = v_sup;
  RAISE NOTICE 'assert-equipment-models-pieces : OK';
END $$;
