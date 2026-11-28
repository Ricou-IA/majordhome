-- assert-rattachement-articles-sans-offre.sql — vérifie 20261129_4_rattachement_articles_sans_offre.sql sur le cluster
-- de répétition (spec import d'articles § 6.5) : une ligne de relevé se rattache à un article sans ligne active à prix
-- (article importé, ou dont les lignes ont été éteintes) quand ses clés correspondent, et la proposition de fusion lit
-- aussi les clés portées par l'article lui-même.
-- Chaîne (le snapshot ne photographie ni catalog_item_merge, ni catalog_item_proposals_decide, ni
-- catalog_item_proposals_propose ; ACL par objet et colonne `recherche` non photographiées) :
--   fixture-catalog-harmonisation-prod.sql → 20261028_4 → 20261124_2 → 20261129_2 → 20261129_3 → 20261129_4,
-- avec assert-catalog-items.sql et assert-catalog-items-harmonisation.sql dans la même chaîne (non-régression).
-- Autonome : crée ses fournisseurs et ses articles dans Mayer, les supprime à la fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_i5 uuid; v_i6 uuid; v_i7 uuid;
  v_n2 uuid; v_n4 uuid;
  v_s5 uuid; v_a6 uuid; v_b6 uuid; v_n6 uuid; v_z uuid; v_nz uuid; v_i9 uuid; v_tous uuid[];
  v_res jsonb;
  v_p record;
  v_n int;
  f text;
  -- gabarit d'une ligne de relevé (clés lues par supplier_catalog_upsert)
  v_ligne jsonb := '{"name":"Test","brand":"BAYWA","gamme":"Test","product_kind":"main","selling_price_ht_defaut":0,
                     "default_tva_rate":20,"unit":"pièce","category":"photovoltaique","image_url":null,"image_source_url":null,
                     "specs":{"canonical":{}}}'::jsonb;
