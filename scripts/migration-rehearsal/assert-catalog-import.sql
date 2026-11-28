-- assert-catalog-import.sql — vérifie 20261129_2 (import d'une base d'articles depuis un fichier) sur le cluster de
-- répétition. Autonome : crée ses fournisseurs, ses imports et ses articles dans Mayer (A), vérifie l'étanchéité avec
-- Cimaj (B). Chaque écart lève une exception. Membres relevés dans le snapshot du 2026-11-22 :
--   A = Mayer 3c68193e… : org_admin 8a4907a3…, team_leader 6c3a9488…
--   B = Cimaj 62cd2073… : org_admin 8ebd6637…, team_leader fe6e3954…
-- Chaîne à rejouer (ACL par objet et colonne `recherche` non photographiées) :
--   20261028_4 (UPDATE par colonne de catalog_items) → 20261124_2 (recherche rangée, déclencheurs) → 20261129_2.
-- Se mettre à la place d'un membre : request.jwt.claim.sub (stub auth.uid() du harnais) + request.jwt.claims
-- (forme de la prod) puis SET LOCAL ROLE authenticated.

-- Aide de test : exécute une instruction et exige qu'elle échoue avec ce message (et ce SQLSTATE, ce DETAIL s'ils
-- sont donnés). SECURITY INVOKER : l'instruction s'exécute avec le rôle courant.
CREATE OR REPLACE FUNCTION public.zz_assert_erreur(p_sql text, p_message text, p_etat text DEFAULT NULL, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_passe boolean := false; v_msg text; v_etat text; v_detail text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_passe := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_etat = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
  END;
  IF v_passe THEN RAISE EXCEPTION 'aurait dû échouer (%) : %', p_message, p_sql; END IF;
  IF v_msg IS DISTINCT FROM p_message THEN RAISE EXCEPTION 'attendu « % », reçu « % » [%] (%) : %', p_message, v_msg, v_etat, v_detail, p_sql; END IF;
  IF p_etat IS NOT NULL AND v_etat IS DISTINCT FROM p_etat THEN RAISE EXCEPTION 'SQLSTATE attendu %, reçu % : %', p_etat, v_etat, p_sql; END IF;
  IF p_detail IS NOT NULL AND v_detail IS DISTINCT FROM p_detail THEN RAISE EXCEPTION 'DETAIL attendu « % », reçu « % » : %', p_detail, v_detail, p_sql; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.zz_assert_erreur(text, text, text, text) TO authenticated, anon;

-- Identité de test
CREATE OR REPLACE FUNCTION public.zz_identite(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
END $$;
GRANT EXECUTE ON FUNCTION public.zz_identite(uuid) TO authenticated, anon;

-- ── 1. Structure et droits ────────────────────────────────────────────────────
DO $$
DECLARE f text; c text; n int;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.catalog_items_import_start(uuid, text, jsonb, jsonb, jsonb)',
    'public.catalog_items_import_batch(uuid, jsonb)',
    'public.catalog_items_import_finish(uuid, jsonb)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par anon', f; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '% exécutable par PUBLIC', f;
    END IF;
    IF has_function_privilege('authenticated', f, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION '% non exécutable par authenticated', f; END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '% doit être SECURITY DEFINER', f; END IF;
    IF (SELECT 'search_path=majordhome, public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE oid = f::regprocedure) IS NOT TRUE THEN
      RAISE EXCEPTION '% : search_path « majordhome, public, pg_temp » attendu', f;
    END IF;
  END LOOP;
  -- Fonctions internes de la migration : ni anon ni authenticated
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'majordhome' AND p.proname LIKE 'catalog\_import\_%';
  IF n < 2 THEN RAISE EXCEPTION 'fonctions internes catalog_import_* attendues (% trouvée(s))', n; END IF;
  IF to_regprocedure('majordhome.catalog_import_org_admin(uuid)') IS NULL THEN RAISE EXCEPTION 'garde majordhome.catalog_import_org_admin(uuid) absente'; END IF;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'majordhome' AND p.proname LIKE 'catalog\_import\_%' LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION 'interne % exécutable par anon', f; END IF;
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION 'interne % exécutable par authenticated', f; END IF;
  END LOOP;
  -- L'écrivain unique reste service_role seul
  f := 'public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb)';
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '% ouverte à anon / authenticated', f; END IF;
  IF has_function_privilege('service_role', f, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION '% non exécutable par service_role', f; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par PUBLIC', f; END IF;

  -- Vue et table des imports
  IF (SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.majordhome_catalog_imports'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'majordhome_catalog_imports sans security_invoker=true';
  END IF;
  FOREACH c IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.majordhome_catalog_imports', c) THEN RAISE EXCEPTION 'majordhome_catalog_imports : anon a %', c; END IF;
    IF has_table_privilege('anon', 'majordhome.catalog_imports', c) THEN RAISE EXCEPTION 'catalog_imports : anon a %', c; END IF;
  END LOOP;
  FOREACH c IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
    IF has_table_privilege('authenticated', 'public.majordhome_catalog_imports', c) OR has_table_privilege('authenticated', 'majordhome.catalog_imports', c) THEN
      RAISE EXCEPTION 'catalog_imports : authenticated a % (seules les RPC écrivent)', c;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.majordhome_catalog_imports', 'SELECT') IS NOT TRUE THEN RAISE EXCEPTION 'majordhome_catalog_imports illisible par authenticated'; END IF;
  IF has_table_privilege('service_role', 'majordhome.catalog_imports', 'SELECT') IS NOT TRUE THEN RAISE EXCEPTION 'catalog_imports illisible par service_role'; END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.catalog_imports'::regclass) IS NOT TRUE THEN RAISE EXCEPTION 'catalog_imports sans RLS'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'catalog_imports';
  IF n <> 1 OR (SELECT cmd FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'catalog_imports' LIMIT 1) <> 'SELECT' THEN
    RAISE EXCEPTION 'catalog_imports : une seule policy, en lecture, attendue (% trouvée(s))', n;
  END IF;
  IF (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'majordhome_catalog_imports')
     IS DISTINCT FROM 'id,org_id,created_by,created_by_name,created_at,file_name,counts,status,removed_at' THEN
    RAISE EXCEPTION 'majordhome_catalog_imports : colonnes inattendues';
  END IF;

  -- catalog_items : nouvelles colonnes, index unique de rejeu, droits par colonne intacts
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'majordhome' AND tablename = 'catalog_items' AND indexname = 'catalog_items_import_line_key'
                  AND indexdef LIKE 'CREATE UNIQUE INDEX%(import_id, import_line)%WHERE (import_id IS NOT NULL)%') THEN
    RAISE EXCEPTION 'index unique partiel catalog_items_import_line_key absent';
  END IF;
  FOREACH c IN ARRAY ARRAY['model_key', 'code_ean', 'origin', 'import_id', 'import_line', 'org_id', 'merged_into'] LOOP
    IF has_column_privilege('authenticated', 'majordhome.catalog_items', c, 'UPDATE') THEN RAISE EXCEPTION 'authenticated peut modifier catalog_items.%', c; END IF;
  END LOOP;
  IF has_column_privilege('authenticated', 'majordhome.catalog_items', 'name', 'UPDATE') IS NOT TRUE THEN RAISE EXCEPTION 'droit UPDATE (name) perdu sur catalog_items'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_catalog_items' AND column_name IN ('import_id', 'import_line')) THEN
    RAISE EXCEPTION 'la vue majordhome_catalog_items ne doit pas être modifiée';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'supplier_products_catalog_item_link_source_check') NOT LIKE '%''import''%' THEN
    RAISE EXCEPTION 'link_source : valeur import absente du CHECK';
  END IF;
  RAISE NOTICE '§1 structure et droits : OK';
END $$;

-- ── Index de production (le snapshot ne photographie aucun index non-PK) ──────
-- Définitions lues en prod le 2026-11-28 (pg_indexes) : sans elles, la mesure compte des parcours complets de
-- 27 000 articles et 31 000 lignes que la prod ne fait pas, et l'unicité des codes / des lignes relevées n'est pas tenue.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_items_code_org_unique ON majordhome.catalog_items USING btree (org_id, lower(code)) WHERE ((code IS NOT NULL) AND (merged_into IS NULL));
CREATE INDEX IF NOT EXISTS catalog_items_org_key_idx ON majordhome.catalog_items USING btree (org_id, lower(brand), model_key) WHERE (model_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS catalog_items_org_ean_idx ON majordhome.catalog_items USING btree (org_id, code_ean) WHERE (code_ean IS NOT NULL);
CREATE INDEX IF NOT EXISTS catalog_items_org_active_idx ON majordhome.catalog_items USING btree (org_id, is_active);
CREATE INDEX IF NOT EXISTS supplier_products_catalog_item_idx ON majordhome.supplier_products USING btree (catalog_item_id) WHERE (catalog_item_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS supplier_products_supplier_reference_idx ON majordhome.supplier_products USING btree (supplier_id, reference);
CREATE INDEX IF NOT EXISTS supplier_products_model_key_idx ON majordhome.supplier_products USING btree (org_id, lower(brand), model_key) WHERE (model_key IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_releve_reference_uniq ON majordhome.supplier_products USING btree (supplier_id, reference) WHERE ((reference IS NOT NULL) AND (specs ? 'source_version'::text));
CREATE INDEX IF NOT EXISTS idx_supplier_products_kind ON majordhome.supplier_products USING btree (supplier_id, product_kind) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_supplier_products_specs ON majordhome.supplier_products USING gin (specs);

-- ── Données de test (postgres) ───────────────────────────────────────────────
DO $$
DECLARE
  v_a uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_b uuid := '62cd2073-96e0-4300-adae-4c1bb8934546';
  v_sa uuid; v_sb uuid; v_item uuid; v_ib uuid;
BEGIN
  -- Son dernier relevé a échoué : un lot d'import ne doit pas effacer l'erreur (revue finale)
  INSERT INTO majordhome.suppliers (org_id, name, is_active, catalog_sync_error)
  VALUES (v_a, 'ZZ FOURNISSEUR EXISTANT', true, '{"ok": false, "code": "test"}'::jsonb) RETURNING id INTO v_sa;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_b, 'ZZ FOURNISSEUR DE B', true) RETURNING id INTO v_sb;
  INSERT INTO majordhome.catalog_items (org_id, name, code, origin) VALUES (v_a, 'Article qui a déjà le code', 'CODE-PRIS', 'manuel') RETURNING id INTO v_item;
  INSERT INTO majordhome.catalog_items (org_id, name, origin) VALUES (v_b, 'Article de B', 'manuel') RETURNING id INTO v_ib;
  -- Ligne existante, INACTIVE et sans article : ne doit jamais bouger
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht, purchase_price_at, is_active, specs)
  VALUES (v_sa, v_a, 'EXIST-1', 'Ligne existante', 50, '2026-01-01T00:00:00Z', false, '{"source_version": "releve-ancien"}');
  PERFORM set_config('test.sa', v_sa::text, false);
  PERFORM set_config('test.sb', v_sb::text, false);
  PERFORM set_config('test.ib', v_ib::text, false);
  PERFORM set_config('test.nb_articles_a', (SELECT count(*) FROM majordhome.catalog_items WHERE org_id = v_a)::text, false);
END $$;

-- ── 2. Ouverture et lot de 4 (org_admin de A) ─────────────────────────────────
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_b     uuid := '62cd2073-96e0-4300-adae-4c1bb8934546';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_sa    uuid := current_setting('test.sa')::uuid;
  v_snew  uuid;
  v_imp   uuid;
  r jsonb; n int; a record; l record; i1 uuid; i2 uuid;
BEGIN
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_start(v_a, '  articles-ancien-logiciel.xlsx ', '{"colonnes": []}'::jsonb, '{"lues": 4}'::jsonb,
         jsonb_build_array(jsonb_build_object('nom', 'ZZ FOURNISSEUR EXISTANT', 'supplier_id', v_sa),
                           jsonb_build_object('nom', 'ZZ Nouveau Fournisseur', 'supplier_id', NULL)));
  v_imp := (r ->> 'import_id')::uuid;
  IF v_imp IS NULL THEN RAISE EXCEPTION 'start sans import_id : %', r; END IF;
  IF jsonb_array_length(r -> 'fournisseurs') <> 2 THEN RAISE EXCEPTION 'start : 2 fournisseurs attendus : %', r; END IF;
  IF (r -> 'fournisseurs' -> 0 ->> 'supplier_id')::uuid IS DISTINCT FROM v_sa OR (r -> 'fournisseurs' -> 0 ->> 'cree')::boolean IS DISTINCT FROM false
     OR r -> 'fournisseurs' -> 0 ->> 'nom' IS DISTINCT FROM 'ZZ FOURNISSEUR EXISTANT' THEN
    RAISE EXCEPTION 'start : fournisseur existant mal rendu : %', r;
  END IF;
  v_snew := (r -> 'fournisseurs' -> 1 ->> 'supplier_id')::uuid;
  IF v_snew IS NULL OR (r -> 'fournisseurs' -> 1 ->> 'cree')::boolean IS DISTINCT FROM true OR r -> 'fournisseurs' -> 1 ->> 'nom' IS DISTINCT FROM 'ZZ Nouveau Fournisseur' THEN
    RAISE EXCEPTION 'start : fournisseur à créer mal rendu : %', r;
  END IF;
  PERFORM set_config('test.imp_a', v_imp::text, false);
  PERFORM set_config('test.snew', v_snew::text, false);

  r := public.catalog_items_import_batch(v_imp, jsonb_build_array(
    jsonb_build_object('import_line', 2, 'name', 'Poêle Alpha 8 kW', 'code', 'ALPHA-1', 'brand', 'INVICTA', 'model_key', 'alpha8',
      'modele_brut', 'Alpha 8kW', 'code_ean', '3700000000011', 'category', 'poele', 'gamme', 'Gamme G', 'product_kind', 'main',
      'unit', 'pièce', 'default_tva_rate', 10, 'selling_price_ht', 2500, 'description', 'Poêle à bois', 'ancien_numero', 'OLD-1',
      'org_id', v_b, 'origin', 'auto', 'import_id', gen_random_uuid(),
      'fournisseur', jsonb_build_object('supplier_id', v_sa, 'reference', 'REF-A1', 'purchase_price_ht', 1500.5,
        'tarif_public', 2400, 'purchase_price_at', '2026-03-15')),
    jsonb_build_object('import_line', 3, 'name', 'Kit raccordement', 'code', NULL, 'brand', NULL, 'model_key', NULL, 'modele_brut', NULL,
      'code_ean', NULL, 'category', NULL, 'gamme', NULL, 'product_kind', 'accessory', 'unit', 'm', 'default_tva_rate', 20,
      'selling_price_ht', 30, 'description', NULL, 'ancien_numero', NULL,
      'fournisseur', jsonb_build_object('supplier_id', v_snew, 'reference', 'REF-N1', 'purchase_price_ht', 12,
        'tarif_public', NULL, 'purchase_price_at', NULL)),
    jsonb_build_object('import_line', 4, 'name', 'Pose d''un poêle', 'product_kind', 'main_oeuvre', 'default_tva_rate', 10,
      'selling_price_ht', 400, 'fournisseur', NULL),
    jsonb_build_object('import_line', 5, 'name', 'Granulés (stock)', 'code', 'stk-1', 'product_kind', 'stock', 'unit', NULL,
      'default_tva_rate', 5.5, 'selling_price_ht', 0)));
  IF r IS DISTINCT FROM '{"created": 4, "skipped": 0, "lignes_fournisseur": 2}'::jsonb THEN RAISE EXCEPTION 'batch : % (created 4, skipped 0, lignes_fournisseur 2 attendus)', r; END IF;

  SET LOCAL ROLE postgres;
  -- Fournisseur créé dans A, noté sur l'import
  IF NOT EXISTS (SELECT 1 FROM majordhome.suppliers WHERE id = v_snew AND org_id = v_a AND name = 'ZZ Nouveau Fournisseur' AND is_active) THEN
    RAISE EXCEPTION 'fournisseur créé hors de A ou mal nommé';
  END IF;
  IF (SELECT fournisseurs_crees FROM majordhome.catalog_imports WHERE id = v_imp) IS DISTINCT FROM ARRAY[v_snew] THEN
    RAISE EXCEPTION 'fournisseurs_crees = %', (SELECT fournisseurs_crees FROM majordhome.catalog_imports WHERE id = v_imp);
  END IF;
  IF (SELECT file_name = 'articles-ancien-logiciel.xlsx' AND created_by = v_admin AND org_id = v_a AND status = 'en_cours'
             AND counts = '{"lues": 4}'::jsonb AND mapping = '{"colonnes": []}'::jsonb
        FROM majordhome.catalog_imports WHERE id = v_imp) IS NOT TRUE THEN
    RAISE EXCEPTION 'ligne d''import mal écrite : %', (SELECT row_to_json(i) FROM majordhome.catalog_imports i WHERE id = v_imp);
  END IF;

  -- 4 articles, tous dans A, origine manuel
  SELECT count(*) INTO n FROM majordhome.catalog_items WHERE import_id = v_imp;
  IF n <> 4 THEN RAISE EXCEPTION '4 articles attendus, %', n; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE import_id = v_imp AND (org_id <> v_a OR origin <> 'manuel' OR source_product_id IS NOT NULL OR merged_into IS NOT NULL OR NOT is_active)) THEN
    RAISE EXCEPTION 'article hors de A, origine ≠ manuel ou clés de la ligne lues';
  END IF;
  SELECT * INTO a FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 2;
  i1 := a.id;
  IF a.name <> 'Poêle Alpha 8 kW' OR a.code <> 'ALPHA-1' OR a.brand <> 'INVICTA' OR a.model_key <> 'alpha8' OR a.code_ean <> '3700000000011'
     OR a.category <> 'poele' OR a.gamme <> 'Gamme G' OR a.product_kind <> 'main' OR a.unit <> 'pièce' OR a.default_tva_rate <> 10
     OR a.selling_price_ht <> 2500 OR a.description <> 'Poêle à bois'
     OR a.specs IS DISTINCT FROM '{"canonical": {"modele_import": "Alpha 8kW", "ancien_numero": "OLD-1"}}'::jsonb THEN
    RAISE EXCEPTION 'ligne 2 mal écrite : %', row_to_json(a);
  END IF;
  SELECT * INTO a FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 3;
  i2 := a.id;
  IF a.name <> 'Kit raccordement' OR a.code IS NOT NULL OR a.brand IS NOT NULL OR a.model_key IS NOT NULL OR a.code_ean IS NOT NULL
     OR a.product_kind <> 'accessory' OR a.unit <> 'm' OR a.default_tva_rate <> 20 OR a.selling_price_ht <> 30
     OR a.specs IS DISTINCT FROM '{"canonical": {}}'::jsonb THEN
    RAISE EXCEPTION 'ligne 3 mal écrite : %', row_to_json(a);
  END IF;
  SELECT * INTO a FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 4;
  IF a.product_kind <> 'main_oeuvre' OR a.unit <> 'pièce' OR a.selling_price_ht <> 400 THEN RAISE EXCEPTION 'ligne 4 mal écrite : %', row_to_json(a); END IF;
  SELECT * INTO a FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 5;
  IF a.product_kind <> 'stock' OR a.code <> 'stk-1' OR a.default_tva_rate <> 5.5 OR a.unit <> 'pièce' THEN RAISE EXCEPTION 'ligne 5 mal écrite : %', row_to_json(a); END IF;

  -- 2 lignes fournisseur rattachées à LEUR article
  SELECT * INTO l FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'REF-A1';
  IF l.id IS NULL OR l.catalog_item_id IS DISTINCT FROM i1 OR l.catalog_item_link_source IS DISTINCT FROM 'import' OR l.catalog_item_linked_at IS NULL
     OR l.specs ->> 'source_version' IS DISTINCT FROM 'import-articles_' || v_imp OR NOT l.is_active OR l.org_id <> v_a
     OR l.purchase_price_ht <> 1500.5 OR l.tarif_public <> 2400 OR l.purchase_price_at IS DISTINCT FROM '2026-03-15T00:00:00Z'::timestamptz
     OR l.selling_price_ht <> 2500 OR l.default_tva_rate <> 10 OR l.name <> 'Poêle Alpha 8 kW' OR l.brand <> 'INVICTA' OR l.model_key <> 'alpha8' THEN
    RAISE EXCEPTION 'ligne fournisseur REF-A1 : %', row_to_json(l);
  END IF;
  SELECT * INTO l FROM majordhome.supplier_products WHERE supplier_id = v_snew AND reference = 'REF-N1';
  IF l.id IS NULL OR l.catalog_item_id IS DISTINCT FROM i2 OR l.catalog_item_link_source IS DISTINCT FROM 'import'
     OR l.specs ->> 'source_version' IS DISTINCT FROM 'import-articles_' || v_imp OR NOT l.is_active OR l.org_id <> v_a
     OR l.purchase_price_at IS NOT NULL OR l.purchase_price_ht <> 12 OR l.product_kind <> 'accessory' OR l.unit <> 'm' THEN
    RAISE EXCEPTION 'ligne fournisseur REF-N1 (sans date ⇒ NULL) : %', row_to_json(l);
  END IF;
  -- Aucun autre article créé : catalog_items_ensure n'a pas vu ces lignes
  SELECT count(*) INTO n FROM majordhome.catalog_items WHERE org_id = v_a;
  IF n <> current_setting('test.nb_articles_a')::int + 4 THEN RAISE EXCEPTION 'articles de A : % au lieu de % + 4 (ensure a doublé ?)', n, current_setting('test.nb_articles_a'); END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE source_product_id IN (SELECT id FROM majordhome.supplier_products WHERE specs ->> 'source_version' = 'import-articles_' || v_imp)) THEN
    RAISE EXCEPTION 'un article a été créé par ensure depuis une ligne de l''import';
  END IF;
  -- Erreur du dernier relevé du fournisseur conservée par le lot (catalog_sync_result, lui, est remplacé)
  IF (SELECT catalog_sync_error FROM majordhome.suppliers WHERE id = v_sa) IS DISTINCT FROM '{"ok": false, "code": "test"}'::jsonb THEN
    RAISE EXCEPTION 'le lot d''import a effacé l''erreur de relevé du fournisseur : %', (SELECT catalog_sync_error FROM majordhome.suppliers WHERE id = v_sa);
  END IF;
  IF (SELECT catalog_sync_result ->> 'version' FROM majordhome.suppliers WHERE id = v_sa) IS DISTINCT FROM 'import-articles_' || v_imp THEN
    RAISE EXCEPTION 'catalog_sync_result du fournisseur non écrit par le lot';
  END IF;
  -- Ligne existante intacte
  IF (SELECT purchase_price_ht = 50 AND purchase_price_at = '2026-01-01T00:00:00Z' AND NOT is_active AND catalog_item_id IS NULL
        FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'EXIST-1') IS NOT TRUE THEN
    RAISE EXCEPTION 'la ligne fournisseur existante a bougé';
  END IF;
  RAISE NOTICE '§2 ouverture et lot de 4 : OK';
END $$;

-- ── 3. Lot renvoyé ; nature non admise sur une ligne fournisseur ─────────────
DO $$
DECLARE
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_sa    uuid := current_setting('test.sa')::uuid;
  v_snew  uuid := current_setting('test.snew')::uuid;
  v_imp   uuid := current_setting('test.imp_a')::uuid;
  v_nb_a int; v_nb_l int; r jsonb;
BEGIN
  SELECT count(*) INTO v_nb_a FROM majordhome.catalog_items WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  SELECT count(*) INTO v_nb_l FROM majordhome.supplier_products WHERE supplier_id IN (v_sa, v_snew);
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_batch(v_imp, jsonb_build_array(
    jsonb_build_object('import_line', 2, 'name', 'Poêle Alpha 8 kW', 'code', 'ALPHA-1', 'product_kind', 'main', 'default_tva_rate', 10, 'selling_price_ht', 2500,
      'fournisseur', jsonb_build_object('supplier_id', v_sa, 'reference', 'REF-A1', 'purchase_price_ht', 1500.5, 'purchase_price_at', '2026-03-15')),
    jsonb_build_object('import_line', 3, 'name', 'Kit raccordement', 'product_kind', 'accessory', 'default_tva_rate', 20, 'selling_price_ht', 30,
      'fournisseur', jsonb_build_object('supplier_id', v_snew, 'reference', 'REF-N1', 'purchase_price_ht', 12)),
    jsonb_build_object('import_line', 4, 'name', 'Pose d''un poêle', 'product_kind', 'main_oeuvre', 'default_tva_rate', 10, 'selling_price_ht', 400),
    jsonb_build_object('import_line', 5, 'name', 'Granulés (stock)', 'code', 'stk-1', 'product_kind', 'stock', 'default_tva_rate', 5.5, 'selling_price_ht', 0)));
  IF r IS DISTINCT FROM '{"created": 0, "skipped": 4, "lignes_fournisseur": 0}'::jsonb THEN RAISE EXCEPTION 'lot renvoyé : %', r; END IF;
  SET LOCAL ROLE postgres;
  IF (SELECT count(*) FROM majordhome.catalog_items WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1') <> v_nb_a THEN RAISE EXCEPTION 'lot renvoyé : articles recréés'; END IF;
  IF (SELECT count(*) FROM majordhome.supplier_products WHERE supplier_id IN (v_sa, v_snew)) <> v_nb_l THEN RAISE EXCEPTION 'lot renvoyé : lignes fournisseur recréées'; END IF;

  -- Article de nature « stock » ou « main d'œuvre » avec fournisseur : la ligne fournisseur prend la nature « main »
  -- (le CHECK de supplier_products ne connaît que main / accessory / consumable), l'article garde la sienne.
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_batch(v_imp, jsonb_build_array(
    jsonb_build_object('import_line', 20, 'name', 'Granulés sac 15 kg', 'product_kind', 'stock', 'default_tva_rate', 10, 'selling_price_ht', 6,
      'fournisseur', jsonb_build_object('supplier_id', v_sa, 'reference', 'REF-STK', 'purchase_price_ht', 4.2))));
  IF r IS DISTINCT FROM '{"created": 1, "skipped": 0, "lignes_fournisseur": 1}'::jsonb THEN RAISE EXCEPTION 'lot stock : %', r; END IF;
  SET LOCAL ROLE postgres;
  IF (SELECT p.product_kind = 'main' AND i.product_kind = 'stock' AND p.catalog_item_link_source = 'import'
        FROM majordhome.supplier_products p JOIN majordhome.catalog_items i ON i.id = p.catalog_item_id
       WHERE p.supplier_id = v_sa AND p.reference = 'REF-STK' AND i.import_id = v_imp AND i.import_line = 20) IS NOT TRUE THEN
    RAISE EXCEPTION 'ligne stock : nature ou rattachement faux';
  END IF;
  RAISE NOTICE '§3 lot renvoyé, nature stock : OK';
END $$;

-- ── 4. Refus d'un lot : rien n'est écrit ─────────────────────────────────────
DO $$
DECLARE
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_sa    uuid := current_setting('test.sa')::uuid;
  v_sb    uuid := current_setting('test.sb')::uuid;
  v_imp   uuid := current_setting('test.imp_a')::uuid;
  v_ok    text := '{"import_line": 9, "name": "Article valable", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 10}';
  v_nb int; v_nb_l int;
  q text := $q$SELECT public.catalog_items_import_batch(%L, %L::jsonb)$q$;
BEGIN
  SELECT count(*) INTO v_nb FROM majordhome.catalog_items WHERE import_id = v_imp;
  SELECT count(*) INTO v_nb_l FROM majordhome.supplier_products;
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  -- Contenu d'une ligne (même règles que verifierLigneArticle de src/lib/importArticles/lots.js)
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[' || v_ok || ', {"import_line": 10, "name": "Ouvrage", "product_kind": "ouvrage", "default_tva_rate": 20, "selling_price_ht": 1}]'),
    'row_invalid', '22023', 'ligne 10 : product_kind');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "   ", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1}]'), 'row_invalid', '22023', 'ligne 10 : name');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1}]'), 'row_invalid', '22023', 'ligne 10 : name');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "default_tva_rate": 20, "selling_price_ht": 1}]'), 'row_invalid', '22023', 'ligne 10 : product_kind');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 7, "selling_price_ht": 1}]'), 'row_invalid', '22023', 'ligne 10 : default_tva_rate');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": "20", "selling_price_ht": 1}]'), 'row_invalid', '22023', 'ligne 10 : default_tva_rate');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20}]'), 'row_invalid', '22023', 'ligne 10 : selling_price_ht');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": -1}]'), 'row_invalid', '22023', 'ligne 10 : selling_price_ht');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "code_ean": "12AB"}]'), 'row_invalid', '22023', 'ligne 10 : code_ean');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "code_ean": 3700000000011}]'), 'row_invalid', '22023', 'ligne 10 : code_ean');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": "ZZ"}]'), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  PERFORM public.zz_assert_erreur(format(q, v_imp, format('[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "R", "purchase_price_ht": 0}}]', v_sa)), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  PERFORM public.zz_assert_erreur(format(q, v_imp, format('[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "  ", "purchase_price_ht": 3}}]', v_sa)), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "pas-un-uuid", "reference": "R", "purchase_price_ht": 3}}]'), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  PERFORM public.zz_assert_erreur(format(q, v_imp, format('[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "R", "purchase_price_ht": 3, "purchase_price_at": "15/03/2026"}}]', v_sa)), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  PERFORM public.zz_assert_erreur(format(q, v_imp, format('[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "R", "purchase_price_ht": 3, "purchase_price_at": "2026-02-30"}}]', v_sa)), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  -- Revue 1 : bornes et types alignés sur lots.js
  PERFORM public.zz_assert_erreur(format(q, v_imp, format('[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "R", "purchase_price_ht": 0.004}}]', v_sa)), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  PERFORM public.zz_assert_erreur(format(q, v_imp, format('[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "R", "purchase_price_ht": 100000000}}]', v_sa)), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  PERFORM public.zz_assert_erreur(format(q, v_imp, format('[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "R", "purchase_price_ht": 3, "tarif_public": "12"}}]', v_sa)), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  PERFORM public.zz_assert_erreur(format(q, v_imp, format('[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "R", "purchase_price_ht": 3, "tarif_public": 100000000}}]', v_sa)), 'row_invalid', '22023', 'ligne 10 : fournisseur');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 100000000}]'), 'row_invalid', '22023', 'ligne 10 : selling_price_ht');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "brand": {"a": 1}}]'), 'row_invalid', '22023', 'ligne 10 : brand');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "code": true}]'), 'row_invalid', '22023', 'ligne 10 : code');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "ancien_numero": ["x"]}]'), 'row_invalid', '22023', 'ligne 10 : ancien_numero');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 1000000000, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1}]'), 'row_invalid', '22023');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": "10", "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1}]'), 'row_invalid', '22023');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 0, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1}]'), 'row_invalid', '22023');
  -- Forme du lot
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[' || v_ok || ', ' || v_ok || ']'), 'rows_invalid', '22023');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[]'), 'rows_invalid', '22023');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '{"a": 1}'), 'rows_invalid', '22023');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[' || v_ok || ', 3]'), 'rows_invalid', '22023');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_batch(%L, (SELECT jsonb_agg(jsonb_build_object('import_line', g, 'name', 'X', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 0)) FROM generate_series(1000, 1500) g))$q$, v_imp), 'rows_invalid', '22023');
  PERFORM public.zz_assert_erreur(format(q, v_imp, format('[{"import_line": 10, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%1$s", "reference": "DOUBLE", "purchase_price_ht": 3}}, {"import_line": 11, "name": "Y", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%1$s", "reference": "DOUBLE", "purchase_price_ht": 4}}]', v_sa)), 'rows_invalid', '22023');
  -- Référence interne déjà prise (casse différente), y compris par une ligne du même lot
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[' || v_ok || ', {"import_line": 11, "name": "X", "code": "code-pris", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1}]'), 'code_pris', '23505', 'ligne 11');
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[{"import_line": 11, "name": "X", "code": "NOUVEAU-1", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1}, {"import_line": 12, "name": "Y", "code": "nouveau-1", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1}]'), 'code_pris', '23505', 'ligne 12');
  -- Ligne fournisseur qui existe déjà (inactive ici) : jamais envoyée à l'écrivain
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[' || v_ok || format(', {"import_line": 12, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "EXIST-1", "purchase_price_ht": 999, "purchase_price_at": "2026-11-01"}}]', v_sa)),
    'ligne_fournisseur_existante', '23505', 'ligne 12');
  -- Fournisseur d'une autre organisation
  PERFORM public.zz_assert_erreur(format(q, v_imp, '[' || v_ok || format(', {"import_line": 13, "name": "X", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 1, "fournisseur": {"supplier_id": "%s", "reference": "INTRUS", "purchase_price_ht": 3}}]', v_sb)),
    'supplier_not_in_org', '42501', 'ligne 13');
  PERFORM public.zz_assert_erreur(format(q, gen_random_uuid(), '[' || v_ok || ']'), 'import_not_found', 'P0002');

  SET LOCAL ROLE postgres;
  IF (SELECT count(*) FROM majordhome.catalog_items WHERE import_id = v_imp) <> v_nb THEN RAISE EXCEPTION 'un lot refusé a écrit des articles'; END IF;
  IF (SELECT count(*) FROM majordhome.supplier_products) <> v_nb_l THEN RAISE EXCEPTION 'un lot refusé a écrit des lignes fournisseur'; END IF;
  IF (SELECT purchase_price_ht = 50 AND purchase_price_at = '2026-01-01T00:00:00Z' AND NOT is_active AND catalog_item_id IS NULL
             AND specs ->> 'source_version' = 'releve-ancien'
        FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'EXIST-1') IS NOT TRUE THEN
    RAISE EXCEPTION 'la ligne fournisseur existante a bougé (prix, date, état)';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE supplier_id = v_sb) THEN RAISE EXCEPTION 'ligne écrite chez le fournisseur de B'; END IF;
  RAISE NOTICE '§4 refus d''un lot : OK';
