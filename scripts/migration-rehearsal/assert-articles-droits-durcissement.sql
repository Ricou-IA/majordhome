-- assert-articles-droits-durcissement.sql — vérifie 20261028_4_articles_droits_durcissement.sql (après 20261028_3).
-- (1) UPDATE par colonne sur majordhome.catalog_items et son miroir public.majordhome_catalog_items : un team_leader
--     modifie `name` (table et vue) mais pas `merged_into` / `source_product_id` / `origin` / `org_id` / `model_key` /
--     `code_ean` (insufficient_privilege, AVANT la RLS) ; un commercial : 0 ligne sur `name` (RLS), refus de colonne idem.
-- (2) product_documents : un document d'article (ou de ligne) pointant vers une entité d'une AUTRE org est refusé à
--     l'insertion et à la modification ; même org accepté ; retrait d'un document de ligne par un membre toujours permis.
-- (2b) Storage product-documents (stub storage.objects du harnais, RLS + foldername) : un objet `${org}/articles/…` s'ajoute et
--     se retire sous articles.edit (team_leader oui, commercial non) ; un objet de ligne `${org}/${product}/…` reste « tout membre ».
-- Impersonation comme assert-articles-droits.sql (membres Mayer choisis par rôle effectif, sans profil maison). Fixture nettoyée.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;
  v_tl uuid; v_com uuid;
  v_sup uuid; v_sup_autre uuid; v_prod uuid; v_prod_autre uuid;
  v_item uuid; v_item_autre uuid; v_doc uuid; v_doc_ligne uuid;
  v_n int; ok boolean; v_err text; c text;
  v_humaines text[] := ARRAY['name','code','brand','category','gamme','product_kind','unit','default_tva_rate','selling_price_ht','description','image_url','specs','is_active','updated_at'];
  v_interdites text[] := ARRAY['id','org_id','model_key','code_ean','source_product_id','origin','merged_into','created_at'];
