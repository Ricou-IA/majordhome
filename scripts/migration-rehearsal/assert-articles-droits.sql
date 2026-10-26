-- assert-articles-droits.sql — vérifie 20261028_3_articles_droits.sql (partie 1 : défauts `articles` ; partie 2 :
-- écritures d'article sous majordhome.role_can(org, 'articles', create | edit)).
-- Impersonation (SET LOCAL ROLE authenticated + request.jwt.claim.sub) de membres Mayer choisis par leur rôle
-- EFFECTIF (même dérivation que majordhome.user_effective_role), sans profil maison ni surcharge `articles` :
--   team_leader  → met à jour / crée un article, ajoute un document d'article, RPC create / attach / detach acceptées ;
--   commercial   → tout refusé (insufficient_privilege, ou 0 ligne touchée sous RLS), document de LIGNE toujours permis ;
--   non authentifié → not_authenticated ; autre org → refusé (cross-org) ;
--   user_can vrai / faux selon le rôle, jamais NULL ; anon sans EXECUTE ; policies *_admin disparues.
-- Fixture nettoyée.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;
  v_tl uuid; v_com uuid; v_tech uuid;
  v_sup uuid; v_sup_autre uuid;
  v_prod1 uuid; v_prod2 uuid; v_prod3 uuid; v_prod_autre uuid;
  v_item uuid; v_item_autre uuid; v_new uuid; v_new2 uuid; v_ins uuid;
  v_doc uuid; v_doc_ligne uuid;
  v_n int; ok boolean; v_err text;
BEGIN
  -- ── 0. Structure ───────────────────────────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'catalog_items'
             AND policyname IN ('catalog_items_insert_admin', 'catalog_items_update_admin')) THEN
    RAISE EXCEPTION 'policy legacy catalog_items_*_admin encore présente';
  END IF;
  PERFORM 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'catalog_items' AND policyname = 'catalog_items_insert'
    AND cmd = 'INSERT' AND with_check ~ 'role_can\(org_id, ''articles''::text, ''create''::text\)';
  IF NOT FOUND THEN RAISE EXCEPTION 'policy catalog_items_insert (role_can articles.create) absente'; END IF;
  PERFORM 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'catalog_items' AND policyname = 'catalog_items_update'
    AND cmd = 'UPDATE' AND qual ~ 'role_can\(org_id, ''articles''::text, ''edit''::text\)'
    AND with_check ~ 'role_can\(org_id, ''articles''::text, ''edit''::text\)';
  IF NOT FOUND THEN RAISE EXCEPTION 'policy catalog_items_update (role_can articles.edit) absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'catalog_items' AND policyname = 'catalog_items_select') THEN
    RAISE EXCEPTION 'catalog_items_select a disparu (la lecture ne devait pas bouger)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'catalog_items' AND cmd = 'DELETE') THEN
    RAISE EXCEPTION 'policy DELETE sur catalog_items : un article ne se supprime pas';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'product_documents'
    AND policyname IN ('product_documents_insert', 'product_documents_update', 'product_documents_delete')
    AND coalesce(qual, '') || coalesce(with_check, '') ~ 'catalog_item_id IS NULL\) OR majordhome\.role_can\((product_documents\.)?org_id, ''articles''::text, ''edit''::text\)'
    AND coalesce(qual, '') || coalesce(with_check, '') !~ 'org_admin';
  IF v_n <> 3 THEN RAISE EXCEPTION 'policies product_documents insert/update/delete : % sur 3 sous role_can(articles.edit)', v_n; END IF;

  IF to_regprocedure('public.user_can(uuid, text, text)') IS NULL THEN RAISE EXCEPTION 'public.user_can absente'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.user_can(uuid, text, text)'::regprocedure) THEN
    RAISE EXCEPTION 'public.user_can doit être SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.user_can(uuid,text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon a EXECUTE sur public.user_can'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.user_can(uuid,text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated sans EXECUTE sur public.user_can'; END IF;
  IF NOT has_function_privilege('service_role', 'public.user_can(uuid,text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'service_role sans EXECUTE sur public.user_can'; END IF;
  IF has_function_privilege('anon', 'majordhome.catalog_item_require_edit(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'majordhome.catalog_item_require_edit(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'catalog_item_require_edit exécutable par anon / authenticated';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'majordhome.catalog_item_require_edit(uuid,text)'::regprocedure) THEN
    RAISE EXCEPTION 'catalog_item_require_edit doit être SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.catalog_item_create_for_product(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.catalog_item_attach(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.catalog_item_detach(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon a EXECUTE sur une RPC d''article';
  END IF;
  IF NOT (has_function_privilege('authenticated', 'public.catalog_item_create_for_product(uuid)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.catalog_item_attach(uuid,uuid)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.catalog_item_detach(uuid)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'authenticated sans EXECUTE sur une RPC d''article';
  END IF;
  -- les trois RPC ne passent plus par la garde org_admin
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN ('public.catalog_item_create_for_product(uuid)'::regprocedure,
             'public.catalog_item_attach(uuid,uuid)'::regprocedure, 'public.catalog_item_detach(uuid)'::regprocedure)
             AND (prosrc ~ 'catalog_item_require_admin' OR prosrc !~ 'catalog_item_require_edit')) THEN
    RAISE EXCEPTION 'une RPC d''article garde encore catalog_item_require_admin';
  END IF;
  -- partie 1 : défauts app de la ressource
  SELECT count(*) INTO v_n FROM majordhome.app_role_permissions WHERE resource = 'articles';
  IF v_n <> 9 THEN RAISE EXCEPTION 'défauts articles : % lignes, 9 attendues', v_n; END IF;

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
  SELECT om.user_id INTO v_tech FROM core.organization_members om LEFT JOIN core.profiles p ON p.id = om.user_id
  WHERE om.org_id = v_mayer AND om.role NOT IN ('org_admin', 'team_leader')
    AND coalesce(p.app_role, '') NOT IN ('org_admin', 'team_leader') AND lower(coalesce(p.business_role, '')) <> 'commercial'
    AND NOT EXISTS (SELECT 1 FROM majordhome.member_org_roles m WHERE m.user_id = om.user_id AND m.org_id = om.org_id)
  LIMIT 1;
  IF v_tl IS NULL OR v_com IS NULL OR v_tech IS NULL THEN
    RAISE EXCEPTION 'fixture : il faut un team_leader, un commercial et un technicien Mayer sans profil maison (tl=% com=% tech=%)', v_tl, v_com, v_tech;
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.role_permissions WHERE org_id = v_mayer AND resource = 'articles') THEN
    RAISE EXCEPTION 'fixture : surcharge Mayer sur articles — les verdicts attendus ne sont plus les défauts';
  END IF;
  SELECT o.id INTO v_autre FROM core.organizations o
  WHERE o.id <> v_mayer AND NOT EXISTS (SELECT 1 FROM core.organization_members om WHERE om.org_id = o.id AND om.user_id IN (v_tl, v_com, v_tech))
  LIMIT 1;
  IF v_autre IS NULL THEN RAISE EXCEPTION 'fixture : il faut une autre organisation (contrôle cross-org)'; END IF;

  INSERT INTO majordhome.catalog_items (org_id, name, brand, product_kind, origin) VALUES (v_mayer, 'TEST DROITS Article', 'V2C', 'main', 'manuel') RETURNING id INTO v_item;
  INSERT INTO majordhome.catalog_items (org_id, name, brand, product_kind, origin) VALUES (v_autre, 'TEST DROITS Autre org', 'V2C', 'main', 'manuel') RETURNING id INTO v_item_autre;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST DROITS Fournisseur', true) RETURNING id INTO v_sup;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_autre, 'TEST DROITS Fournisseur autre', true) RETURNING id INTO v_sup_autre;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht) VALUES (v_sup, v_mayer, 'DR-1', 'Ligne DR 1', 10) RETURNING id INTO v_prod1;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht) VALUES (v_sup, v_mayer, 'DR-2', 'Ligne DR 2', 10) RETURNING id INTO v_prod2;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht) VALUES (v_sup, v_mayer, 'DR-3', 'Ligne DR 3', 10) RETURNING id INTO v_prod3;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht) VALUES (v_sup_autre, v_autre, 'DR-X', 'Ligne DR autre', 10) RETURNING id INTO v_prod_autre;

  -- ── 1. team_leader : autorisé ──────────────────────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tl::text, true);
  IF public.user_can(v_mayer, 'articles', 'edit') IS NOT TRUE OR public.user_can(v_mayer, 'articles', 'create') IS NOT TRUE THEN
    RAISE EXCEPTION 'user_can(articles edit/create) faux pour un team_leader';
  END IF;
  IF public.user_can(v_autre, 'articles', 'edit') IS NOT FALSE THEN RAISE EXCEPTION 'user_can vrai (ou NULL) sur une autre org'; END IF;
  IF public.user_can(v_mayer, 'articles', 'delete') IS NOT FALSE THEN RAISE EXCEPTION 'user_can(articles.delete) devrait être faux'; END IF;

  UPDATE majordhome.catalog_items SET name = 'TEST DROITS Article TL' WHERE id = v_item;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'team_leader : mise à jour d''un article refusée (% ligne)', v_n; END IF;
  INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin) VALUES (v_mayer, 'TEST DROITS créé TL', 'main', 'manuel') RETURNING id INTO v_ins;
  INSERT INTO majordhome.product_documents (org_id, catalog_item_id, document_type, file_name, storage_path)
  VALUES (v_mayer, v_item, 'Fiche technique', 'tl.pdf', v_mayer || '/articles/' || v_item || '/tl.pdf') RETURNING id INTO v_doc;
  UPDATE majordhome.product_documents SET file_name = 'tl2.pdf' WHERE id = v_doc;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'team_leader : modification d''un document d''article refusée'; END IF;
  v_new := public.catalog_item_create_for_product(v_prod1);
  IF v_new IS NULL THEN RAISE EXCEPTION 'team_leader : catalog_item_create_for_product sans résultat'; END IF;
  PERFORM public.catalog_item_attach(v_prod3, v_item);
  v_new2 := public.catalog_item_detach(v_prod3);
  IF v_new2 IS NULL THEN RAISE EXCEPTION 'team_leader : catalog_item_detach sans résultat'; END IF;
  -- pas de suppression d'article : 0 ligne (aucune policy DELETE, 20261028_3) ou refus de privilège (DELETE retiré du GRANT, 20261028_4)
  v_n := 0;
  BEGIN
    DELETE FROM majordhome.catalog_items WHERE id = v_item;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_n := 0;
  END;
  IF v_n <> 0 THEN RAISE EXCEPTION 'team_leader : un article a été supprimé'; END IF;
  -- cross-org : article d'une autre org ni modifiable, ni créable, RPC refusée
  UPDATE majordhome.catalog_items SET name = 'pirate' WHERE id = v_item_autre;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-org : un team_leader Mayer a modifié un article d''une autre org'; END IF;
  ok := false;
  BEGIN
    INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin) VALUES (v_autre, 'pirate', 'main', 'manuel');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cross-org : un team_leader Mayer a créé un article dans une autre org'; END IF;
  ok := false;
  BEGIN
    PERFORM public.catalog_item_create_for_product(v_prod_autre);
  EXCEPTION WHEN insufficient_privilege THEN ok := (SQLERRM = 'articles_edit_required');
  END;
  IF NOT ok THEN RAISE EXCEPTION 'cross-org : catalog_item_create_for_product accepté sur une ligne d''une autre org'; END IF;
  -- la garde n'est pas appelable directement
  ok := false;
  BEGIN
    PERFORM majordhome.catalog_item_require_edit(v_mayer, 'edit');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'catalog_item_require_edit appelable par authenticated'; END IF;
  RESET ROLE;

  IF NOT EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE id = v_prod1 AND catalog_item_id = v_new) THEN
    RAISE EXCEPTION 'create_for_product : la ligne n''est pas rattachée au nouvel article';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE id = v_prod3 AND catalog_item_id = v_new2) THEN
    RAISE EXCEPTION 'attach puis detach : la ligne n''est pas sur son nouvel article';
  END IF;

  -- ── 2. commercial : refusé ─────────────────────────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_com::text, true);
  IF public.user_can(v_mayer, 'articles', 'edit') IS NOT FALSE OR public.user_can(v_mayer, 'articles', 'create') IS NOT FALSE THEN
    RAISE EXCEPTION 'user_can(articles edit/create) vrai (ou NULL) pour un commercial';
  END IF;
  IF public.user_can(v_mayer, 'articles', 'view') IS NOT TRUE THEN RAISE EXCEPTION 'user_can(articles.view) faux pour un commercial'; END IF;
  UPDATE majordhome.catalog_items SET name = 'pirate' WHERE id = v_item;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'commercial : un article a été modifié'; END IF;
  ok := false;
  BEGIN
    INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin) VALUES (v_mayer, 'pirate', 'main', 'manuel');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'commercial : un article a été créé'; END IF;
  ok := false;
  BEGIN
    INSERT INTO majordhome.product_documents (org_id, catalog_item_id, document_type, file_name, storage_path)
    VALUES (v_mayer, v_item, 'Fiche technique', 'com.pdf', v_mayer || '/articles/' || v_item || '/com.pdf');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'commercial : un document d''article a été ajouté'; END IF;
  UPDATE majordhome.product_documents SET file_name = 'pirate.pdf' WHERE id = v_doc;
  DELETE FROM majordhome.product_documents WHERE id = v_doc;
  -- document de LIGNE fournisseur : toujours « tout membre » (non-régression)
  INSERT INTO majordhome.product_documents (org_id, supplier_product_id, document_type, file_name, storage_path)
  VALUES (v_mayer, v_prod2, 'Fiche technique', 'ligne.pdf', v_mayer || '/' || v_prod2 || '/ligne.pdf') RETURNING id INTO v_doc_ligne;
  ok := false;
  BEGIN
    PERFORM public.catalog_item_create_for_product(v_prod2);
  EXCEPTION WHEN insufficient_privilege THEN ok := (SQLERRM = 'articles_edit_required');
  END;
  IF NOT ok THEN RAISE EXCEPTION 'commercial : catalog_item_create_for_product accepté'; END IF;
  ok := false;
  BEGIN
    PERFORM public.catalog_item_attach(v_prod2, v_item);
  EXCEPTION WHEN insufficient_privilege THEN ok := (SQLERRM = 'articles_edit_required');
  END;
  IF NOT ok THEN RAISE EXCEPTION 'commercial : catalog_item_attach accepté'; END IF;
  ok := false;
  BEGIN
    PERFORM public.catalog_item_detach(v_prod1);
  EXCEPTION WHEN insufficient_privilege THEN ok := (SQLERRM = 'articles_edit_required');
  END;
  IF NOT ok THEN RAISE EXCEPTION 'commercial : catalog_item_detach accepté'; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE id = v_item AND name = 'TEST DROITS Article TL') THEN
    RAISE EXCEPTION 'commercial : l''article a changé';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.product_documents WHERE id = v_doc AND file_name = 'tl2.pdf') THEN
    RAISE EXCEPTION 'commercial : un document d''article a été modifié ou retiré';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE id = v_prod2 AND catalog_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'commercial : la ligne a été rattachée malgré le refus';
  END IF;

  -- ── 3. technicien : lecture seule ──────────────────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  IF public.user_can(v_mayer, 'articles', 'view') IS NOT TRUE OR public.user_can(v_mayer, 'articles', 'edit') IS NOT FALSE THEN
    RAISE EXCEPTION 'technicien : verdict articles inattendu (view vrai, edit faux attendus)';
  END IF;
  RESET ROLE;

  -- ── 4. non authentifié ─────────────────────────────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF public.user_can(v_mayer, 'articles', 'view') IS NOT FALSE THEN RAISE EXCEPTION 'user_can non authentifié : faux attendu (jamais NULL)'; END IF;
  ok := false;
  BEGIN
    PERFORM public.catalog_item_create_for_product(v_prod2);
  EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM; ok := (v_err = 'not_authenticated');
  END;
  IF NOT ok THEN RAISE EXCEPTION 'non authentifié : create_for_product non refusé par not_authenticated (%)', v_err; END IF;
  RESET ROLE;

  -- ── 5. anon : pas d'EXECUTE (refus effectif, pas seulement l'ACL lue) ─────────────────────────────────
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN
    PERFORM public.user_can(v_mayer, 'articles', 'view');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'anon peut exécuter public.user_can'; END IF;
  ok := false;
  BEGIN
    PERFORM public.catalog_item_create_for_product(v_prod2);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'anon peut exécuter catalog_item_create_for_product'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ── nettoyage ──────────────────────────────────────────────────────────────────────────────────────────
  DELETE FROM majordhome.product_documents WHERE id IN (v_doc, v_doc_ligne);
  UPDATE majordhome.supplier_products SET catalog_item_id = NULL WHERE supplier_id IN (v_sup, v_sup_autre);
  DELETE FROM majordhome.supplier_products WHERE supplier_id IN (v_sup, v_sup_autre);
  DELETE FROM majordhome.catalog_items WHERE id IN (v_item, v_item_autre, v_ins, v_new, v_new2);
  DELETE FROM majordhome.suppliers WHERE id IN (v_sup, v_sup_autre);

  RAISE NOTICE 'assert-articles-droits : OK';
END $$;