END $$;

-- ── 5. Refus d'accès ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_a       uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_a_tl    uuid := '6c3a9488-92ee-42cc-b010-6646ca299139';
  v_admin   uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_b_admin uuid := '8ebd6637-489e-473e-9583-807ab1e3154e';
  v_imp     uuid := current_setting('test.imp_a')::uuid;
  v_sb      uuid := current_setting('test.sb')::uuid;
  v_lot     text := '[{"import_line": 30, "name": "INTRUS", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 0}]';
  u uuid; n_imp int; n_sup int;
BEGIN
  SELECT count(*) INTO n_imp FROM majordhome.catalog_imports;
  SELECT count(*) INTO n_sup FROM majordhome.suppliers;
  SET LOCAL ROLE authenticated;
  FOREACH u IN ARRAY ARRAY[v_a_tl, v_b_admin] LOOP
    PERFORM public.zz_identite(u);
    PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_start(%L, 'f.csv', '{}', '{}', '[{"nom": "INTRUS SA", "supplier_id": null}]')$q$, v_a), 'org_admin_required', '42501');
    PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_batch(%L, %L::jsonb)$q$, v_imp, v_lot), 'org_admin_required', '42501');
    PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_finish(%L, '{}')$q$, v_imp), 'org_admin_required', '42501');
  END LOOP;
  -- Sans identité
  PERFORM public.zz_identite(NULL);
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_start(%L, 'f.csv', '{}', '{}', '[]')$q$, v_a), 'unauthenticated', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_batch(%L, %L::jsonb)$q$, v_imp, v_lot), 'unauthenticated', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_finish(%L, '{}')$q$, v_imp), 'unauthenticated', '42501');
  -- org_admin de A, fournisseur de B à l'ouverture
  PERFORM public.zz_identite(v_admin);
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_start(%L, 'f.csv', '{}', '{}', %L::jsonb)$q$, v_a,
    jsonb_build_array(jsonb_build_object('nom', 'ZZ FOURNISSEUR DE B', 'supplier_id', v_sb))), 'supplier_not_in_org', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_start(%L, '   ', '{}', '{}', '[]')$q$, v_a), 'file_name_required', '22023');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_start(%L, 'f.csv', '{}', '{}', '[{"nom": "  ", "supplier_id": null}]')$q$, v_a), 'rows_invalid', '22023');
  SET LOCAL ROLE postgres;
  -- anon ne peut rien appeler ; une fonction interne n'est pas appelable par authenticated
  SET LOCAL ROLE anon;
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_batch(%L, %L::jsonb)$q$, v_imp, v_lot), 'permission denied for function catalog_items_import_batch', '42501');
  SET LOCAL ROLE postgres;
  SET LOCAL ROLE authenticated;
  PERFORM public.zz_assert_erreur(format($q$SELECT majordhome.catalog_import_org_admin(%L)$q$, v_imp), 'permission denied for function catalog_import_org_admin', '42501');
  PERFORM public.zz_assert_erreur($q$SELECT public.supplier_catalog_upsert(gen_random_uuid(), gen_random_uuid(), 'x', '[{}]', '{}')$q$, 'permission denied for function supplier_catalog_upsert', '42501');
  SET LOCAL ROLE postgres;
  IF (SELECT count(*) FROM majordhome.catalog_imports) <> n_imp THEN RAISE EXCEPTION 'un start refusé a créé un import'; END IF;
  IF (SELECT count(*) FROM majordhome.suppliers) <> n_sup THEN RAISE EXCEPTION 'un start refusé a créé un fournisseur'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 30) THEN RAISE EXCEPTION 'un refus a écrit'; END IF;
  RAISE NOTICE '§5 refus d''accès : OK';
