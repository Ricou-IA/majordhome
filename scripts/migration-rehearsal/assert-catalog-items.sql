-- assert-catalog-items.sql — vérifie 20261026_1_catalog_items.sql sur le cluster de répétition.
-- Couvre : création automatique des articles en fin de relevé (rattachement franc ou création), purchase_price_at,
-- vues _list / _item_offers, article sans offre active (reste, invisible au devis), apply_mapping v3 (article à une
-- ligne reclassé), droits (org_admin seul en écriture, anon rien, service_role SELECT), idempotence, doublon legacy,
-- colonnes catalog_item_id en fin des vues d'écriture.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_a uuid; v_b uuid;
  v_admin uuid; v_membre uuid;
  v_res jsonb;
  v_p record; v_i record;
  v_n int;
  v_item_pw uuid; v_item_a2 uuid; v_item_a3 uuid;
  v_rows_a jsonb := '[
    {"reference":"A1","name":"Tesla Powerwall 3","brand":"Tesla","gamme":"Batterie","product_kind":"main",
     "purchase_price_ht":4773.29,"selling_price_ht_defaut":5500,"default_tva_rate":20,"unit":"pièce","category":"batterie",
     "image_url":"https://x/pw3.jpg","image_source_url":null,"model_key":"170700030L",
     "specs":{"canonical":{"mpn":"1707000-30-L","categories_site":["Battery Storage"],"stock_releve":{"qty":3,"at":"2026-10-24T04:00:00Z"}},"source_version":"a1"}},
    {"reference":"A2","name":"Câble Powerwall","brand":"Tesla","gamme":"Accessoires","product_kind":"accessory",
     "purchase_price_ht":30,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie",
     "tarif_public":100,"taux_remise":60,
     "image_url":null,"image_source_url":null,"model_key":null,
     "specs":{"canonical":{"categories_site":["Battery Storage"]},"source_version":"a1"}},
    {"reference":"A3","name":"Huawei LUNA2000 7 kWh","brand":"Huawei","gamme":"Batterie","product_kind":"main",
     "purchase_price_ht":1200,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie",
     "image_url":null,"image_source_url":null,"model_key":"LUNA20007E1",
     "specs":{"canonical":{"categories_site":["Battery Storage"]},"source_version":"a1"}}
  ]'::jsonb;
  v_rows_b jsonb := '[
    {"reference":"B1","name":"POWERWALL 3 TESLA","brand":"TESLA","gamme":"Batterie AC","product_kind":"main",
     "purchase_price_ht":4900,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie",
     "image_url":null,"image_source_url":null,"model_key":"170700030L","purchase_price_at":"2026-09-01T00:00:00Z",
     "specs":{"canonical":{"categories_site":["batteries-ac"],"stock_releve":{"en_stock":true,"at":"2026-09-01T00:00:00Z"}},"source_version":"b1"}},
    {"reference":"B3","name":"LUNA2000-7-E1","brand":"huawei","gamme":"Batterie","product_kind":"main",
     "purchase_price_ht":3000,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie",
     "image_url":null,"image_source_url":null,"model_key":"LUNA20007E1",
     "specs":{"canonical":{"categories_site":["batteries-dc"]},"source_version":"b1"}},
    {"reference":"B4","name":"Compteur Kamase","brand":"Kamase","gamme":"Compteur","product_kind":"accessory",
     "purchase_price_ht":25,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"photovoltaique",
     "image_url":null,"image_source_url":null,"model_key":null,
     "specs":{"canonical":{"categories_site":[]},"source_version":"b1"}}
  ]'::jsonb;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer AND role <> 'org_admin' LIMIT 1;

  -- (0) droits et structure
  IF has_function_privilege('authenticated', 'public.catalog_items_ensure(uuid, int)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute catalog_items_ensure'; END IF;
  IF has_function_privilege('anon', 'public.catalog_items_ensure(uuid, int)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute catalog_items_ensure'; END IF;
  IF has_table_privilege('anon', 'majordhome.catalog_items', 'SELECT') THEN RAISE EXCEPTION 'anon lit catalog_items'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.catalog_items', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur catalog_items'; END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    AND c.relname IN ('majordhome_catalog_items', 'majordhome_catalog_items_list', 'majordhome_catalog_item_offers')
    AND c.reloptions::text LIKE '%security_invoker=true%';
  IF v_n <> 3 THEN RAISE EXCEPTION 'vues articles sans security_invoker (%/3)', v_n; END IF;
  FOR v_p IN SELECT table_name, column_name, ordinal_position FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name IN ('majordhome_quote_lines_write')
               AND ordinal_position = (SELECT max(ordinal_position) FROM information_schema.columns c2 WHERE c2.table_schema = 'public' AND c2.table_name = columns.table_name)
  LOOP
    IF v_p.column_name <> 'catalog_item_id' THEN RAISE EXCEPTION 'catalog_item_id n''est pas la dernière colonne de % (%)', v_p.table_name, v_p.column_name; END IF;
  END LOOP;
  -- relecture M5 : la matrice et la date du prix ne passent JAMAIS par la vue d'écriture (policy UPDATE = tout membre)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_supplier_products_write' AND column_name IN ('catalog_item_id', 'purchase_price_at')) THEN
    RAISE EXCEPTION 'catalog_item_id / purchase_price_at exposées par majordhome_supplier_products_write';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_supplier_products' AND column_name = 'catalog_item_id') THEN
    RAISE EXCEPTION 'catalog_item_id absente de la vue de lecture';
  END IF;

  -- fixture
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active, category_mapping, auto_sync)
  VALUES (v_mayer, 'TEST ITEMS A', 'suitecommerce', 'https://a.test', true, '{}'::jsonb, true) RETURNING id INTO v_a;
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active, category_mapping, auto_sync)
  VALUES (v_mayer, 'TEST ITEMS B', 'woocommerce', 'https://b.test', true, '{}'::jsonb, false) RETURNING id INTO v_b;

  -- (1) premier relevé de A : 3 articles créés
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_a, 'a1', v_rows_a);
  RESET ROLE;
  IF (v_res->'articles'->>'crees')::int <> 3 OR (v_res->'articles'->>'rattaches')::int <> 0 THEN RAISE EXCEPTION 'relevé A : %', v_res->'articles'; END IF;
  SELECT count(*) INTO v_n FROM majordhome.supplier_products p JOIN majordhome.catalog_items i ON i.id = p.catalog_item_id
  WHERE p.supplier_id = v_a AND p.catalog_item_link_source = 'auto' AND i.origin = 'auto' AND i.source_product_id = p.id AND i.org_id = v_mayer
    AND p.purchase_price_at > now() - interval '1 minute';
  IF v_n <> 3 THEN RAISE EXCEPTION 'articles de A mal créés (%/3)', v_n; END IF;
  SELECT p.catalog_item_id INTO v_item_pw FROM majordhome.supplier_products p WHERE p.supplier_id = v_a AND p.reference = 'A1';
  SELECT p.catalog_item_id INTO v_item_a2 FROM majordhome.supplier_products p WHERE p.supplier_id = v_a AND p.reference = 'A2';
  SELECT p.catalog_item_id INTO v_item_a3 FROM majordhome.supplier_products p WHERE p.supplier_id = v_a AND p.reference = 'A3';
  SELECT * INTO v_i FROM majordhome.catalog_items WHERE id = v_item_pw;
  IF v_i.name <> 'Tesla Powerwall 3' OR v_i.brand <> 'Tesla' OR v_i.model_key <> '170700030L' OR v_i.category <> 'batterie' OR v_i.selling_price_ht <> 5500
     OR v_i.image_url <> 'https://x/pw3.jpg' OR v_i.specs->'canonical'->>'mpn' <> '1707000-30-L' OR v_i.product_kind <> 'main' THEN
    RAISE EXCEPTION 'article Powerwall mal copié : %', to_jsonb(v_i);
  END IF;

  -- (2) relevé de B : B1 rattachée à la Powerwall (clé), B3 crée (rapport > 2), B4 crée
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_b, 'b1', v_rows_b);
  RESET ROLE;
  IF (v_res->'articles'->>'crees')::int <> 2 OR (v_res->'articles'->>'rattaches')::int <> 1 THEN RAISE EXCEPTION 'relevé B : %', v_res->'articles'; END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_b AND reference = 'B1';
  IF v_p.catalog_item_id <> v_item_pw OR v_p.catalog_item_link_source <> 'cle' THEN RAISE EXCEPTION 'B1 non rattachée à la Powerwall : % %', v_p.catalog_item_id, v_p.catalog_item_link_source; END IF;
  IF v_p.purchase_price_at <> '2026-09-01T00:00:00Z'::timestamptz THEN RAISE EXCEPTION 'purchase_price_at fourni non respecté : %', v_p.purchase_price_at; END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_b AND reference = 'B3';
  IF v_p.catalog_item_id = v_item_a3 THEN RAISE EXCEPTION 'B3 rattachée malgré un rapport de prix > 2'; END IF;

  -- (3) vue liste
  SELECT * INTO v_i FROM public.majordhome_catalog_items_list WHERE id = v_item_pw;
  IF v_i.offres_actives <> 2 OR v_i.offres_total <> 2 OR v_i.meilleur_prix_achat <> 4773.29
     OR NOT (v_i.fournisseurs @> ARRAY['TEST ITEMS A', 'TEST ITEMS B']) THEN
    RAISE EXCEPTION 'vue liste Powerwall : % % % %', v_i.offres_actives, v_i.offres_total, v_i.meilleur_prix_achat, v_i.fournisseurs;
  END IF;

  -- (4) vue offres : stock lu depuis specs.canonical.stock_releve
  SELECT count(*) INTO v_n FROM public.majordhome_catalog_item_offers WHERE item_id = v_item_pw;
  IF v_n <> 2 THEN RAISE EXCEPTION 'offres Powerwall : %', v_n; END IF;
  SELECT * INTO v_p FROM public.majordhome_catalog_item_offers WHERE item_id = v_item_pw AND supplier_id = v_a;
  IF v_p.stock_qty <> 3 OR v_p.en_stock IS NOT NULL OR v_p.supplier_auto_sync IS NOT TRUE OR v_p.supplier_name <> 'TEST ITEMS A' OR v_p.reference <> 'A1' THEN
    RAISE EXCEPTION 'offre A1 : % % %', v_p.stock_qty, v_p.en_stock, v_p.supplier_name;
  END IF;
  SELECT * INTO v_p FROM public.majordhome_catalog_item_offers WHERE item_id = v_item_pw AND supplier_id = v_b;
  IF v_p.en_stock IS NOT TRUE OR v_p.stock_qty IS NOT NULL OR v_p.purchase_price_at <> '2026-09-01T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'offre B1 : % % %', v_p.stock_qty, v_p.en_stock, v_p.purchase_price_at;
  END IF;

  -- prix public et taux de remise = faits fournisseur (import d'achats Soditelem) : posés à l'INSERT…
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference = 'A2';
  IF v_p.tarif_public <> 100 OR v_p.taux_remise <> 60 THEN RAISE EXCEPTION 'tarif_public / taux_remise non posés : % %', v_p.tarif_public, v_p.taux_remise; END IF;

  -- (5) Review Focus 1 : A3 absente du relevé suivant → ligne désactivée, article conservé, 0 offre active
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_a, 'a2', jsonb_set(v_rows_a - 2, '{1,tarif_public}', '110'));
  RESET ROLE;
  -- … et rafraîchis à chaque relevé
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference = 'A2';
  IF v_p.tarif_public <> 110 OR v_p.taux_remise <> 60 THEN RAISE EXCEPTION 'tarif_public non rafraîchi : % %', v_p.tarif_public, v_p.taux_remise; END IF;
  IF (v_res->>'desactives')::int <> 1 OR (v_res->'articles'->>'crees')::int <> 0 THEN RAISE EXCEPTION 'relevé a2 : %', v_res; END IF;
  SELECT * INTO v_i FROM public.majordhome_catalog_items_list WHERE id = v_item_a3;
  IF v_i.is_active IS NOT TRUE OR v_i.merged_into IS NOT NULL OR v_i.offres_actives <> 0 OR v_i.offres_total <> 1 THEN
    RAISE EXCEPTION 'article A3 : % % % %', v_i.is_active, v_i.merged_into, v_i.offres_actives, v_i.offres_total;
  END IF;

  -- (6) apply_mapping v3 : l'article à une seule ligne suit la ligne, l'article à deux lignes ne bouge pas
  UPDATE majordhome.suppliers SET category_mapping = '{"Battery Storage": "photovoltaique"}'::jsonb WHERE id = v_a;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.supplier_catalog_apply_mapping(v_a);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (v_res->>'reclasses')::int < 2 THEN RAISE EXCEPTION 'apply_mapping v3 : %', v_res; END IF;
  SELECT category INTO v_i FROM majordhome.catalog_items WHERE id = v_item_a2;
  IF v_i.category <> 'photovoltaique' THEN RAISE EXCEPTION 'article A2 (une ligne) non reclassé : %', v_i.category; END IF;
  SELECT category INTO v_i FROM majordhome.catalog_items WHERE id = v_item_pw;
  IF v_i.category <> 'batterie' THEN RAISE EXCEPTION 'article Powerwall (deux lignes) reclassé : %', v_i.category; END IF;

  -- (7) écriture des champs humains : membre 0 ligne, admin 1 ligne
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  UPDATE public.majordhome_catalog_items SET name = 'Powerwall renommée' WHERE id = v_item_pw;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'un membre non admin a modifié un article'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  UPDATE public.majordhome_catalog_items SET name = 'Powerwall renommée' WHERE id = v_item_pw;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_n <> 1 THEN RAISE EXCEPTION 'l''admin n''a pas pu modifier l''article'; END IF;
  SELECT name INTO v_i FROM majordhome.catalog_items WHERE id = v_item_pw;
  IF v_i.name <> 'Powerwall renommée' THEN RAISE EXCEPTION 'nom non écrit'; END IF;

  -- (8) idempotence
  SET LOCAL ROLE service_role;
  v_res := public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  IF (v_res->>'crees')::int <> 0 OR (v_res->>'rattaches')::int <> 0 THEN RAISE EXCEPTION 'ensure non idempotent : %', v_res; END IF;

  -- (8b) recadrage § 9 : une ligne à prix nul ou offerte dans un pack ne fait pas d'article
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht, category) VALUES (v_a, v_mayer, 'ZERO-1', 'Coude offert', 0, 'fumisterie');
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht, category, specs) VALUES (v_a, v_mayer, 'PACK-1', 'UI offerte dans le pack', 120, 'climatisation', '{"canonical": {"offert_dans_pack": true}}'::jsonb);
  SET LOCAL ROLE service_role;
  v_res := public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  IF (v_res->>'crees')::int <> 0 OR (v_res->>'rattaches')::int <> 0 THEN RAISE EXCEPTION 'ligne à 0 € ou offerte devenue article : %', v_res; END IF;
  SELECT count(*) INTO v_n FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference IN ('ZERO-1', 'PACK-1') AND catalog_item_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 'ligne sans prix rattachée à un article'; END IF;

  -- (9) doublon legacy (même fournisseur, même référence, sans source_version) → un seul article
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht, category) VALUES (v_a, v_mayer, 'DUP-1', 'Doublon legacy', 10, 'fumisterie');
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht, category) VALUES (v_a, v_mayer, 'DUP-1', 'Doublon legacy bis', 12, 'fumisterie');
  SET LOCAL ROLE service_role;
  v_res := public.catalog_items_ensure(v_mayer);
  RESET ROLE;
  IF (v_res->>'crees')::int <> 1 OR (v_res->>'rattaches')::int <> 1 THEN RAISE EXCEPTION 'doublon legacy : %', v_res; END IF;
  SELECT count(DISTINCT catalog_item_id) INTO v_n FROM majordhome.supplier_products WHERE supplier_id = v_a AND reference = 'DUP-1';
  IF v_n <> 1 THEN RAISE EXCEPTION 'doublon legacy : % articles', v_n; END IF;

  -- nettoyage : la fixture (paires inter-fournisseurs) ne doit pas polluer les asserts suivants
  DELETE FROM majordhome.catalog_items WHERE id IN (SELECT catalog_item_id FROM majordhome.supplier_products WHERE supplier_id IN (v_a, v_b));
  DELETE FROM majordhome.supplier_products WHERE supplier_id IN (v_a, v_b);
  DELETE FROM majordhome.suppliers WHERE id IN (v_a, v_b);

  RAISE NOTICE 'assert-catalog-items : OK';
END $$;