BEGIN
  -- ── 0. Structure : ACL par colonne (table ET vue), anon / service_role ────────────────────────────────
  IF has_table_privilege('authenticated', 'majordhome.catalog_items', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated a encore UPDATE sur TOUTE la table majordhome.catalog_items';
  END IF;
  IF has_table_privilege('authenticated', 'public.majordhome_catalog_items', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated a encore UPDATE sur TOUTE la vue public.majordhome_catalog_items';
  END IF;
  IF has_table_privilege('authenticated', 'majordhome.catalog_items', 'DELETE') OR has_table_privilege('authenticated', 'public.majordhome_catalog_items', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated a DELETE sur catalog_items (aucune policy : à retirer)';
  END IF;
  IF NOT (has_table_privilege('authenticated', 'majordhome.catalog_items', 'INSERT') AND has_table_privilege('authenticated', 'public.majordhome_catalog_items', 'INSERT')
          AND has_table_privilege('authenticated', 'majordhome.catalog_items', 'SELECT') AND has_table_privilege('authenticated', 'public.majordhome_catalog_items', 'SELECT')) THEN
    RAISE EXCEPTION 'authenticated sans SELECT / INSERT sur catalog_items (table ou vue)';
  END IF;
  FOREACH c IN ARRAY v_humaines LOOP
    IF NOT has_column_privilege('authenticated', 'majordhome.catalog_items', c, 'UPDATE') THEN RAISE EXCEPTION 'colonne humaine % sans UPDATE (table)', c; END IF;
    IF NOT has_column_privilege('authenticated', 'public.majordhome_catalog_items', c, 'UPDATE') THEN RAISE EXCEPTION 'colonne humaine % sans UPDATE (vue)', c; END IF;
  END LOOP;
  FOREACH c IN ARRAY v_interdites LOOP
    IF has_column_privilege('authenticated', 'majordhome.catalog_items', c, 'UPDATE') THEN RAISE EXCEPTION 'colonne % encore modifiable par authenticated (table)', c; END IF;
    IF has_column_privilege('authenticated', 'public.majordhome_catalog_items', c, 'UPDATE') THEN RAISE EXCEPTION 'colonne % encore modifiable par authenticated (vue)', c; END IF;
  END LOOP;
  IF has_any_column_privilege('anon', 'majordhome.catalog_items', 'SELECT') OR has_any_column_privilege('anon', 'public.majordhome_catalog_items', 'SELECT')
     OR has_any_column_privilege('anon', 'majordhome.catalog_items', 'UPDATE') OR has_any_column_privilege('anon', 'public.majordhome_catalog_items', 'UPDATE') THEN
    RAISE EXCEPTION 'anon a un privilège sur catalog_items (table ou vue)';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_catalog_items', 'SELECT') OR has_any_column_privilege('service_role', 'public.majordhome_catalog_items', 'UPDATE')
     OR has_any_column_privilege('service_role', 'majordhome.catalog_items', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role : SELECT seul attendu sur catalog_items (table et vue)';
  END IF;
  -- policies product_documents : contrôle d'org dans WITH CHECK (insert, update), pas dans USING
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'product_documents'
    AND policyname IN ('product_documents_insert', 'product_documents_update')
    AND with_check ~ 'catalog_items ci' AND with_check ~ 'ci\.org_id = product_documents\.org_id'
    AND with_check ~ 'supplier_products sp' AND with_check ~ 'sp\.org_id = product_documents\.org_id'
    AND with_check ~ 'role_can\((product_documents\.)?org_id, ''articles''::text, ''edit''::text\)';
  IF v_n <> 2 THEN RAISE EXCEPTION 'policies product_documents insert/update : % sur 2 avec le contrôle d''org dans WITH CHECK', v_n; END IF;
  PERFORM 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'product_documents' AND policyname = 'product_documents_update'
    AND qual !~ 'catalog_items ci' AND qual ~ 'role_can';
  IF NOT FOUND THEN RAISE EXCEPTION 'product_documents_update : USING doit rester « membre + articles.edit » sans contrôle d''org'; END IF;
  PERFORM 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'product_documents' AND policyname = 'product_documents_delete'
    AND qual ~ 'role_can' AND qual !~ 'catalog_items ci';
  IF NOT FOUND THEN RAISE EXCEPTION 'product_documents_delete a changé (devait rester celle de 20261028_3)'; END IF;

  -- ── Fixture ────────────────────────────────────────────────────────────────────────────────────────────
  SELECT om.user_id INTO v_tl FROM core.organization_members om LEFT JOIN core.profiles p ON p.id = om.user_id
  WHERE om.org_id = v_mayer AND (om.role = 'team_leader' OR p.app_role = 'team_leader')
    AND om.role <> 'org_admin' AND coalesce(p.app_role, '') <> 'org_admin'
    AND NOT EXISTS (SELECT 1 FROM majordhome.member_org_roles m WHERE m.user_id = om.user_id AND m.org_id = om.org_id)
  LIMIT 1;
  SELECT om.user_id INTO v_com FROM core.organization_members om LEFT JOIN core.profiles p ON p.id = om.user_id
  WHERE om.org_id = v_mayer AND om.role NOT IN ('org_admin', 'team_leader')
    AND coalesce(p.app_role, '') NOT IN ('org_admin', 'team_leader') AND lower(coalesce(p.business_role, '')) = 'commercial'
    AND NOT EXISTS (SELECT 1 FROM majordhome.member_org_roles m WHERE m.user_id = om.user_id AND m.org_id = om.org_id)
  LIMIT 1;
  IF v_tl IS NULL OR v_com IS NULL THEN RAISE EXCEPTION 'fixture : il faut un team_leader et un commercial Mayer sans profil maison'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.role_permissions WHERE org_id = v_mayer AND resource = 'articles') THEN
    RAISE EXCEPTION 'fixture : surcharge Mayer sur articles — les verdicts attendus ne sont plus les défauts';
  END IF;
  SELECT o.id INTO v_autre FROM core.organizations o
  WHERE o.id <> v_mayer AND NOT EXISTS (SELECT 1 FROM core.organization_members om WHERE om.org_id = o.id AND om.user_id IN (v_tl, v_com))
  LIMIT 1;
  IF v_autre IS NULL THEN RAISE EXCEPTION 'fixture : il faut une autre organisation (contrôle cross-org)'; END IF;

  INSERT INTO majordhome.catalog_items (org_id, name, brand, product_kind, origin) VALUES (v_mayer, 'TEST DURCI Article', 'V2C', 'main', 'manuel') RETURNING id INTO v_item;
  INSERT INTO majordhome.catalog_items (org_id, name, brand, product_kind, origin) VALUES (v_autre, 'TEST DURCI Autre org', 'V2C', 'main', 'manuel') RETURNING id INTO v_item_autre;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST DURCI Fournisseur', true) RETURNING id INTO v_sup;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_autre, 'TEST DURCI Fournisseur autre', true) RETURNING id INTO v_sup_autre;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht) VALUES (v_sup, v_mayer, 'DU-1', 'Ligne DU 1', 10) RETURNING id INTO v_prod;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht) VALUES (v_sup_autre, v_autre, 'DU-X', 'Ligne DU autre', 10) RETURNING id INTO v_prod_autre;

  -- ── 1. team_leader : colonnes humaines oui (table et vue), colonnes réservées non ──────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tl::text, true);
  UPDATE majordhome.catalog_items SET name = 'TEST DURCI TL', updated_at = now() WHERE id = v_item;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'team_leader : UPDATE name sur la table refusé (% ligne)', v_n; END IF;
  UPDATE public.majordhome_catalog_items SET name = 'TEST DURCI TL vue', code = 'DU-TL', selling_price_ht = 12, is_active = true, specs = '{"canonical":{}}'::jsonb, updated_at = now()
  WHERE id = v_item AND org_id = v_mayer;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'team_leader : UPDATE des champs humains par la VUE refusé (% ligne)', v_n; END IF;
  ok := false; v_err := NULL;
  BEGIN
    UPDATE majordhome.catalog_items SET merged_into = v_item_autre WHERE id = v_item;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'team_leader : merged_into modifiable sur la table'; END IF;
  ok := false;
  BEGIN
    UPDATE public.majordhome_catalog_items SET merged_into = v_item_autre WHERE id = v_item;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'team_leader : merged_into modifiable par la vue'; END IF;
  FOREACH c IN ARRAY ARRAY['source_product_id', 'origin', 'org_id', 'model_key', 'code_ean'] LOOP
    ok := false;
    BEGIN
      EXECUTE format('UPDATE public.majordhome_catalog_items SET %I = NULL WHERE id = $1', c) USING v_item;
    EXCEPTION WHEN insufficient_privilege THEN ok := true;
    WHEN not_null_violation THEN ok := false; -- la colonne a été ACCEPTÉE (NOT NULL atteint) : privilège encore ouvert
    END;
    IF NOT ok THEN RAISE EXCEPTION 'team_leader : colonne % modifiable par la vue', c; END IF;
  END LOOP;
  -- document d'article : même org accepté ; autre org refusé (insert puis update)
  INSERT INTO majordhome.product_documents (org_id, catalog_item_id, document_type, file_name, storage_path)
  VALUES (v_mayer, v_item, 'Fiche technique', 'tl.pdf', v_mayer || '/articles/' || v_item || '/tl.pdf') RETURNING id INTO v_doc;
  ok := false;
  BEGIN
    INSERT INTO majordhome.product_documents (org_id, catalog_item_id, document_type, file_name, storage_path)
    VALUES (v_mayer, v_item_autre, 'Fiche technique', 'pirate.pdf', v_mayer || '/articles/' || v_item_autre || '/pirate.pdf');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cross-org : document Mayer posé sur un article d''une autre org'; END IF;
  ok := false;
  BEGIN
    INSERT INTO majordhome.product_documents (org_id, supplier_product_id, document_type, file_name, storage_path)
    VALUES (v_mayer, v_prod_autre, 'Fiche technique', 'pirate.pdf', v_mayer || '/' || v_prod_autre || '/pirate.pdf');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cross-org : document Mayer posé sur une ligne fournisseur d''une autre org'; END IF;
  ok := false;
  BEGIN
    UPDATE majordhome.product_documents SET catalog_item_id = v_item_autre WHERE id = v_doc;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cross-org : document d''article re-pointé vers un article d''une autre org'; END IF;
  UPDATE majordhome.product_documents SET file_name = 'tl2.pdf' WHERE id = v_doc;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'team_leader : modification d''un document d''article de sa propre org refusée'; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE id = v_item AND name = 'TEST DURCI TL vue' AND code = 'DU-TL' AND merged_into IS NULL AND origin = 'manuel' AND org_id = v_mayer) THEN
    RAISE EXCEPTION 'état de l''article après le team_leader inattendu';
  END IF;

  -- ── 2. commercial : RLS (0 ligne) et privilège de colonne (refus) ──────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_com::text, true);
  UPDATE public.majordhome_catalog_items SET name = 'pirate' WHERE id = v_item;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'commercial : un article a été modifié par la vue'; END IF;
  ok := false;
  BEGIN
    UPDATE public.majordhome_catalog_items SET merged_into = NULL WHERE id = v_item;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'commercial : merged_into accepté par la vue (privilège de colonne ouvert)'; END IF;
  -- document de LIGNE de sa propre org : toujours « tout membre » (non-régression)
  INSERT INTO majordhome.product_documents (org_id, supplier_product_id, document_type, file_name, storage_path)
  VALUES (v_mayer, v_prod, 'Fiche technique', 'ligne.pdf', v_mayer || '/' || v_prod || '/ligne.pdf') RETURNING id INTO v_doc_ligne;
  DELETE FROM majordhome.product_documents WHERE id = v_doc_ligne;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'commercial : retrait d''un document de ligne refusé (régression)'; END IF;
  RESET ROLE;

  -- ── 2b. Storage : objets d'article sous articles.edit, objets de ligne « tout membre » ───────────────
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('product_documents_org_insert', 'product_documents_org_update', 'product_documents_org_delete')
    AND coalesce(qual, '') || coalesce(with_check, '') ~ 'product-documents'
    AND coalesce(qual, '') || coalesce(with_check, '') ~ 'IS DISTINCT FROM ''articles''::text'
    AND coalesce(qual, '') || coalesce(with_check, '') ~ 'role_can\(.*''articles''::text, ''edit''::text\)';
  IF v_n <> 3 THEN RAISE EXCEPTION 'policies Storage product-documents insert/update/delete : % sur 3 avec la clause articles.edit', v_n; END IF;
  -- la policy SELECT n'est pas photographiée par le harnais (20260809_2) : contrôlée seulement là où elle existe (prod)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'product_documents_org_select' AND qual ~ 'role_can') THEN
    RAISE EXCEPTION 'product_documents_org_select a changé (la lecture devait rester « tout membre »)';
  END IF;
  GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated; -- stub du harnais : seules les policies sont testées
  -- La policy SELECT de 20260809_2 n'est pas photographiée : sans elle, un DELETE … WHERE ne voit aucune ligne (0 ligne pour
  -- tout le monde, faux positif). On la recrée à l'identique si elle manque (harnais), jamais en prod où elle existe.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'product_documents_org_select') THEN
    EXECUTE $p$CREATE POLICY product_documents_org_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'product-documents' AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()))$p$;
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tl::text, true);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('product-documents', v_mayer || '/articles/' || v_item || '/tl.pdf');
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_com::text, true);
  ok := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('product-documents', v_mayer || '/articles/' || v_item || '/com.pdf');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'Storage : un commercial a déposé un objet d''article'; END IF;
  DELETE FROM storage.objects WHERE bucket_id = 'product-documents' AND name = v_mayer || '/articles/' || v_item || '/tl.pdf';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'Storage : un commercial a retiré l''objet d''un document d''article'; END IF;
  INSERT INTO storage.objects (bucket_id, name) VALUES ('product-documents', v_mayer || '/' || v_prod || '/ligne.pdf');
  DELETE FROM storage.objects WHERE bucket_id = 'product-documents' AND name = v_mayer || '/' || v_prod || '/ligne.pdf';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Storage : objet de ligne fournisseur non retirable par un membre (régression)'; END IF;
  ok := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('product-documents', v_autre || '/' || v_prod_autre || '/pirate.pdf');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'Storage : objet déposé sous le préfixe d''une autre org'; END IF;
  RESET ROLE;
  DELETE FROM storage.objects WHERE bucket_id = 'product-documents' AND name = v_mayer || '/articles/' || v_item || '/tl.pdf';
  REVOKE ALL ON storage.objects FROM authenticated; REVOKE USAGE ON SCHEMA storage FROM authenticated;

  -- ── 3. anon : aucun accès effectif à la vue ────────────────────────────────────────────────────────────
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN
    PERFORM 1 FROM public.majordhome_catalog_items LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'anon lit public.majordhome_catalog_items'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ── nettoyage ──────────────────────────────────────────────────────────────────────────────────────────
  DELETE FROM majordhome.product_documents WHERE id = v_doc;
  DELETE FROM majordhome.supplier_products WHERE supplier_id IN (v_sup, v_sup_autre);
  DELETE FROM majordhome.catalog_items WHERE id IN (v_item, v_item_autre);
  DELETE FROM majordhome.suppliers WHERE id IN (v_sup, v_sup_autre);

  RAISE NOTICE 'assert-articles-droits-durcissement : OK';
END $$;