END $$;

-- ── 9. Lecture de la vue des imports ─────────────────────────────────────────
DO $$
DECLARE
  v_admin   uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_a_tl    uuid := '6c3a9488-92ee-42cc-b010-6646ca299139';
  v_b_admin uuid := '8ebd6637-489e-473e-9583-807ab1e3154e';
  v_b_tl    uuid := 'fe6e3954-3ba7-412f-a822-d4b2844b085f';
  v_imp     uuid := current_setting('test.imp_a')::uuid;
  v_nom     text; n int; u uuid;
BEGIN
  SELECT full_name INTO v_nom FROM core.profiles WHERE id = v_admin;
  SET LOCAL ROLE authenticated;
  PERFORM public.zz_identite(v_admin);
  IF (SELECT count(*) FROM public.majordhome_catalog_imports WHERE id = v_imp) <> 1 THEN RAISE EXCEPTION 'org_admin de A ne lit pas son import'; END IF;
  IF (SELECT created_by_name FROM public.majordhome_catalog_imports WHERE id = v_imp) IS DISTINCT FROM v_nom THEN RAISE EXCEPTION 'created_by_name faux'; END IF;
  FOREACH u IN ARRAY ARRAY[v_a_tl, v_b_admin, v_b_tl] LOOP
    PERFORM public.zz_identite(u);
    SELECT count(*) INTO n FROM public.majordhome_catalog_imports WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
    IF n <> 0 THEN RAISE EXCEPTION '% lit % import(s) de A', u, n; END IF;
    SELECT count(*) INTO n FROM majordhome.catalog_imports;
    IF n <> 0 THEN RAISE EXCEPTION '% lit % ligne(s) de catalog_imports', u, n; END IF;
  END LOOP;
  SET LOCAL ROLE postgres;
  RAISE NOTICE '§9 lecture : OK';
