-- assert-catalog-items-harmonisation.sql — vérifie 20261026_2_catalog_items_harmonisation.sql (après 20261026_1).
-- Couvre : propositions de fusion (clé via les lignes, EAN, ambiguïté, rapport de prix), fusion d'office, décision en
-- lot (fusion re-pointe les lignes de devis — Review Focus 2 ; refus mémorisé), rattacher / détacher, droits,
-- retrait de catalog_matches. Fixture nettoyée en fin (les asserts ne sont pas transactionnels).
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_a uuid; v_b uuid;
  v_admin uuid; v_membre uuid;
  v_res jsonb;
  v_p record; v_i record;
  v_n int;
  v_quote uuid;
  v_item_pw uuid; v_item_a3 uuid; v_item_b3 uuid; v_item_a5 uuid; v_item_a6 uuid; v_item_b5 uuid;
  v_item_a8 uuid; v_item_b8 uuid; v_item_a9 uuid; v_item_b9 uuid; v_survivant uuid; v_nouveau uuid;
  v_prop uuid; v_ids uuid[];
  ok boolean;
  v_rows_a jsonb := '[
    {"reference":"A1","name":"Tesla Powerwall 3","brand":"Tesla","gamme":"Batterie","product_kind":"main","purchase_price_ht":4773.29,"selling_price_ht_defaut":5500,"default_tva_rate":20,"unit":"pièce","category":"batterie","image_url":null,"image_source_url":null,"model_key":"170700030L","specs":{"canonical":{"categories_site":["Battery Storage"]},"source_version":"a1"}},
    {"reference":"A3","name":"Huawei LUNA2000 7 kWh","brand":"Huawei","gamme":"Batterie","product_kind":"main","purchase_price_ht":1200,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie","image_url":null,"image_source_url":null,"model_key":"LUNA20007E1","specs":{"canonical":{"categories_site":["Battery Storage"]},"source_version":"a1"}},
    {"reference":"A5","name":"Huawei SUN2000X","brand":"Huawei","gamme":"Onduleurs","product_kind":"main","purchase_price_ht":2449,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"photovoltaique","image_url":null,"image_source_url":null,"model_key":"SUN2000X","specs":{"canonical":{"categories_site":["Inverters"]},"source_version":"a1"}},
    {"reference":"A6","name":"Huawei SUN2000X (bis)","brand":"Huawei","gamme":"Onduleurs","product_kind":"main","purchase_price_ht":2400,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"photovoltaique","image_url":null,"image_source_url":null,"model_key":"SUN2000X","specs":{"canonical":{"categories_site":["Inverters"]},"source_version":"a1"}},
    {"reference":"A8","name":"Pytes V5","brand":"Pytes","gamme":"Batterie","product_kind":"main","purchase_price_ht":880,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie","image_url":null,"image_source_url":null,"model_key":null,"specs":{"canonical":{"categories_site":["Battery Storage"]},"source_version":"a1"}},
    {"reference":"A9","name":"Enphase IQ8","brand":"Enphase","gamme":"Onduleurs","product_kind":"main","purchase_price_ht":150,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"photovoltaique","image_url":null,"image_source_url":null,"model_key":null,"specs":{"canonical":{"categories_site":["Inverters"]},"source_version":"a1"}}
  ]'::jsonb;
  v_rows_b jsonb := '[
    {"reference":"B1","name":"POWERWALL 3 TESLA","brand":"TESLA","gamme":"Batterie AC","product_kind":"main","purchase_price_ht":4900,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie","image_url":null,"image_source_url":null,"model_key":"170700030L","specs":{"canonical":{"categories_site":["batteries-ac"]},"source_version":"b1"}},
    {"reference":"B3","name":"LUNA2000-7-E1","brand":"huawei","gamme":"Batterie","product_kind":"main","purchase_price_ht":3000,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie","image_url":null,"image_source_url":null,"model_key":"LUNA20007E1","specs":{"canonical":{"categories_site":["batteries-dc"]},"source_version":"b1"}},
    {"reference":"B5","name":"SUN2000X Huawei","brand":"HUAWEI","gamme":"Onduleur central","product_kind":"main","purchase_price_ht":2500,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"photovoltaique","image_url":null,"image_source_url":null,"model_key":"SUN2000X","specs":{"canonical":{"categories_site":["onduleur-central"]},"source_version":"b1"}},
    {"reference":"B8","name":"PYTES – V5 Batterie","brand":"PYTES","gamme":"Batterie","product_kind":"main","purchase_price_ht":900,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie","image_url":null,"image_source_url":null,"model_key":null,"specs":{"canonical":{"categories_site":["batteries-dc"]},"source_version":"b1"}},
    {"reference":"B9","name":"Micro-onduleur IQ8","brand":"ENPHASE","gamme":"Micro-onduleurs","product_kind":"main","purchase_price_ht":160,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"photovoltaique","image_url":null,"image_source_url":null,"model_key":null,"specs":{"canonical":{"categories_site":["micro-onduleurs"]},"source_version":"b1"}}
  ]'::jsonb;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer AND role <> 'org_admin' LIMIT 1;

  -- (0) structure et droits
  IF to_regclass('majordhome.catalog_matches') IS NOT NULL THEN RAISE EXCEPTION 'catalog_matches encore présente'; END IF;
  IF to_regclass('public.majordhome_catalog_matches') IS NOT NULL THEN RAISE EXCEPTION 'vue majordhome_catalog_matches encore présente'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('catalog_matches_propose', 'catalog_match_set_status', 'catalog_match_create')) THEN
    RAISE EXCEPTION 'RPC des rapprochements encore présentes';
  END IF;
  IF has_table_privilege('anon', 'majordhome.catalog_item_proposals', 'SELECT') THEN RAISE EXCEPTION 'anon lit les propositions'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.catalog_item_proposals', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur les propositions'; END IF;
  IF has_function_privilege('authenticated', 'public.catalog_item_proposals_propose(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute propose'; END IF;
  IF has_function_privilege('anon', 'public.catalog_item_merge(uuid, uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute merge'; END IF;

  -- fixture : deux fournisseurs relevés
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active, category_mapping, auto_sync)
  VALUES (v_mayer, 'TEST HARMO A', 'suitecommerce', 'https://a.test', true, '{}'::jsonb, true) RETURNING id INTO v_a;
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active, category_mapping, auto_sync)
  VALUES (v_mayer, 'TEST HARMO B', 'woocommerce', 'https://b.test', true, '{}'::jsonb, false) RETURNING id INTO v_b;
  SET LOCAL ROLE service_role;
  PERFORM public.supplier_catalog_upsert(v_mayer, v_a, 'a1', v_rows_a);
  PERFORM public.supplier_catalog_upsert(v_mayer, v_b, 'b1', v_rows_b);
  RESET ROLE;
  SELECT catalog_item_id INTO v_item_pw FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference = 'A1';
  SELECT catalog_item_id INTO v_item_a3 FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference = 'A3';
  SELECT catalog_item_id INTO v_item_b3 FROM majordhome.supplier_products WHERE supplier_id = v_b AND reference = 'B3';
  SELECT catalog_item_id INTO v_item_a5 FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference = 'A5';
  SELECT catalog_item_id INTO v_item_a6 FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference = 'A6';
  SELECT catalog_item_id INTO v_item_b5 FROM majordhome.supplier_products WHERE supplier_id = v_b AND reference = 'B5';
  SELECT catalog_item_id INTO v_item_a8 FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference = 'A8';
  SELECT catalog_item_id INTO v_item_b8 FROM majordhome.supplier_products WHERE supplier_id = v_b AND reference = 'B8';
  SELECT catalog_item_id INTO v_item_a9 FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference = 'A9';
  SELECT catalog_item_id INTO v_item_b9 FROM majordhome.supplier_products WHERE supplier_id = v_b AND reference = 'B9';
  -- à la création : B1 rattachée (clé franche) ; A5 / A6 / B5 trois articles (ambigu) ; A8 / B8 et A9 / B9 sans clé
  IF v_item_a5 = v_item_a6 OR v_item_a5 = v_item_b5 OR v_item_a6 = v_item_b5 THEN RAISE EXCEPTION 'SUN2000X ambigu rattaché à la création'; END IF;
  IF v_item_a8 = v_item_b8 OR v_item_a9 = v_item_b9 THEN RAISE EXCEPTION 'articles sans clé rattachés à la création'; END IF;
  -- l'IA pose la clé après coup ; un EAN apparaît après coup : les propositions lisent les LIGNES
  UPDATE majordhome.supplier_products SET model_key = 'PYTESV5', model_key_source = 'ia' WHERE supplier_id IN (v_a, v_b) AND reference IN ('A8', 'B8');
  UPDATE majordhome.supplier_products SET code_ean = '6971234567890' WHERE supplier_id IN (v_a, v_b) AND reference IN ('A9', 'B9');

  -- (1) proposition : A8/B8 (clé) et A9/B9 (EAN) fusionnés d'office ; A5/B5, A6/B5 (ambigu) et A3/B3 (rapport > 2) proposés
  SET LOCAL ROLE service_role;
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;
  IF (v_res->>'fusionnes')::int <> 2 OR (v_res->>'proposes')::int <> 3 THEN RAISE EXCEPTION 'proposition : %', v_res; END IF;
  SELECT count(*) INTO v_n FROM majordhome.catalog_items WHERE id IN (v_item_a8, v_item_b8) AND merged_into IS NULL AND is_active;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Pytes : % article(s) actif(s)', v_n; END IF;
  SELECT count(DISTINCT catalog_item_id) INTO v_n FROM majordhome.supplier_products WHERE reference IN ('A9', 'B9') AND supplier_id IN (v_a, v_b);
  IF v_n <> 1 THEN RAISE EXCEPTION 'EAN : % articles', v_n; END IF;
  SELECT count(*) INTO v_n FROM majordhome.catalog_item_proposals WHERE statut = 'fusionne' AND org_id = v_mayer
    AND ((item_a_id IN (v_item_a8, v_item_b8) AND item_b_id IN (v_item_a8, v_item_b8)) OR (item_a_id IN (v_item_a9, v_item_b9) AND item_b_id IN (v_item_a9, v_item_b9)));
  IF v_n <> 2 THEN RAISE EXCEPTION 'fusions non journalisées : %', v_n; END IF;
  SELECT count(*) INTO v_n FROM majordhome.catalog_item_proposals WHERE statut = 'propose' AND org_id = v_mayer
    AND item_a_id = ANY (ARRAY[v_item_a3, v_item_b3, v_item_a5, v_item_a6, v_item_b5]) AND item_b_id = ANY (ARRAY[v_item_a3, v_item_b3, v_item_a5, v_item_a6, v_item_b5]);
  IF v_n <> 3 THEN RAISE EXCEPTION '% propositions au lieu de 3', v_n; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_item_proposals WHERE item_a_id = least(v_item_a5, v_item_a6) AND item_b_id = greatest(v_item_a5, v_item_a6)) THEN
    RAISE EXCEPTION 'A5/A6 (même fournisseur) proposés';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.catalog_item_proposals WHERE NOT (item_a_id < item_b_id)) IS FALSE THEN RAISE EXCEPTION 'ordre des paires'; END IF;
  -- vue : écart de prix et noms
  SELECT * INTO v_p FROM public.majordhome_catalog_item_proposals WHERE item_a_id = least(v_item_a3, v_item_b3) AND item_b_id = greatest(v_item_a3, v_item_b3);
  IF v_p.ecart_pct IS NULL OR v_p.item_a_name IS NULL OR v_p.item_b_offres <> 1 THEN RAISE EXCEPTION 'vue propositions : %', to_jsonb(v_p); END IF;
  -- idempotence
  SET LOCAL ROLE service_role;
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;
  IF (v_res->>'nouvelles')::int <> 0 THEN RAISE EXCEPTION 'relance non idempotente : %', v_res; END IF;

  -- (2) Review Focus 2 : des lignes de devis citent les deux articles ; la fusion les re-pointe sur le survivant
  INSERT INTO majordhome.quotes (org_id, quote_number, status, subject) VALUES (v_mayer, 'TEST-HARMO-1', 'brouillon', 'test harmonisation') RETURNING id INTO v_quote;
  INSERT INTO majordhome.quote_lines (quote_id, sort_order, line_type, designation, quantity, unit, unit_price_ht, tva_rate, catalog_item_id, supplier_product_id, supplier_id)
  SELECT v_quote, 1, 'product', 'SUN A5', 1, 'pièce', 3000, 20, v_item_a5, p.id, v_a FROM majordhome.supplier_products p WHERE p.supplier_id = v_a AND p.reference = 'A5';
  INSERT INTO majordhome.quote_lines (quote_id, sort_order, line_type, designation, quantity, unit, unit_price_ht, tva_rate, catalog_item_id, supplier_product_id, supplier_id)
  SELECT v_quote, 2, 'product', 'SUN B5', 1, 'pièce', 3100, 20, v_item_b5, p.id, v_b FROM majordhome.supplier_products p WHERE p.supplier_id = v_b AND p.reference = 'B5';
  SELECT id INTO v_prop FROM majordhome.catalog_item_proposals WHERE item_a_id = least(v_item_a5, v_item_b5) AND item_b_id = greatest(v_item_a5, v_item_b5);
  -- membre : refusé
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  ok := false;
  BEGIN PERFORM public.catalog_item_proposals_decide(ARRAY[v_prop], 'fusionne'); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un membre a fusionné'; END IF;
  ok := false;
  BEGIN PERFORM public.catalog_item_merge(v_item_a5, v_item_b5); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un membre a appelé merge'; END IF;
  -- admin : fusion
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_n := public.catalog_item_proposals_decide(ARRAY[v_prop], 'fusionne');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_n <> 1 THEN RAISE EXCEPTION 'décision : %', v_n; END IF;
  SELECT CASE WHEN merged_into IS NULL THEN id ELSE merged_into END INTO v_survivant FROM majordhome.catalog_items WHERE id = v_item_a5;
  SELECT count(*) INTO v_n FROM majordhome.quote_lines WHERE quote_id = v_quote AND catalog_item_id = v_survivant;
  IF v_n <> 2 THEN RAISE EXCEPTION 'lignes de devis non re-pointées (%/2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM majordhome.supplier_products WHERE catalog_item_id = v_survivant;
  IF v_n <> 2 THEN RAISE EXCEPTION 'lignes fournisseur non re-pointées (%/2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM majordhome.catalog_items WHERE id IN (v_item_a5, v_item_b5) AND merged_into IS NOT NULL AND NOT is_active;
  IF v_n <> 1 THEN RAISE EXCEPTION 'absorbé non marqué'; END IF;
  SELECT statut INTO v_p FROM majordhome.catalog_item_proposals WHERE id = v_prop;
  IF v_p.statut <> 'fusionne' THEN RAISE EXCEPTION 'proposition non passée en fusionne : %', v_p.statut; END IF;
  -- après relance, aucune proposition en attente ne cite un article absorbé (A6/B5 est retirée, A6/survivant partage le fournisseur A)
  SET LOCAL ROLE service_role;
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_item_proposals pr JOIN majordhome.catalog_items i ON i.id IN (pr.item_a_id, pr.item_b_id)
             WHERE pr.statut = 'propose' AND i.merged_into IS NOT NULL) THEN
    RAISE EXCEPTION 'une proposition en attente cite un article absorbé';
  END IF;

  -- (3) refus mémorisé
  SELECT id INTO v_prop FROM majordhome.catalog_item_proposals WHERE item_a_id = least(v_item_a3, v_item_b3) AND item_b_id = greatest(v_item_a3, v_item_b3);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_n := public.catalog_item_proposals_decide(ARRAY[v_prop], 'refuse');
  ok := false;
  BEGIN PERFORM public.catalog_item_proposals_decide(ARRAY[v_prop], 'bidule'); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF NOT ok THEN RAISE EXCEPTION 'statut invalide accepté'; END IF;
  SET LOCAL ROLE service_role;
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;
  SELECT statut INTO v_p FROM majordhome.catalog_item_proposals WHERE id = v_prop;
  IF v_p.statut <> 'refuse' OR (v_res->>'nouvelles')::int <> 0 THEN RAISE EXCEPTION 'refus non mémorisé : % %', v_p.statut, v_res; END IF;

  -- (4) détacher / rattacher
  SELECT id INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_b AND reference = 'B1';
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_nouveau := public.catalog_item_detach(v_p.id);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT * INTO v_i FROM majordhome.supplier_products WHERE id = v_p.id;
  IF v_i.catalog_item_id <> v_nouveau OR v_nouveau = v_item_pw OR v_i.catalog_item_link_source <> 'manuel' THEN RAISE EXCEPTION 'detach : % %', v_i.catalog_item_id, v_i.catalog_item_link_source; END IF;
  SELECT count(*) INTO v_n FROM majordhome.supplier_products WHERE catalog_item_id = v_item_pw;
  IF v_n <> 1 THEN RAISE EXCEPTION 'la Powerwall a perdu A1'; END IF;
  SELECT * INTO v_i FROM majordhome.catalog_items WHERE id = v_nouveau;
  IF v_i.origin <> 'manuel' OR v_i.name <> 'POWERWALL 3 TESLA' OR v_i.org_id <> v_mayer THEN RAISE EXCEPTION 'nouvel article : %', to_jsonb(v_i); END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.catalog_item_attach(v_p.id, v_item_pw);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT * INTO v_i FROM majordhome.supplier_products WHERE id = v_p.id;
  IF v_i.catalog_item_id <> v_item_pw OR v_i.catalog_item_link_source <> 'manuel' THEN RAISE EXCEPTION 'attach : %', v_i.catalog_item_id; END IF;
  SELECT is_active INTO v_i FROM majordhome.catalog_items WHERE id = v_nouveau;
  IF v_i.is_active THEN RAISE EXCEPTION 'article vide resté actif'; END IF;
  -- rattacher sur un article d'une autre org : refusé
  ok := false;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN PERFORM public.catalog_item_attach(v_p.id, gen_random_uuid()); EXCEPTION WHEN SQLSTATE 'P0002' OR SQLSTATE '42501' THEN ok := true; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF NOT ok THEN RAISE EXCEPTION 'attach sur un article inconnu accepté'; END IF;

  -- nettoyage
  DELETE FROM majordhome.quote_lines WHERE quote_id = v_quote;
  DELETE FROM majordhome.quotes WHERE id = v_quote;
  DELETE FROM majordhome.catalog_item_proposals WHERE org_id = v_mayer AND (item_a_id IN (SELECT catalog_item_id FROM majordhome.supplier_products WHERE supplier_id IN (v_a, v_b)) OR item_b_id IN (SELECT catalog_item_id FROM majordhome.supplier_products WHERE supplier_id IN (v_a, v_b)) OR created_at > now() - interval '5 minutes');
  DELETE FROM majordhome.catalog_items WHERE id IN (SELECT catalog_item_id FROM majordhome.supplier_products WHERE supplier_id IN (v_a, v_b)) OR id = v_nouveau OR id IN (v_item_a5, v_item_b5, v_item_a8, v_item_b8, v_item_a9, v_item_b9);
  DELETE FROM majordhome.supplier_products WHERE supplier_id IN (v_a, v_b);
  DELETE FROM majordhome.suppliers WHERE id IN (v_a, v_b);

  RAISE NOTICE 'assert-catalog-items-harmonisation : OK';
END $$;
