-- assert-catalogue-generique.sql — vérifie 20261025_2_catalogue_connexion_generique.sql sur le cluster de répétition
-- (après 20261024_2 et 20261024_5). Couvre : backfill des connecteurs, colonnes et vues, upsert v3 (champs humains
-- à l'INSERT seulement, photo si NULL, clé modèle sauf manuelle, categories_vues, erreur effacée), apply_mapping
-- (org_admin ; exclure / reclasser / réactiver), get_distinct_brands, privilèges, index unique des lignes relevées.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_sup uuid;
  v_admin uuid;
  v_membre uuid;
  v_res jsonb;
  v_p record;
  v_n int;
  ok boolean;
  v_rows jsonb := '[
    {"reference":"35-119503","name":"Tesla Powerwall 3","brand":"Tesla","gamme":"Batterie","product_kind":"main",
     "purchase_price_ht":4773.29,"selling_price_ht_defaut":5500,"default_tva_rate":20,"unit":"pièce","category":"batterie",
     "image_url":"https://x/pw3.jpg","image_source_url":"https://x/pw3","model_key":"170700030L",
     "specs":{"canonical":{"mpn":"1707000-30-L","categories_site":["Battery Storage"]},"source_version":"t1"}},
    {"reference":"32-122546","name":"Borne V2C","brand":"V2C","gamme":"Bornes de recharge","product_kind":"main",
     "purchase_price_ht":500,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"borne_recharge",
     "image_url":null,"image_source_url":null,"model_key":null,
     "specs":{"canonical":{"categories_site":["E-Mobility"]},"source_version":"t1"}},
    {"reference":"37-000001","name":"Compteur sans catégorie","brand":"Kamase","gamme":"Compteur","product_kind":"accessory",
     "purchase_price_ht":30,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"photovoltaique",
     "image_url":null,"image_source_url":null,"model_key":null,
     "specs":{"canonical":{"categories_site":[]},"source_version":"t1"}}
  ]'::jsonb;