END $$;

-- ── 6. Clôture ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp   uuid := current_setting('test.imp_a')::uuid;
BEGIN
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  PERFORM public.catalog_items_import_finish(v_imp, '{"lues": 4, "importees": 5}'::jsonb);
  SET LOCAL ROLE postgres;
  IF (SELECT status = 'termine' AND counts = '{"lues": 4, "importees": 5}'::jsonb FROM majordhome.catalog_imports WHERE id = v_imp) IS NOT TRUE THEN
    RAISE EXCEPTION 'finish : statut ou counts';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_batch(%L, '[{"import_line": 40, "name": "TARDIF", "product_kind": "main", "default_tva_rate": 20, "selling_price_ht": 0}]'::jsonb)$q$, v_imp), 'import_closed', '55000');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_finish(%L, '{}')$q$, v_imp), 'import_closed', '55000');
  SET LOCAL ROLE postgres;
  RAISE NOTICE '§6 clôture : OK';
END $$;

-- ── 7-8. Les relevés n'ont pas changé ; un relevé met à jour EN PLACE la ligne de l'import ──
DO $$
DECLARE
  v_a    uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_sa   uuid := current_setting('test.sa')::uuid;
  v_snew uuid := current_setting('test.snew')::uuid;
  v_ib   uuid := current_setting('test.ib')::uuid;
  v_imp  uuid := current_setting('test.imp_a')::uuid;
  avant record; apres record; l record; n_a int; r jsonb;