BEGIN
  -- (0) signatures et droits inchangés : service_role seul
  FOREACH f IN ARRAY ARRAY['public.catalog_items_ensure(uuid, integer)', 'public.catalog_item_proposals_propose(uuid)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par anon', f; END IF;
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par authenticated', f; END IF;
    IF has_function_privilege('service_role', f, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION '% non exécutable par service_role', f; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '% exécutable par PUBLIC', f;
    END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '% doit être SECURITY DEFINER', f; END IF;
    IF (SELECT prorettype = 'jsonb'::regtype FROM pg_proc WHERE oid = f::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '% doit rendre jsonb', f; END IF;
  END LOOP;

  -- fixture : fournisseurs
  INSERT INTO majordhome.suppliers (org_id, name, is_active, category_mapping) VALUES (v_mayer, 'TEST SANS OFFRE S1', true, '{}'::jsonb) RETURNING id INTO v_s1;
  INSERT INTO majordhome.suppliers (org_id, name, is_active, category_mapping) VALUES (v_mayer, 'TEST SANS OFFRE S2', true, '{}'::jsonb) RETURNING id INTO v_s2;
  INSERT INTO majordhome.suppliers (org_id, name, is_active, category_mapping) VALUES (v_mayer, 'TEST SANS OFFRE BAYWA', true, '{}'::jsonb) RETURNING id INTO v_s3;
  INSERT INTO majordhome.suppliers (org_id, name, is_active, category_mapping) VALUES (v_mayer, 'TEST SANS OFFRE S4', true, '{}'::jsonb) RETURNING id INTO v_s4;

  -- fixture : articles importés (aucune ligne fournisseur)
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin)
  VALUES (v_mayer, 'Importé X1', 'BAYWA', 'X1', 'main', 100, 'manuel') RETURNING id INTO v_i1;
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin)
  VALUES (v_mayer, 'Importé X2', 'BAYWA', 'X2', 'main', 100, 'manuel') RETURNING id INTO v_i2;
  INSERT INTO majordhome.catalog_items (org_id, name, brand, code_ean, product_kind, selling_price_ht, origin)
  VALUES (v_mayer, 'Importé EAN', 'TESTEAN', '3760000000017', 'main', 0, 'manuel') RETURNING id INTO v_i3;
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin)
  VALUES (v_mayer, 'Importé X3 (a)', 'BAYWA', 'X3', 'main', 100, 'manuel') RETURNING id INTO v_i4;
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin)
  VALUES (v_mayer, 'Importé X3 (b)', 'BAYWA', 'X3', 'main', 100, 'manuel') RETURNING id INTO v_i5;

  -- (1) relevé S1 : X1 à 60 € ≤ prix de vente 100 → rattachée à l'article importé (cle) ; X2 à 150 € > 100 → article
  --     créé ; X3 → deux articles importés candidats → article créé
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_s1, 's1', jsonb_build_array(
    v_ligne || '{"reference":"R1","model_key":"X1","purchase_price_ht":60}'::jsonb,
    v_ligne || '{"reference":"R2","model_key":"X2","purchase_price_ht":150}'::jsonb,
    v_ligne || '{"reference":"R4","model_key":"X3","purchase_price_ht":50}'::jsonb));
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_s1 AND reference = 'R1';
  IF v_p.catalog_item_id IS DISTINCT FROM v_i1 OR v_p.catalog_item_link_source IS DISTINCT FROM 'cle' THEN
    RAISE EXCEPTION '(1) R1 non rattachée à l''article importé X1 : % %', v_p.catalog_item_id, v_p.catalog_item_link_source;
  END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_s1 AND reference = 'R2';
  IF v_p.catalog_item_id = v_i2 OR v_p.catalog_item_link_source IS DISTINCT FROM 'auto' THEN
    RAISE EXCEPTION '(1) R2 (achat 150 > vente 100) rattachée : % %', v_p.catalog_item_id, v_p.catalog_item_link_source;
  END IF;
  v_n2 := v_p.catalog_item_id;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_s1 AND reference = 'R4';
  IF v_p.catalog_item_id IN (v_i4, v_i5) OR v_p.catalog_item_link_source IS DISTINCT FROM 'auto' THEN
    RAISE EXCEPTION '(3) R4 rattachée malgré deux candidats : % %', v_p.catalog_item_id, v_p.catalog_item_link_source;
  END IF;
  v_n4 := v_p.catalog_item_id;
  IF (v_res->'articles'->>'crees')::int <> 2 OR (v_res->'articles'->>'rattaches')::int <> 1 THEN
    RAISE EXCEPTION '(1) relevé S1 : % (2 créés, 1 rattaché attendus)', v_res->'articles';
  END IF;
  SELECT count(*) INTO v_n FROM majordhome.catalog_items WHERE org_id = v_mayer AND brand = 'BAYWA' AND model_key = 'X1';
  IF v_n <> 1 THEN RAISE EXCEPTION '(1) X1 : % articles au lieu d''un', v_n; END IF;

  -- (2) EAN : une ligne d'un autre fournisseur avec l'EAN de l'article importé (prix de vente 0 : pas de contrôle de prix)
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, code_ean, purchase_price_ht, category)
  VALUES (v_s2, v_mayer, 'E1', 'Ligne EAN', 'TESTEAN', '3760000000017', 40, 'photovoltaique');
  SET LOCAL ROLE service_role;
  v_res := public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_s2 AND reference = 'E1';
  IF v_p.catalog_item_id IS DISTINCT FROM v_i3 OR v_p.catalog_item_link_source IS DISTINCT FROM 'ean' THEN
    RAISE EXCEPTION '(2) E1 non rattachée par l''EAN : % % (%)', v_p.catalog_item_id, v_p.catalog_item_link_source, v_res;
  END IF;

  -- (4) la seule ligne BAYWA de l'article est INACTIVE : une nouvelle ligne BAYWA, même marque et même modèle, autre
  --     référence, se rattache (le relevé suivant éteint OLD-1 avant de créer les articles)
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_s3, 'b1', jsonb_build_array(v_ligne || '{"reference":"OLD-1","model_key":"X4","purchase_price_ht":200}'::jsonb));
  RESET ROLE;
  SELECT catalog_item_id INTO v_i6 FROM majordhome.supplier_products WHERE supplier_id = v_s3 AND reference = 'OLD-1';
  IF v_i6 IS NULL THEN RAISE EXCEPTION '(4) OLD-1 sans article'; END IF;
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_s3, 'b2', jsonb_build_array(v_ligne || '{"reference":"NEW-1","model_key":"X4","purchase_price_ht":210}'::jsonb));
  RESET ROLE;
  IF (SELECT is_active FROM majordhome.supplier_products WHERE supplier_id = v_s3 AND reference = 'OLD-1') IS NOT FALSE THEN
    RAISE EXCEPTION '(4) OLD-1 non éteinte par le relevé';
  END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_s3 AND reference = 'NEW-1';
  IF v_p.catalog_item_id IS DISTINCT FROM v_i6 OR v_p.catalog_item_link_source IS DISTINCT FROM 'cle' THEN
    RAISE EXCEPTION '(4) NEW-1 non rattachée à l''article dont la ligne BAYWA est éteinte : % % (%)', v_p.catalog_item_id, v_p.catalog_item_link_source, v_res->'articles';
  END IF;

  -- (5) clés portées par une LIGNE de l'article (l'article lui-même n'a pas de modèle) : rattachement par la ligne
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, purchase_price_ht, category)
  VALUES (v_s2, v_mayer, 'L5', 'Ligne sans modèle', 'BAYWA', 300, 'photovoltaique');
  SET LOCAL ROLE service_role;
  PERFORM public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  SELECT catalog_item_id INTO v_i7 FROM majordhome.supplier_products WHERE supplier_id = v_s2 AND reference = 'L5';
  IF (SELECT model_key FROM majordhome.catalog_items WHERE id = v_i7) IS NOT NULL THEN RAISE EXCEPTION '(5) fixture : article L5 avec un modèle'; END IF;
  UPDATE majordhome.supplier_products SET model_key = 'X5', model_key_source = 'ia' WHERE supplier_id = v_s2 AND reference = 'L5';
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category)
  VALUES (v_s4, v_mayer, 'M5', 'Ligne X5', 'baywa', 'X5', 320, 'photovoltaique');
  SET LOCAL ROLE service_role;
  v_res := public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_s4 AND reference = 'M5';
  IF v_p.catalog_item_id IS DISTINCT FROM v_i7 OR v_p.catalog_item_link_source IS DISTINCT FROM 'cle' THEN
    RAISE EXCEPTION '(5) M5 non rattachée par la clé de la ligne L5 : % % (%)', v_p.catalog_item_id, v_p.catalog_item_link_source, v_res;
  END IF;

  -- (6) propositions : les clés de l'article lui-même comptent. X2 : importé ↔ créé par le relevé ; X3 : les deux
  --     importés et l'article créé (trois paires). Aucune fusion d'office : l'article importé n'a pas de prix d'achat.
  SET LOCAL ROLE service_role;
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;
  IF (v_res->>'fusionnes')::int <> 0 OR (v_res->>'proposes')::int <> 4 THEN
    RAISE EXCEPTION '(6) propositions : % (0 fusion, 4 propositions attendues)', v_res;
  END IF;
  SELECT * INTO v_p FROM majordhome.catalog_item_proposals WHERE item_a_id = least(v_i2, v_n2) AND item_b_id = greatest(v_i2, v_n2);
  IF v_p.statut IS DISTINCT FROM 'propose' OR v_p.source IS DISTINCT FROM 'cle' THEN
    RAISE EXCEPTION '(6) X2 : proposition importé ↔ relevé absente : % %', v_p.statut, v_p.source;
  END IF;
  SELECT count(*) INTO v_n FROM majordhome.catalog_item_proposals
   WHERE statut = 'propose' AND item_a_id = ANY (ARRAY[v_i4, v_i5, v_n4]) AND item_b_id = ANY (ARRAY[v_i4, v_i5, v_n4]);
  IF v_n <> 3 THEN RAISE EXCEPTION '(6) X3 : % propositions au lieu de 3', v_n; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE id IN (v_i1, v_i2, v_i3, v_i4, v_i5, v_i6, v_i7, v_n2, v_n4) AND merged_into IS NOT NULL) THEN
    RAISE EXCEPTION '(6) un article a été fusionné d''office';
  END IF;
  -- idempotence
  SET LOCAL ROLE service_role;
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;
  IF (v_res->>'nouvelles')::int <> 0 THEN RAISE EXCEPTION '(6) relance non idempotente : %', v_res; END IF;
  SET LOCAL ROLE service_role;
  v_res := public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  IF (v_res->>'crees')::int <> 0 OR (v_res->>'rattaches')::int <> 0 THEN RAISE EXCEPTION '(6) ensure non idempotent : %', v_res; END IF;

  -- (7) revue 1 — nouvelle ambiguïté : un article AVEC offre (ligne S1 à 100 €) et un article importé portent la même
  --     clé ; une ligne d'un troisième fournisseur arrive ⇒ article créé (deux candidats), puis trois propositions et
  --     aucune fusion d'office (chaque article a deux partenaires pour la clé : pas franche)
  INSERT INTO majordhome.suppliers (org_id, name, is_active, category_mapping) VALUES (v_mayer, 'TEST SANS OFFRE S5', true, '{}'::jsonb) RETURNING id INTO v_s5;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category)
  VALUES (v_s1, v_mayer, 'A6', 'Avec offre X6', 'BAYWA', 'X6', 100, 'photovoltaique');
  SET LOCAL ROLE service_role;
  PERFORM public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  SELECT catalog_item_id INTO v_a6 FROM majordhome.supplier_products WHERE supplier_id = v_s1 AND reference = 'A6';
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin)
  VALUES (v_mayer, 'Importé X6', 'BAYWA', 'X6', 'main', 200, 'manuel') RETURNING id INTO v_b6;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category)
  VALUES (v_s4, v_mayer, 'C6', 'Troisième X6', 'BAYWA', 'X6', 110, 'photovoltaique');
  SET LOCAL ROLE service_role;
  PERFORM public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_s4 AND reference = 'C6';
  IF v_p.catalog_item_id IN (v_a6, v_b6) OR v_p.catalog_item_link_source IS DISTINCT FROM 'auto' THEN
    RAISE EXCEPTION '(7) C6 rattachée malgré deux candidats (article avec offre + article importé) : % %', v_p.catalog_item_id, v_p.catalog_item_link_source;
  END IF;
  v_n6 := v_p.catalog_item_id;

  -- (8) EAN fait de zéros : pas une clé (ni rattachement, ni recopie sur l'article créé)
  INSERT INTO majordhome.catalog_items (org_id, name, brand, code_ean, product_kind, selling_price_ht, origin)
  VALUES (v_mayer, 'Importé EAN zéro', 'TESTZERO', '00000000', 'main', 0, 'manuel') RETURNING id INTO v_z;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, code_ean, purchase_price_ht, category)
  VALUES (v_s2, v_mayer, 'Z1', 'Ligne EAN zéro', 'TESTZERO', '00000000', 10, 'photovoltaique');
  -- (9) clé portée par la ligne d'un fournisseur INACTIF : ne compte pas
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, purchase_price_ht, category)
  VALUES (v_s5, v_mayer, 'L9', 'Ligne fournisseur éteint', 'BAYWA', 50, 'photovoltaique');
  SET LOCAL ROLE service_role;
  PERFORM public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  SELECT catalog_item_id INTO v_i9 FROM majordhome.supplier_products WHERE supplier_id = v_s5 AND reference = 'L9';
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_s2 AND reference = 'Z1';
  IF v_p.catalog_item_id = v_z OR v_p.catalog_item_link_source IS DISTINCT FROM 'auto' THEN RAISE EXCEPTION '(8) Z1 rattachée par un EAN de zéros'; END IF;
  v_nz := v_p.catalog_item_id;
  IF (SELECT code_ean FROM majordhome.catalog_items WHERE id = v_nz) IS NOT NULL THEN RAISE EXCEPTION '(8) EAN de zéros recopié sur l''article créé'; END IF;
  UPDATE majordhome.supplier_products SET model_key = 'X9', model_key_source = 'ia' WHERE supplier_id = v_s5 AND reference = 'L9';
  UPDATE majordhome.suppliers SET is_active = false WHERE id = v_s5;
  -- (10) plus de 10 articles portent la clé ⇒ ambigu (création)
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin)
  SELECT v_mayer, 'Importé X10 n°' || k, 'BAYWA', 'X10', 'main', 0, 'manuel' FROM generate_series(1, 11) k;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category)
  VALUES (v_s4, v_mayer, 'M9', 'Ligne X9', 'BAYWA', 'X9', 55, 'photovoltaique'),
         (v_s4, v_mayer, 'M10', 'Ligne X10', 'BAYWA', 'X10', 10, 'photovoltaique');
  SET LOCAL ROLE service_role;
  v_res := public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  IF (v_res->>'crees')::int <> 2 OR (v_res->>'rattaches')::int <> 0 THEN RAISE EXCEPTION '(9-10) ensure : % (2 créés attendus)', v_res; END IF;
  IF (SELECT catalog_item_id FROM majordhome.supplier_products WHERE supplier_id = v_s4 AND reference = 'M9') = v_i9 THEN
    RAISE EXCEPTION '(9) M9 rattachée par la clé d''une ligne de fournisseur inactif';
  END IF;
  -- propositions : X6 trois paires, pas de fusion ; EAN zéro, X9 (fournisseur inactif), X10 (> 10 articles) : rien
  SET LOCAL ROLE service_role;
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;
  IF (v_res->>'fusionnes')::int <> 0 OR (v_res->>'proposes')::int <> 3 THEN
    RAISE EXCEPTION '(7) propositions : % (0 fusion, 3 propositions attendues)', v_res;
  END IF;
  SELECT count(*) INTO v_n FROM majordhome.catalog_item_proposals
   WHERE statut = 'propose' AND item_a_id = ANY (ARRAY[v_a6, v_b6, v_n6]) AND item_b_id = ANY (ARRAY[v_a6, v_b6, v_n6]);
  IF v_n <> 3 THEN RAISE EXCEPTION '(7) X6 : % propositions au lieu de 3', v_n; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE id IN (v_a6, v_b6, v_n6) AND merged_into IS NOT NULL) THEN
    RAISE EXCEPTION '(7) X6 : fusion d''office';
  END IF;

  -- index de la recherche par l'EAN des lignes (sinon un parcours complet par ligne relevée)
  IF to_regclass('majordhome.supplier_products_org_ean_idx') IS NULL THEN RAISE EXCEPTION 'index supplier_products_org_ean_idx absent'; END IF;

  -- nettoyage (tous les articles de la fixture : ceux de ses lignes, plus les importés)
  v_tous := ARRAY[v_i1, v_i2, v_i3, v_i4, v_i5, v_i6, v_i7, v_n2, v_n4, v_a6, v_b6, v_n6, v_z, v_nz, v_i9]
            || ARRAY(SELECT catalog_item_id FROM majordhome.supplier_products WHERE supplier_id IN (v_s1, v_s2, v_s3, v_s4, v_s5) AND catalog_item_id IS NOT NULL)
            || ARRAY(SELECT id FROM majordhome.catalog_items WHERE org_id = v_mayer AND brand = 'BAYWA' AND model_key = 'X10');
  DELETE FROM majordhome.catalog_item_proposals WHERE item_a_id = ANY (v_tous) OR item_b_id = ANY (v_tous);
  DELETE FROM majordhome.supplier_products WHERE supplier_id IN (v_s1, v_s2, v_s3, v_s4, v_s5);
  DELETE FROM majordhome.catalog_items WHERE id = ANY (v_tous);
  DELETE FROM majordhome.suppliers WHERE id IN (v_s1, v_s2, v_s3, v_s4, v_s5);

  RAISE NOTICE 'assert-rattachement-articles-sans-offre : OK';
END $$;