BEGIN
  -- privilèges
  IF has_function_privilege('anon', 'public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute upsert v3'; END IF;
  IF has_function_privilege('authenticated', 'public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute upsert v3'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'supplier_catalog_upsert' AND pronamespace = 'public'::regnamespace AND pronargs = 4) THEN RAISE EXCEPTION 'ancienne signature à 4 paramètres toujours présente'; END IF;
  IF has_function_privilege('anon', 'public.supplier_catalog_apply_mapping(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute apply_mapping'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_distinct_brands(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated sans get_distinct_brands'; END IF;
  IF has_function_privilege('anon', 'public.get_distinct_brands(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute get_distinct_brands'; END IF;

  -- colonnes en fin des vues, security_invoker, index
  SELECT count(*) INTO v_n FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name IN ('majordhome_suppliers', 'majordhome_suppliers_write')
    AND column_name IN ('site_url', 'connector_config', 'category_mapping', 'auto_sync', 'catalog_sync_error');
  IF v_n <> 10 THEN RAISE EXCEPTION 'colonnes fournisseur absentes des vues (%/10)', v_n; END IF;
  SELECT count(*) INTO v_n FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name IN ('majordhome_supplier_products', 'majordhome_supplier_products_write') AND column_name IN ('model_key', 'model_key_source');
  IF v_n <> 4 THEN RAISE EXCEPTION 'model_key absent des vues produits (%/4)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    AND c.relname IN ('majordhome_suppliers', 'majordhome_suppliers_write', 'majordhome_supplier_products', 'majordhome_supplier_products_write')
    AND c.reloptions::text LIKE '%security_invoker=true%';
  IF v_n <> 4 THEN RAISE EXCEPTION 'security_invoker perdu'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'majordhome' AND indexname = 'supplier_products_releve_reference_uniq') THEN RAISE EXCEPTION 'index unique des lignes relevées absent'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_connector_check' AND pg_get_constraintdef(oid) LIKE '%baywa%') THEN RAISE EXCEPTION 'CHECK connector encore sur baywa/domos'; END IF;

  -- fixture : fournisseur SuiteCommerce « à la tranche 1 » (connector baywa posé AVANT la migration par le harnais ? non :
  -- le snapshot est antérieur ; on vérifie le backfill sur une ligne créée ici avec l'ancienne valeur impossible après
  -- le CHECK, donc on teste le backfill par insertion directe de 'suitecommerce')
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active, category_mapping)
  VALUES (v_mayer, 'TEST GENERIQUE', 'suitecommerce', 'https://exemple.test', true, '{}'::jsonb) RETURNING id INTO v_sup;
  SELECT * INTO v_p FROM majordhome.suppliers WHERE id = v_sup;
  IF v_p.auto_sync IS NOT FALSE OR v_p.connector_config <> '{}'::jsonb THEN RAISE EXCEPTION 'défauts fournisseur : %, %', v_p.auto_sync, v_p.connector_config; END IF;
  ok := false;
  BEGIN UPDATE majordhome.suppliers SET connector = 'baywa' WHERE id = v_sup; EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'connector baywa encore accepté'; END IF;

  -- (a) premier relevé : 3 insérés, photo / clé posées, categories_vues reprises, erreur effacée
  UPDATE majordhome.suppliers SET catalog_sync_error = '{"ok": false, "code": "x"}'::jsonb WHERE id = v_sup;
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 't1', v_rows, '{"categories_vues": [{"cle": "PV", "nombre": 60}]}'::jsonb);
  RESET ROLE;
  IF (v_res->>'inseres')::int <> 3 OR (v_res->'categories_vues'->0->>'cle') <> 'PV' THEN RAISE EXCEPTION 'premier relevé : %', v_res; END IF;
  SELECT * INTO v_p FROM majordhome.suppliers WHERE id = v_sup;
  IF v_p.catalog_sync_error IS NOT NULL THEN RAISE EXCEPTION 'erreur non effacée au succès'; END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '35-119503';
  IF v_p.image_url <> 'https://x/pw3.jpg' OR v_p.model_key <> '170700030L' OR v_p.model_key_source <> 'cle' OR v_p.category <> 'batterie' THEN
    RAISE EXCEPTION 'Powerwall insérée incorrectement : % % %', v_p.image_url, v_p.model_key, v_p.category;
  END IF;

  -- (b) corrections humaines : catégorie, nature, marque, gamme, photo, clé manuelle → survivent au ré-import
  UPDATE majordhome.supplier_products SET category = 'photovoltaique', product_kind = 'accessory', brand = 'TESLA INC', gamme = 'Ma gamme',
    image_url = 'https://x/ma-photo.jpg', model_key = 'MANUEL1', model_key_source = 'manuel'
  WHERE supplier_id = v_sup AND reference = '35-119503';
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 't2',
    jsonb_set(jsonb_set(v_rows, '{0,purchase_price_ht}', '4800'), '{0,model_key}', '"AUTRE"'));
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '35-119503';
  IF v_p.category <> 'photovoltaique' OR v_p.product_kind <> 'accessory' OR v_p.brand <> 'TESLA INC' OR v_p.gamme <> 'Ma gamme' THEN
    RAISE EXCEPTION 'champs humains écrasés par le relevé : % % % %', v_p.category, v_p.product_kind, v_p.brand, v_p.gamme;
  END IF;
  IF v_p.image_url <> 'https://x/ma-photo.jpg' THEN RAISE EXCEPTION 'photo manuelle écrasée'; END IF;
  IF v_p.model_key <> 'MANUEL1' OR v_p.model_key_source <> 'manuel' THEN RAISE EXCEPTION 'clé manuelle recalculée : %', v_p.model_key; END IF;
  IF v_p.purchase_price_ht <> 4800 THEN RAISE EXCEPTION 'prix d''achat non suivi'; END IF;
  -- clé non manuelle : recalculée ; photo posée si elle était NULL
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 't3',
    jsonb_set(jsonb_set(v_rows, '{1,model_key}', '"V2CTRYDAN"'), '{1,image_url}', '"https://x/borne.jpg"'));
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '32-122546';
  IF v_p.model_key <> 'V2CTRYDAN' OR v_p.model_key_source <> 'cle' OR v_p.image_url <> 'https://x/borne.jpg' THEN
    RAISE EXCEPTION 'clé / photo non posées sur un article relevé : % %', v_p.model_key, v_p.image_url;
  END IF;

  -- (b2) une clé posée par l'IA (source ia) survit au relevé suivant quand l'adaptateur n'en trouve toujours pas
  UPDATE majordhome.supplier_products SET model_key = 'IAKEY1', model_key_source = 'ia' WHERE supplier_id = v_sup AND reference = '37-000001';
  SET LOCAL ROLE service_role;
  PERFORM public.supplier_catalog_upsert(v_mayer, v_sup, 't3b', v_rows);
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '37-000001';
  IF v_p.model_key <> 'IAKEY1' OR v_p.model_key_source <> 'ia' THEN RAISE EXCEPTION 'clé IA effacée par le relevé : % %', v_p.model_key, v_p.model_key_source; END IF;
  -- … mais une clé trouvée par l'adaptateur remplace la clé IA
  SET LOCAL ROLE service_role;
  PERFORM public.supplier_catalog_upsert(v_mayer, v_sup, 't3c', jsonb_set(v_rows, '{2,model_key}', '"CLEADAPT"'));
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '37-000001';
  IF v_p.model_key <> 'CLEADAPT' OR v_p.model_key_source <> 'cle' THEN RAISE EXCEPTION 'clé adaptateur non prioritaire sur la clé IA'; END IF;
  -- la catégorie du relevé est mémorisée à part (specs.categorie_releve), sans toucher la catégorie courante
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '35-119503';
  IF v_p.specs->>'categorie_releve' <> 'batterie' OR v_p.category <> 'photovoltaique' THEN RAISE EXCEPTION 'categorie_releve absente ou catégorie manuelle touchée : % / %', v_p.specs->>'categorie_releve', v_p.category; END IF;

  -- (c) apply_mapping : membre refusé ; admin : E-Mobility → exclure, (sans categorie) → batterie
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer AND role <> 'org_admin' LIMIT 1;
  UPDATE majordhome.suppliers SET category_mapping = '{"E-Mobility": "exclure", "(sans categorie)": "batterie"}'::jsonb WHERE id = v_sup;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  ok := false;
  BEGIN PERFORM public.supplier_catalog_apply_mapping(v_sup); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un membre non admin a appliqué la correspondance'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.supplier_catalog_apply_mapping(v_sup);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (v_res->>'exclus')::int <> 1 OR (v_res->>'reclasses')::int <> 1 THEN RAISE EXCEPTION 'apply_mapping : %', v_res; END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '32-122546';
  IF v_p.is_active OR (v_p.specs->>'desactive_par_mapping')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'borne non exclue'; END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '37-000001';
  IF v_p.category <> 'batterie' THEN RAISE EXCEPTION 'sans catégorie non reclassé : %', v_p.category; END IF;
  -- la Powerwall (catégorie corrigée à la main, catégorie du site non surchargée) n'a pas bougé
  SELECT category INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '35-119503';
  IF v_p.category <> 'photovoltaique' THEN RAISE EXCEPTION 'article non couvert reclassé'; END IF;
  -- (c2) une correction manuelle dans un rayon SURCHARGÉ est respectée aussi (relecture I-4)
  UPDATE majordhome.suppliers SET category_mapping = '{"Battery Storage": "borne_recharge"}'::jsonb WHERE id = v_sup;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.supplier_catalog_apply_mapping(v_sup);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '35-119503';
  IF v_p.category <> 'photovoltaique' THEN RAISE EXCEPTION 'correction manuelle écrasée par la correspondance : %', v_p.category; END IF;
  -- (la borne, plus couverte par aucune surcharge, revient au défaut : réactivée — c'est le comportement v1, conservé)
  IF (v_res->>'ignores_manuels')::int <> 1 OR (v_res->>'reclasses')::int <> 0 OR (v_res->>'reactives')::int <> 1 THEN RAISE EXCEPTION 'compteurs apply_mapping (manuel) : %', v_res; END IF;
  -- un article NON corrigé du même rayon est bien reclassé, et sa categorie_releve suit
  UPDATE majordhome.supplier_products SET category = 'batterie' WHERE supplier_id = v_sup AND reference = '35-119503';
  UPDATE majordhome.supplier_products SET specs = specs || '{"categorie_releve": "batterie"}'::jsonb WHERE supplier_id = v_sup AND reference = '35-119503';
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.supplier_catalog_apply_mapping(v_sup);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '35-119503';
  IF v_p.category <> 'borne_recharge' OR v_p.specs->>'categorie_releve' <> 'borne_recharge' THEN RAISE EXCEPTION 'article non corrigé non reclassé : % / %', v_p.category, v_p.specs->>'categorie_releve'; END IF;
  UPDATE majordhome.supplier_products SET category = 'photovoltaique' WHERE supplier_id = v_sup AND reference = '35-119503';
  -- état d'avant (c2) : la borne de nouveau exclue
  UPDATE majordhome.suppliers SET category_mapping = '{"E-Mobility": "exclure", "(sans categorie)": "batterie"}'::jsonb WHERE id = v_sup;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.supplier_catalog_apply_mapping(v_sup);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (v_res->>'exclus')::int <> 1 THEN RAISE EXCEPTION 'borne non ré-exclue : %', v_res; END IF;
  -- retrait de l'exclusion ⇒ réactivée
  UPDATE majordhome.suppliers SET category_mapping = '{"E-Mobility": "borne_recharge"}'::jsonb WHERE id = v_sup;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.supplier_catalog_apply_mapping(v_sup);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '32-122546';
  IF NOT v_p.is_active OR v_p.specs ? 'desactive_par_mapping' OR (v_res->>'reactives')::int <> 1 THEN RAISE EXCEPTION 'borne non réactivée : %', v_res; END IF;

  -- (d) marques distinctes ; index unique sur les lignes relevées
  SELECT count(*) INTO v_n FROM public.get_distinct_brands(v_sup);
  IF v_n <> 3 THEN RAISE EXCEPTION 'get_distinct_brands : % marques', v_n; END IF;
  ok := false;
  BEGIN
    INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, specs) VALUES (v_sup, v_mayer, '35-119503', 'doublon', '{"source_version": "x"}'::jsonb);
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'doublon de référence relevée accepté'; END IF;

  RAISE NOTICE 'assert-catalogue-generique : OK';
END $$;