BEGIN
  SELECT count(*) INTO n_a FROM majordhome.catalog_items WHERE org_id = v_a;
  SET LOCAL ROLE service_role;
  -- 7. Relevé sans les nouvelles clés : ligne datée, article créé par ensure comme avant. Une clé catalog_item_id
  --    d'un article d'une AUTRE organisation est ignorée.
  r := public.supplier_catalog_upsert(v_a, v_sa, 'releve-2026-11', jsonb_build_array(
         jsonb_build_object('reference', 'RELEVE-1', 'name', 'Article relevé', 'brand', 'MARQUE X', 'purchase_price_ht', 100,
                            'specs', jsonb_build_object('source_version', 'releve-2026-11')),
         jsonb_build_object('reference', 'RELEVE-2', 'name', 'Article relevé 2', 'purchase_price_ht', 80, 'catalog_item_id', v_ib,
                            'specs', jsonb_build_object('source_version', 'releve-2026-11'))),
         '{"desactiver_absents": false}'::jsonb);
  IF (r ->> 'inseres')::int <> 2 OR (r -> 'articles' ->> 'crees')::int <> 2 THEN RAISE EXCEPTION 'relevé : %', r; END IF;
  SET LOCAL ROLE postgres;
  SELECT * INTO l FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'RELEVE-1';
  IF l.purchase_price_at IS NULL OR l.catalog_item_id IS NULL OR l.catalog_item_link_source <> 'auto' THEN RAISE EXCEPTION 'relevé RELEVE-1 : %', row_to_json(l); END IF;
  IF (SELECT origin FROM majordhome.catalog_items WHERE id = l.catalog_item_id) <> 'auto' THEN RAISE EXCEPTION 'relevé : article non créé par ensure'; END IF;
  SELECT * INTO l FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'RELEVE-2';
  IF l.catalog_item_id IS NULL OR l.catalog_item_id = v_ib OR l.catalog_item_link_source <> 'auto' THEN RAISE EXCEPTION 'relevé RELEVE-2 : article d''une autre org accepté : %', row_to_json(l); END IF;
  IF (SELECT count(*) FROM majordhome.catalog_items WHERE org_id = v_a) <> n_a + 2 THEN RAISE EXCEPTION 'relevé : 2 articles attendus'; END IF;
  -- Un vrai relevé (sans conserver_erreur_releve) efface l'erreur du relevé précédent, comme avant
  IF (SELECT catalog_sync_error FROM majordhome.suppliers WHERE id = v_sa) IS NOT NULL THEN
    RAISE EXCEPTION 'relevé : catalog_sync_error non effacée (%)', (SELECT catalog_sync_error FROM majordhome.suppliers WHERE id = v_sa);
  END IF;

  -- 8. Relevé de la même référence que l'import : mise à jour en place
  SELECT * INTO avant FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'REF-A1';
  SET LOCAL ROLE service_role;
  r := public.supplier_catalog_upsert(v_a, v_sa, 'releve-2026-12', jsonb_build_array(
         jsonb_build_object('reference', 'REF-A1', 'name', 'Libellé du site', 'purchase_price_ht', 1400, 'catalog_item_id', v_ib,
                            'specs', jsonb_build_object('source_version', 'releve-2026-12'))),
         '{"desactiver_absents": false, "prix_sans_date": true}'::jsonb);
  IF (r ->> 'inseres')::int <> 0 OR (r ->> 'mis_a_jour')::int <> 1 THEN RAISE EXCEPTION 'relevé REF-A1 : %', r; END IF;
  r := public.supplier_catalog_upsert(v_a, v_snew, 'releve-2026-12', jsonb_build_array(
         jsonb_build_object('reference', 'REF-N1', 'name', 'Kit', 'purchase_price_ht', 11, 'specs', jsonb_build_object('source_version', 'releve-2026-12'))),
         '{"desactiver_absents": false}'::jsonb);
  SET LOCAL ROLE postgres;
  SELECT * INTO apres FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'REF-A1';
  IF apres.id <> avant.id OR apres.catalog_item_id IS DISTINCT FROM avant.catalog_item_id OR apres.catalog_item_link_source <> 'import'
     OR apres.purchase_price_ht <> 1400 OR apres.purchase_price_at IS NULL OR apres.purchase_price_at <= avant.purchase_price_at
     OR apres.specs ->> 'source_version' <> 'releve-2026-12' OR apres.name <> 'Poêle Alpha 8 kW' OR NOT apres.is_active THEN
    RAISE EXCEPTION 'REF-A1 non mise à jour en place : avant % / après %', row_to_json(avant), row_to_json(apres);
  END IF;
  IF (SELECT count(*) FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'REF-A1') <> 1 THEN RAISE EXCEPTION 'REF-A1 doublée'; END IF;
  SELECT * INTO l FROM majordhome.supplier_products WHERE supplier_id = v_snew AND reference = 'REF-N1';
  IF l.purchase_price_at IS NULL OR l.purchase_price_ht <> 11 OR l.catalog_item_link_source <> 'import'
     OR l.catalog_item_id IS DISTINCT FROM (SELECT id FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 3) THEN
    RAISE EXCEPTION 'REF-N1 : le relevé doit dater la ligne importée sans date : %', row_to_json(l);
  END IF;
  IF (SELECT count(*) FROM majordhome.catalog_items WHERE org_id = v_a) <> n_a + 2 THEN RAISE EXCEPTION 'relevé de la ligne importée : article créé en plus'; END IF;
  RAISE NOTICE '§7-8 relevés inchangés, mise à jour en place : OK';
