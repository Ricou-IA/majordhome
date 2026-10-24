-- assert-catalogue-connexion.sql — vérifie 20261024_2_catalogue_connexion_fournisseur.sql (+ 20261024_5, 20261025_2 : signature à 5 paramètres, 20261025_4 : p_meta.desactiver_absents) sur le cluster de répétition.
-- Couvre : privilèges (supplier_catalog_upsert / org_secret_read = service_role seul), règles de l'upsert
-- (name et selling_price_ht à l'INSERT seulement, défaut Tesla ré-appliqué si 0, désactivation des absents,
-- relevé vide refusé, fournisseur d'une autre org refusé), colonnes de connexion dans les vues, secrets Vault
-- (org_admin écrit, membre voit l'existence sans la valeur, service_role lit).
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
    {"reference":"35-119503","name":"Tesla Powerwall 3 – batterie 13,5 kWh","brand":"Tesla","gamme":"Batterie","product_kind":"main",
     "purchase_price_ht":4773.29,"selling_price_ht_defaut":5500,"default_tva_rate":20,"unit":"pièce","category":"batterie",
     "specs":{"canonical":{"mpn":"1707000-30-L","energie_utile_kwh":13.5},"source_version":"test_1"}},
    {"reference":"37-122388","name":"Tesla Remote Meter mono","brand":"Tesla","gamme":"Compteur","product_kind":"accessory",
     "purchase_price_ht":103.67,"selling_price_ht_defaut":0,"default_tva_rate":20,"unit":"pièce","category":"batterie",
     "specs":{"canonical":{"mpn":"2083764-00-C"},"source_version":"test_1"}}
  ]'::jsonb;
BEGIN
  -- (f) privilèges
  IF has_function_privilege('anon', 'public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute supplier_catalog_upsert'; END IF;
  IF has_function_privilege('authenticated', 'public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute supplier_catalog_upsert'; END IF;
  IF NOT has_function_privilege('service_role', 'public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'service_role n''exécute pas supplier_catalog_upsert'; END IF;
  IF has_function_privilege('anon', 'public.org_secret_read(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute org_secret_read'; END IF;
  IF has_function_privilege('authenticated', 'public.org_secret_read(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated exécute org_secret_read'; END IF;
  IF NOT has_function_privilege('service_role', 'public.org_secret_read(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'service_role ne lit pas org_secret_read'; END IF;
  IF has_function_privilege('anon', 'public.org_secret_set(uuid, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute org_secret_set'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.org_secret_set(uuid, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated n''exécute pas org_secret_set'; END IF;
  IF has_function_privilege('anon', 'public.org_secret_status(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute org_secret_status'; END IF;

  -- vues : colonnes de connexion en fin
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('majordhome_suppliers', 'majordhome_suppliers_write')
     AND column_name IN ('connector', 'catalog_sync_at', 'catalog_sync_result');
  IF v_n <> 6 THEN RAISE EXCEPTION 'colonnes de connexion absentes des vues (%/6)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('majordhome_suppliers', 'majordhome_suppliers_write')
     AND c.reloptions::text LIKE '%security_invoker=true%';
  IF v_n <> 2 THEN RAISE EXCEPTION 'security_invoker perdu sur une vue fournisseurs'; END IF;

  -- fixture
  INSERT INTO majordhome.suppliers (org_id, name, connector, is_active) VALUES (v_mayer, 'TEST CATALOGUE', 'suitecommerce', true) RETURNING id INTO v_sup;

  -- (a) premier relevé : 2 insérés, libellés et prix du payload
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 'test_1', v_rows);
  RESET ROLE;
  IF (v_res->>'inseres')::int <> 2 OR (v_res->>'mis_a_jour')::int <> 0 OR (v_res->>'total')::int <> 2 THEN RAISE EXCEPTION 'premier relevé : %', v_res; END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '35-119503';
  IF v_p.name <> 'Tesla Powerwall 3 – batterie 13,5 kWh' OR v_p.selling_price_ht <> 5500 OR v_p.purchase_price_ht <> 4773.29
     OR v_p.category <> 'batterie' OR v_p.product_kind <> 'main' OR v_p.specs->'canonical'->>'mpn' <> '1707000-30-L' THEN
    RAISE EXCEPTION 'Powerwall insérée incorrectement : % % %', v_p.name, v_p.selling_price_ht, v_p.specs;
  END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '37-122388';
  IF v_p.selling_price_ht <> 0 OR v_p.product_kind <> 'accessory' THEN RAISE EXCEPTION 'Remote Meter inséré incorrectement'; END IF;

  -- (h) suivi du relevé sur le fournisseur
  SELECT * INTO v_p FROM majordhome.suppliers WHERE id = v_sup;
  IF v_p.catalog_sync_at IS NULL OR v_p.catalog_sync_result->>'total' <> '2' OR (v_p.catalog_sync_result->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'catalog_sync_* non renseignés : %', v_p.catalog_sync_result;
  END IF;

  -- (b) corrections à la main (libellé, prix de vente, clé canonical manuelle) + ré-import avec autres valeurs
  UPDATE majordhome.supplier_products SET name = 'Powerwall 3 (libellé corrigé)', selling_price_ht = 4900,
    specs = specs || jsonb_build_object('canonical', (specs->'canonical') || '{"note_interne":"garder"}'::jsonb)
  WHERE supplier_id = v_sup AND reference = '35-119503';
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 'test_2',
    jsonb_set(jsonb_set(jsonb_set(v_rows, '{0,name}', '"Tesla Powerwall 3 NOUVEAU LIBELLÉ"'), '{0,purchase_price_ht}', '4800'), '{0,specs,source_version}', '"test_2"'));
  RESET ROLE;
  IF (v_res->>'inseres')::int <> 0 OR (v_res->>'mis_a_jour')::int <> 2 OR (v_res->>'desactives')::int <> 0 THEN RAISE EXCEPTION 'second relevé : %', v_res; END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '35-119503';
  IF v_p.name <> 'Powerwall 3 (libellé corrigé)' THEN RAISE EXCEPTION 'libellé corrigé écrasé : %', v_p.name; END IF;
  IF v_p.selling_price_ht <> 4900 THEN RAISE EXCEPTION 'prix de vente saisi écrasé : %', v_p.selling_price_ht; END IF;
  IF v_p.purchase_price_ht <> 4800 THEN RAISE EXCEPTION 'prix d''achat non mis à jour : %', v_p.purchase_price_ht; END IF;
  IF v_p.specs->'canonical'->>'note_interne' <> 'garder' OR v_p.specs->'canonical'->>'mpn' <> '1707000-30-L' OR v_p.specs->>'source_version' <> 'test_2' THEN
    RAISE EXCEPTION 'fusion des specs incorrecte : %', v_p.specs;
  END IF;

  -- (c) prix de vente remis à 0 ⇒ le défaut Tesla est ré-appliqué
  UPDATE majordhome.supplier_products SET selling_price_ht = 0 WHERE supplier_id = v_sup AND reference = '35-119503';
  SET LOCAL ROLE service_role;
  PERFORM public.supplier_catalog_upsert(v_mayer, v_sup, 'test_3', v_rows);
  RESET ROLE;
  SELECT selling_price_ht INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '35-119503';
  IF v_p.selling_price_ht <> 5500 THEN RAISE EXCEPTION 'défaut Tesla non ré-appliqué : %', v_p.selling_price_ht; END IF;

  -- (d) article absent du relevé ⇒ désactivé, jamais supprimé
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 'test_4', jsonb_build_array(v_rows -> 0));
  RESET ROLE;
  IF (v_res->>'desactives')::int <> 1 OR (v_res->>'total')::int <> 1 THEN RAISE EXCEPTION 'désactivation : %', v_res; END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '37-122388';
  IF v_p.id IS NULL OR v_p.is_active THEN RAISE EXCEPTION 'article absent supprimé ou toujours actif'; END IF;
  -- … la désactivation est marquée comme venant du relevé, et l'article est réactivé s'il revient
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '37-122388';
  IF (v_p.specs->>'desactive_par_releve')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'désactivation par le relevé non marquée : %', v_p.specs; END IF;
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 'test_5', v_rows);
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '37-122388';
  IF NOT v_p.is_active OR (v_res->>'total')::int <> 2 THEN RAISE EXCEPTION 'article revenu non réactivé'; END IF;
  IF v_p.specs ? 'desactive_par_releve' THEN RAISE EXCEPTION 'marque de désactivation non effacée à la réactivation'; END IF;

  -- (d2) un article désactivé À LA MAIN (bouton Supprimer du catalogue) reste inactif au relevé suivant
  UPDATE majordhome.supplier_products SET is_active = false WHERE supplier_id = v_sup AND reference = '37-122388';
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 'test_6', v_rows);
  RESET ROLE;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '37-122388';
  IF v_p.is_active THEN RAISE EXCEPTION 'un article supprimé à la main a été ressuscité par le relevé'; END IF;
  IF v_p.purchase_price_ht <> 103.67 THEN RAISE EXCEPTION 'prix d''achat d''un article inactif non suivi'; END IF;
  IF (v_res->>'total')::int <> 1 OR (v_res->>'ignores_inactifs')::int <> 1 THEN RAISE EXCEPTION 'compteurs après suppression manuelle : %', v_res; END IF;
  -- remise en service pour la suite
  UPDATE majordhome.supplier_products SET is_active = true WHERE supplier_id = v_sup AND reference = '37-122388';

  -- (d3) relevé de FACTURES (20261025_4) : p_meta.desactiver_absents = false ⇒ un article absent reste actif
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 'test_7', jsonb_build_array(v_rows -> 0), '{"desactiver_absents": false}'::jsonb);
  RESET ROLE;
  IF (v_res->>'desactives')::int <> 0 OR (v_res->>'total')::int <> 2 OR (v_res->>'desactiver_absents')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'désactivation débrayée : %', v_res; END IF;
  SELECT * INTO v_p FROM majordhome.supplier_products WHERE supplier_id = v_sup AND reference = '37-122388';
  IF NOT v_p.is_active OR v_p.specs ? 'desactive_par_releve' THEN RAISE EXCEPTION 'article absent d''un relevé de factures désactivé'; END IF;
  -- … et le défaut (sans p_meta) désactive toujours
  SET LOCAL ROLE service_role;
  v_res := public.supplier_catalog_upsert(v_mayer, v_sup, 'test_8', jsonb_build_array(v_rows -> 0));
  RESET ROLE;
  IF (v_res->>'desactives')::int <> 1 OR (v_res->>'desactiver_absents')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'désactivation par défaut perdue : %', v_res; END IF;
  SET LOCAL ROLE service_role;
  PERFORM public.supplier_catalog_upsert(v_mayer, v_sup, 'test_9', v_rows);
  RESET ROLE;

  -- (e) relevé vide refusé ; fournisseur hors org refusé
  SET LOCAL ROLE service_role;
  ok := false;
  BEGIN PERFORM public.supplier_catalog_upsert(v_mayer, v_sup, 'x', '[]'::jsonb); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'relevé vide accepté'; END IF;
  ok := false;
  BEGIN PERFORM public.supplier_catalog_upsert(gen_random_uuid(), v_sup, 'x', v_rows); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'fournisseur d''une autre org accepté'; END IF;
  RESET ROLE;

  -- (g) secrets : membre non admin refusé, admin écrit, membre voit l'existence, service_role lit la valeur
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer AND role <> 'org_admin' LIMIT 1;
  IF v_admin IS NULL OR v_membre IS NULL THEN RAISE EXCEPTION 'fixture : membres Mayer absents du snapshot'; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  ok := false;
  BEGIN PERFORM public.org_secret_set(v_mayer, 'supplier:test:credentials', '{"email":"a","password":"b"}'); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un membre non admin a écrit un secret'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  ok := false;
  BEGIN PERFORM public.org_secret_set(v_mayer, 'supplier:test:credentials', 'x'); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un appelant anonyme a écrit un secret'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.org_secret_set(v_mayer, 'supplier:test:credentials', '{"email":"a","password":"b"}');
  PERFORM public.org_secret_set(v_mayer, 'supplier:test:credentials', '{"email":"a","password":"c"}'); -- mise à jour
  ok := false;
  BEGIN PERFORM public.org_secret_set(v_mayer, 'Clé Invalide', 'x'); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'clé invalide acceptée'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  v_res := public.org_secret_status(v_mayer, 'supplier:test:credentials');
  IF (v_res->>'exists')::boolean IS NOT TRUE OR v_res->>'updated_at' IS NULL OR v_res ? 'value' THEN RAISE EXCEPTION 'statut secret : %', v_res; END IF;
  v_res := public.org_secret_status(v_mayer, 'supplier:absent');
  IF (v_res->>'exists')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'secret absent annoncé présent'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SET LOCAL ROLE service_role;
  IF public.org_secret_read(v_mayer, 'supplier:test:credentials') <> '{"email":"a","password":"c"}' THEN RAISE EXCEPTION 'valeur lue incorrecte (mise à jour non prise)'; END IF;
  IF public.org_secret_read(v_mayer, 'supplier:absent') IS NOT NULL THEN RAISE EXCEPTION 'secret absent lu non NULL'; END IF;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM vault.secrets WHERE name = 'org:' || v_mayer::text || ':supplier:test:credentials';
  IF v_n <> 1 THEN RAISE EXCEPTION 'secret dupliqué ou absent du Vault (%)', v_n; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.org_secret_delete(v_mayer, 'supplier:test:credentials');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO v_n FROM vault.secrets WHERE name = 'org:' || v_mayer::text || ':supplier:test:credentials';
  IF v_n <> 0 THEN RAISE EXCEPTION 'secret non supprimé'; END IF;

  RAISE NOTICE 'assert-catalogue-connexion : OK';
END $$;