END $$;

-- ── Adhésion non active : un org_admin suspendu est refusé ──────────────────
DO $$
DECLARE
  v_b        uuid := '62cd2073-96e0-4300-adae-4c1bb8934546';
  v_suspendu uuid := '19500c66-20a9-46fb-8ffa-089577d9512f';
BEGIN
  IF (SELECT role FROM core.organization_members WHERE org_id = v_b AND user_id = v_suspendu) IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'donnée de test : % n''est plus org_admin de B', v_suspendu;
  END IF;
  UPDATE core.organization_members SET status = 'suspended' WHERE org_id = v_b AND user_id = v_suspendu;
  PERFORM public.zz_identite(v_suspendu);
  SET LOCAL ROLE authenticated;
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_start(%L, 'f.csv', '{}', '{}', '[]')$q$, v_b), 'org_admin_required', '42501');
  SET LOCAL ROLE postgres;
  UPDATE core.organization_members SET status = 'active' WHERE org_id = v_b AND user_id = v_suspendu;
  RAISE NOTICE 'adhésion non active : OK';
END $$;

-- ── Mesure (Step 5) : lot de 200 lignes dont 100 avec fournisseur, sur une base au volume de la prod ──
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_sa    uuid := current_setting('test.sa')::uuid;
  v_fill  uuid; v_item uuid; v_imp uuid; v_rows jsonb; t0 timestamptz; d1 numeric; d2 numeric; r jsonb;
BEGIN
  -- Volume : ~27 000 articles et ~31 000 lignes fournisseur rattachées (prod, 2026-11-28)
  INSERT INTO majordhome.suppliers (org_id, name) VALUES (v_a, 'ZZ VOLUME') RETURNING id INTO v_fill;
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, code, origin)
  SELECT v_a, 'Volume ' || g, 'MARQUE ' || (g % 50), 'mk' || g, 'VOL-' || g, 'auto' FROM generate_series(1, 27000) g;
  SELECT id INTO v_item FROM majordhome.catalog_items WHERE org_id = v_a AND code = 'VOL-1';
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht, purchase_price_at, catalog_item_id, specs)
  SELECT v_fill, v_a, 'VREF-' || g, 'Ligne ' || g, 10, now(), v_item, '{"source_version": "volume"}'::jsonb FROM generate_series(1, 31000) g;
  ANALYZE majordhome.catalog_items;
  ANALYZE majordhome.supplier_products;

  SELECT jsonb_agg(jsonb_build_object('import_line', g, 'name', 'MESURE Article ' || g, 'code', 'MES-' || g, 'brand', 'MARQUE M',
           'model_key', 'mes' || g, 'modele_brut', 'Mes ' || g, 'code_ean', NULL, 'category', 'poele', 'gamme', NULL,
           'product_kind', 'main', 'unit', 'pièce', 'default_tva_rate', 20, 'selling_price_ht', 100 + g, 'description', 'd' || g,
           'ancien_numero', 'A' || g,
           'fournisseur', CASE WHEN g % 2 = 0 THEN jsonb_build_object('supplier_id', v_sa, 'reference', 'MREF-' || g,
             'purchase_price_ht', 50 + g, 'tarif_public', 90 + g, 'purchase_price_at', CASE WHEN g % 4 = 0 THEN '2026-06-01' END) END))
    INTO v_rows FROM generate_series(1, 200) g;
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_start(v_a, 'mesure.xlsx', '{}', '{}', '[]');
  v_imp := (r ->> 'import_id')::uuid;
  t0 := clock_timestamp();
  r := public.catalog_items_import_batch(v_imp, v_rows);
  d1 := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  IF r IS DISTINCT FROM '{"created": 200, "skipped": 0, "lignes_fournisseur": 100}'::jsonb THEN RAISE EXCEPTION 'mesure : %', r; END IF;
  t0 := clock_timestamp();
  r := public.catalog_items_import_batch(v_imp, v_rows);
  d2 := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  IF r IS DISTINCT FROM '{"created": 0, "skipped": 200, "lignes_fournisseur": 0}'::jsonb THEN RAISE EXCEPTION 'mesure rejeu : %', r; END IF;
  SET LOCAL ROLE postgres;
  IF (SELECT count(*) FROM majordhome.supplier_products p JOIN majordhome.catalog_items i ON i.id = p.catalog_item_id
       WHERE i.import_id = v_imp AND p.catalog_item_link_source = 'import') <> 100 THEN RAISE EXCEPTION 'mesure : 100 lignes rattachées attendues'; END IF;
  RAISE NOTICE 'MESURE duree_ms lot de 200 (100 avec fournisseur) = % ; rejeu = % (déclencheur recherche actif : %)', d1, d2,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'majordhome.supplier_products'::regclass AND tgname = 'trg_supplier_products_recherche_ins');
  IF d1 > 2000 THEN RAISE EXCEPTION 'mesure au-dessus de 2 000 ms : %', d1; END IF;
END $$;

DROP FUNCTION public.zz_assert_erreur(text, text, text, text);
DROP FUNCTION public.zz_identite(uuid);
