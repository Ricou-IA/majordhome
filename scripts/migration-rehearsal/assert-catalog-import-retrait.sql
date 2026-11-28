-- assert-catalog-import-retrait.sql — vérifie 20261129_3 (aperçu et retrait d'un import d'articles) sur le cluster de
-- répétition. Autonome : crée ses fournisseurs, ses imports, ses articles et ses devis dans Mayer (A). Chaque écart lève
-- une exception. Membres relevés dans le snapshot du 2026-11-22 :
--   A = Mayer 3c68193e… : org_admin 8a4907a3…, team_leader 6c3a9488…
--   B = Cimaj 62cd2073… : org_admin 8ebd6637…
-- Chaîne à rejouer : 20261028_4 → 20261124_2 → 20261129_2 → 20261129_3.
-- Se mettre à la place d'un membre : request.jwt.claim.sub (stub auth.uid() du harnais) + request.jwt.claims
-- (forme de la prod) puis SET LOCAL ROLE authenticated.

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

CREATE OR REPLACE FUNCTION public.zz_identite(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
END $$;
GRANT EXECUTE ON FUNCTION public.zz_identite(uuid) TO authenticated, anon;

-- ── Clés étrangères et index de production absents du snapshot ───────────────
-- Le snapshot du 2026-11-22 n'a pas les trois clés étrangères vers catalog_items posées par 20261026_1 (supplier_products,
-- quote_lines) et 20261027_2 (product_documents) : le retrait les lit dans pg_constraint, on les recrée telles que les
-- migrations les écrivent. Index : mêmes définitions de production que assert-catalog-import.sql.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND conrelid = 'majordhome.supplier_products'::regclass AND confrelid = 'majordhome.catalog_items'::regclass) THEN
    ALTER TABLE majordhome.supplier_products ADD CONSTRAINT supplier_products_catalog_item_id_fkey FOREIGN KEY (catalog_item_id) REFERENCES majordhome.catalog_items(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND conrelid = 'majordhome.quote_lines'::regclass AND confrelid = 'majordhome.catalog_items'::regclass) THEN
    ALTER TABLE majordhome.quote_lines ADD CONSTRAINT quote_lines_catalog_item_id_fkey FOREIGN KEY (catalog_item_id) REFERENCES majordhome.catalog_items(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND conrelid = 'majordhome.product_documents'::regclass AND confrelid = 'majordhome.catalog_items'::regclass) THEN
    ALTER TABLE majordhome.product_documents ADD CONSTRAINT product_documents_catalog_item_id_fkey FOREIGN KEY (catalog_item_id) REFERENCES majordhome.catalog_items(id) ON DELETE CASCADE;
  END IF;
END $$;
-- Propositions de l'aspirateur (20261129_1, hors snapshot) : recréées minimalement si absentes. Comme en production,
-- catalog_item_id n'y porte AUCUNE clé étrangère.
CREATE TABLE IF NOT EXISTS majordhome.catalogue_propositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  reference text NOT NULL DEFAULT 'x',
  catalog_item_id uuid NULL
);
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

-- ── 1. Structure et droits ────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.catalog_items_import_removal_preview(uuid)',
    'public.catalog_items_import_remove(uuid, integer)'
  ] LOOP
    IF to_regprocedure(f) IS NULL THEN RAISE EXCEPTION '% absente', f; END IF;
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
  f := 'majordhome.catalog_import_retirables(uuid, boolean)';
  IF to_regprocedure(f) IS NULL THEN RAISE EXCEPTION '% absente', f; END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'interne % exécutable hors du propriétaire', f;
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN RAISE EXCEPTION 'interne % ne doit pas être SECURITY DEFINER', f; END IF;
  -- Index des clés étrangères parcourues à chaque suppression
  IF to_regclass('majordhome.catalog_items_merged_into_idx') IS NULL OR to_regclass('majordhome.catalog_items_source_product_idx') IS NULL
     OR to_regclass('majordhome.supplier_products_variant_of_idx') IS NULL THEN
    RAISE EXCEPTION 'index merged_into / source_product_id / variant_of absents';
  END IF;
  RAISE NOTICE '§1 structure et droits : OK';
END $$;

-- ── Données : un import de 5 articles (org_admin de A) ───────────────────────
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_sa    uuid; v_snew uuid; v_imp uuid; v_quote uuid; r jsonb;
  f2 jsonb; f3 jsonb; f4 jsonb;
BEGIN
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_a, 'ZZ RETRAIT EXISTANT', true) RETURNING id INTO v_sa;
  -- Ligne d'un autre relevé du même fournisseur : ne doit jamais bouger
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht, purchase_price_at, is_active, specs)
  VALUES (v_sa, v_a, 'AUTRE-1', 'Ligne d''un relevé', 50, '2026-01-01T00:00:00Z', true, '{"source_version": "releve-ancien"}');

  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_start(v_a, 'retrait.xlsx', '{}', '{"lues": 5}',
         jsonb_build_array(jsonb_build_object('nom', 'ZZ RETRAIT EXISTANT', 'supplier_id', v_sa),
                           jsonb_build_object('nom', 'ZZ Retrait Nouveau', 'supplier_id', NULL)));
  v_imp := (r ->> 'import_id')::uuid;
  v_snew := (r -> 'fournisseurs' -> 1 ->> 'supplier_id')::uuid;
  f2 := jsonb_build_object('supplier_id', v_snew, 'reference', 'R-CITE', 'purchase_price_ht', 10, 'tarif_public', NULL, 'purchase_price_at', NULL);
  f3 := jsonb_build_object('supplier_id', v_sa, 'reference', 'R-REPRIS', 'purchase_price_ht', 20, 'tarif_public', NULL, 'purchase_price_at', NULL);
  f4 := jsonb_build_object('supplier_id', v_sa, 'reference', 'R-JAMAIS', 'purchase_price_ht', 30, 'tarif_public', NULL, 'purchase_price_at', NULL);
  r := public.catalog_items_import_batch(v_imp, jsonb_build_array(
    jsonb_build_object('import_line', 2, 'name', 'Article cité', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 100, 'fournisseur', f2),
    jsonb_build_object('import_line', 3, 'name', 'Article repris', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 100, 'fournisseur', f3),
    jsonb_build_object('import_line', 4, 'name', 'Article jamais repris', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 100, 'fournisseur', f4),
    jsonb_build_object('import_line', 5, 'name', 'Sans fournisseur 1', 'product_kind', 'main_oeuvre', 'default_tva_rate', 10, 'selling_price_ht', 50),
    jsonb_build_object('import_line', 6, 'name', 'Sans fournisseur 2', 'product_kind', 'accessory', 'default_tva_rate', 20, 'selling_price_ht', 5)));
  IF r IS DISTINCT FROM '{"created": 5, "skipped": 0, "lignes_fournisseur": 3}'::jsonb THEN RAISE EXCEPTION 'batch : %', r; END IF;
  PERFORM public.catalog_items_import_finish(v_imp, '{"lues": 5, "importees": 5}');
  SET LOCAL ROLE postgres;

  -- Article cité par une ligne de devis
  INSERT INTO majordhome.quotes (org_id, quote_number) VALUES (v_a, 'ZZ-RETRAIT-1') RETURNING id INTO v_quote;
  INSERT INTO majordhome.quote_lines (quote_id, designation, catalog_item_id)
  SELECT v_quote, 'Ligne citant l''article', id FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 2;

  -- Ligne R-REPRIS reprise par un relevé (autre source_version)
  SET LOCAL ROLE service_role;
  r := public.supplier_catalog_upsert(v_a, v_sa, 'releve-2026-12', jsonb_build_array(
         jsonb_build_object('reference', 'R-REPRIS', 'name', 'Libellé du site', 'purchase_price_ht', 19,
                            'specs', jsonb_build_object('source_version', 'releve-2026-12'))),
         '{"desactiver_absents": false}'::jsonb);
  IF (r ->> 'mis_a_jour')::int <> 1 THEN RAISE EXCEPTION 'relevé R-REPRIS : %', r; END IF;
  SET LOCAL ROLE postgres;

  PERFORM set_config('test.imp', v_imp::text, false);
  PERFORM set_config('test.sa', v_sa::text, false);
  PERFORM set_config('test.snew', v_snew::text, false);
END $$;

-- Deuxième import, même fournisseur (v_sa) : ne doit pas bouger quand on retire le premier
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_sa    uuid := current_setting('test.sa')::uuid;
  v_imp2  uuid; r jsonb;
BEGIN
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_start(v_a, 'autre-import.xlsx', '{}', '{}', '[]');
  v_imp2 := (r ->> 'import_id')::uuid;
  r := public.catalog_items_import_batch(v_imp2, jsonb_build_array(
    jsonb_build_object('import_line', 2, 'name', 'Autre import 1', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 1,
      'fournisseur', jsonb_build_object('supplier_id', v_sa, 'reference', 'R-IMPORT-2', 'purchase_price_ht', 1, 'tarif_public', NULL, 'purchase_price_at', NULL)),
    jsonb_build_object('import_line', 3, 'name', 'Autre import 2', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 1)));
  IF (r ->> 'created')::int <> 2 THEN RAISE EXCEPTION 'deuxième import : %', r; END IF;
  SET LOCAL ROLE postgres;
  PERFORM set_config('test.imp2', v_imp2::text, false);
END $$;

-- ── 2. Refus d'accès (rien n'est retiré) ─────────────────────────────────────
DO $$
DECLARE
  v_a       uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_a_tl    uuid := '6c3a9488-92ee-42cc-b010-6646ca299139';
  v_admin   uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_b_admin uuid := '8ebd6637-489e-473e-9583-807ab1e3154e';
  v_imp     uuid := current_setting('test.imp')::uuid;
  u uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  -- team_leader de A, org_admin de B
  FOREACH u IN ARRAY ARRAY[v_a_tl, v_b_admin] LOOP
    PERFORM public.zz_identite(u);
    PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_removal_preview(%L)$q$, v_imp), 'org_admin_required', '42501');
    PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_remove(%L, 100)$q$, v_imp), 'org_admin_required', '42501');
  END LOOP;
  -- Sans identité
  PERFORM public.zz_identite(NULL);
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_removal_preview(%L)$q$, v_imp), 'unauthenticated', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_remove(%L, 100)$q$, v_imp), 'unauthenticated', '42501');
  -- Import inconnu
  PERFORM public.zz_identite(v_admin);
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_removal_preview(%L)$q$, gen_random_uuid()), 'import_not_found', 'P0002');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_remove(%L, 100)$q$, gen_random_uuid()), 'import_not_found', 'P0002');
  -- anon
  SET LOCAL ROLE postgres;
  SET LOCAL ROLE anon;
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_remove(%L, 100)$q$, v_imp), 'permission denied for function catalog_items_import_remove', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_removal_preview(%L)$q$, v_imp), 'permission denied for function catalog_items_import_removal_preview', '42501');
  SET LOCAL ROLE postgres;
  -- Fonction interne : pas pour authenticated
  SET LOCAL ROLE authenticated;
  PERFORM public.zz_assert_erreur(format($q$SELECT majordhome.catalog_import_retirables(%L)$q$, v_imp), 'permission denied for function catalog_import_retirables', '42501');
  SET LOCAL ROLE postgres;
  -- org_admin de A suspendu : refusé (adhésion active exigée)
  UPDATE core.organization_members SET status = 'suspended' WHERE org_id = v_a AND user_id = v_admin;
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_removal_preview(%L)$q$, v_imp), 'org_admin_required', '42501');
  PERFORM public.zz_assert_erreur(format($q$SELECT public.catalog_items_import_remove(%L, 100)$q$, v_imp), 'org_admin_required', '42501');
  SET LOCAL ROLE postgres;
  UPDATE core.organization_members SET status = 'active' WHERE org_id = v_a AND user_id = v_admin;

  IF (SELECT count(*) FROM majordhome.catalog_items WHERE import_id = v_imp) <> 5 THEN RAISE EXCEPTION 'un refus a retiré un article'; END IF;
  IF (SELECT status FROM majordhome.catalog_imports WHERE id = v_imp) <> 'termine' THEN RAISE EXCEPTION 'un refus a changé le statut'; END IF;
  RAISE NOTICE '§2 refus d''accès : OK';
END $$;

-- ── 3. Aperçu puis retrait en deux lots de 2 ─────────────────────────────────
DO $$
DECLARE
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_imp   uuid := current_setting('test.imp')::uuid;
  v_sa    uuid := current_setting('test.sa')::uuid;
  v_snew  uuid := current_setting('test.snew')::uuid;
  v_imp2  uuid := current_setting('test.imp2')::uuid;
  v_b     uuid := '62cd2073-96e0-4300-adae-4c1bb8934546';
  r jsonb; r2 jsonb; r3 jsonb; i record; l record; v_autre jsonb; v_imp2_avant text; v_b_avant text;
BEGIN
  SELECT to_jsonb(p) INTO v_autre FROM majordhome.supplier_products p WHERE supplier_id = v_sa AND reference = 'AUTRE-1';
  -- Photos : deuxième import (import, articles, lignes) et toute l'org B (articles, lignes)
  SELECT md5(coalesce((SELECT to_jsonb(x)::text FROM majordhome.catalog_imports x WHERE id = v_imp2), '')
           || coalesce((SELECT string_agg(to_jsonb(c)::text, '|' ORDER BY c.id) FROM majordhome.catalog_items c WHERE c.import_id = v_imp2), '')
           || coalesce((SELECT string_agg(to_jsonb(p)::text, '|' ORDER BY p.id) FROM majordhome.supplier_products p
                         JOIN majordhome.catalog_items c ON c.id = p.catalog_item_id WHERE c.import_id = v_imp2), '')) INTO v_imp2_avant;
  SELECT md5(coalesce((SELECT string_agg(to_jsonb(c)::text, '|' ORDER BY c.id) FROM majordhome.catalog_items c WHERE c.org_id = v_b), '')
           || coalesce((SELECT string_agg(to_jsonb(p)::text, '|' ORDER BY p.id) FROM majordhome.supplier_products p WHERE p.org_id = v_b), '')) INTO v_b_avant;
  IF (SELECT count(*) FROM majordhome.catalog_items WHERE import_id = v_imp2) <> 2 THEN RAISE EXCEPTION 'deuxième import : 2 articles attendus'; END IF;
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_removal_preview(v_imp);
  IF r IS DISTINCT FROM '{"retirables": 3, "conservees": 2}'::jsonb THEN RAISE EXCEPTION 'aperçu : % (3 retirables, 2 conservées attendus)', r; END IF;
  r := public.catalog_items_import_remove(v_imp, 2);
  r2 := public.catalog_items_import_remove(v_imp, 2);
  r3 := public.catalog_items_import_remove(v_imp, 2);
  SET LOCAL ROLE postgres;
  IF r IS DISTINCT FROM '{"retirees": 2, "conservees": 2, "restantes": 1}'::jsonb THEN RAISE EXCEPTION 'retrait 1 : %', r; END IF;
  IF r2 IS DISTINCT FROM '{"retirees": 1, "conservees": 2, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'retrait 2 : %', r2; END IF;
  IF r3 IS DISTINCT FROM '{"retirees": 0, "conservees": 2, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'retrait 3 (rien à retirer) : %', r3; END IF;

  SELECT * INTO i FROM majordhome.catalog_imports WHERE id = v_imp;
  -- Deux articles conservés : l'import reste « termine », sans removed_at / removed_by
  IF i.status <> 'termine' OR i.removed_at IS NOT NULL OR i.removed_by IS NOT NULL THEN
    RAISE EXCEPTION 'import à articles conservés : statut « termine » sans removed_* attendu : %', row_to_json(i);
  END IF;
  IF (i.counts ->> 'retirees')::int <> 3 OR (i.counts ->> 'conservees')::int <> 2 OR (i.counts ->> 'importees')::int <> 5 THEN
    RAISE EXCEPTION 'counts : %', i.counts;
  END IF;

  -- Restent : l'article cité et l'article repris
  IF (SELECT string_agg(name, ',' ORDER BY import_line) FROM majordhome.catalog_items WHERE import_id = v_imp) IS DISTINCT FROM 'Article cité,Article repris' THEN
    RAISE EXCEPTION 'articles restants : %', (SELECT string_agg(name, ',' ORDER BY import_line) FROM majordhome.catalog_items WHERE import_id = v_imp);
  END IF;
  SELECT * INTO l FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'R-REPRIS';
  IF l.id IS NULL OR NOT l.is_active OR l.catalog_item_id IS DISTINCT FROM (SELECT id FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 3) THEN
    RAISE EXCEPTION 'ligne reprise perdue ou détachée : %', row_to_json(l);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE supplier_id = v_snew AND reference = 'R-CITE'
                  AND catalog_item_id = (SELECT id FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 2)) THEN
    RAISE EXCEPTION 'ligne de l''article cité retirée';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'R-JAMAIS') THEN RAISE EXCEPTION 'ligne jamais reprise encore là'; END IF;
  IF (SELECT to_jsonb(p) FROM majordhome.supplier_products p WHERE supplier_id = v_sa AND reference = 'AUTRE-1') IS DISTINCT FROM v_autre THEN
    RAISE EXCEPTION 'ligne d''un autre relevé touchée';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.suppliers WHERE id = v_snew) OR NOT EXISTS (SELECT 1 FROM majordhome.suppliers WHERE id = v_sa) THEN
    RAISE EXCEPTION 'un fournisseur a été supprimé';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.quote_lines WHERE designation = 'Ligne citant l''article' AND catalog_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ligne de devis détachée';
  END IF;
  -- Isolation : le deuxième import du même fournisseur et l'org B n'ont pas bougé
  IF md5(coalesce((SELECT to_jsonb(x)::text FROM majordhome.catalog_imports x WHERE id = v_imp2), '')
       || coalesce((SELECT string_agg(to_jsonb(c)::text, '|' ORDER BY c.id) FROM majordhome.catalog_items c WHERE c.import_id = v_imp2), '')
       || coalesce((SELECT string_agg(to_jsonb(p)::text, '|' ORDER BY p.id) FROM majordhome.supplier_products p
                     JOIN majordhome.catalog_items c ON c.id = p.catalog_item_id WHERE c.import_id = v_imp2), '')) IS DISTINCT FROM v_imp2_avant THEN
    RAISE EXCEPTION 'le deuxième import (même fournisseur) a été touché';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'R-IMPORT-2') THEN RAISE EXCEPTION 'ligne du deuxième import supprimée'; END IF;
  IF md5(coalesce((SELECT string_agg(to_jsonb(c)::text, '|' ORDER BY c.id) FROM majordhome.catalog_items c WHERE c.org_id = v_b), '')
       || coalesce((SELECT string_agg(to_jsonb(p)::text, '|' ORDER BY p.id) FROM majordhome.supplier_products p WHERE p.org_id = v_b), '')) IS DISTINCT FROM v_b_avant THEN
    RAISE EXCEPTION 'l''org B a été touchée';
  END IF;
  RAISE NOTICE '§3 aperçu et retrait, isolation : OK';
END $$;

-- ── 4. Fusion dans le même import (aperçu = point fixe) ; ligne citée par un devis ; article cité par l'aspirateur ──
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_sa    uuid := current_setting('test.sa')::uuid;
  v_imp   uuid; v_x uuid; v_y uuid; v_quote uuid; v_asp uuid; r jsonb; r2 jsonb; r3 jsonb;
BEGIN
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_start(v_a, 'retrait-2.csv', '{}', '{}', '[]');
  v_imp := (r ->> 'import_id')::uuid;
  r := public.catalog_items_import_batch(v_imp, jsonb_build_array(
    jsonb_build_object('import_line', 2, 'name', 'Absorbé', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 1),
    jsonb_build_object('import_line', 3, 'name', 'Survivant', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 1),
    jsonb_build_object('import_line', 4, 'name', 'Ligne citée', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 1,
      'fournisseur', jsonb_build_object('supplier_id', v_sa, 'reference', 'R-LIGNE-CITEE', 'purchase_price_ht', 1, 'tarif_public', NULL, 'purchase_price_at', NULL)),
    jsonb_build_object('import_line', 5, 'name', 'Proposé', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 1)));
  SET LOCAL ROLE postgres;
  -- Proposition de l'aspirateur qui cite l'article (colonne sans clé étrangère) : l'article est conservé
  IF to_regclass('majordhome.aspirations') IS NOT NULL THEN
    -- Vraie table (20261129_1 dans la chaîne) : une aspiration, puis une proposition complète
    EXECUTE format('INSERT INTO majordhome.aspirations (org_id, supplier_id, domaine, genre, plafond_usd) VALUES (%L, %L, %L, %L, 1) RETURNING id',
                   v_a, v_sa, 'exemple.fr', 'aspiration') INTO v_asp;
    EXECUTE format('INSERT INTO majordhome.catalogue_propositions (org_id, supplier_id, aspiration_id, reference, catalog_item_id, genre, provenance)'
                   ' SELECT %L, %L, %L, %L, id, %L, %L FROM majordhome.catalog_items WHERE import_id = %L AND import_line = 5',
                   v_a, v_sa, v_asp, 'R-PROPOSE', 'caracteristique', 'public', v_imp);
  ELSE
    EXECUTE format('INSERT INTO majordhome.catalogue_propositions (org_id, reference, catalog_item_id) SELECT %L, %L, id FROM majordhome.catalog_items WHERE import_id = %L AND import_line = 5',
                   v_a, 'R-PROPOSE', v_imp);
  END IF;
  SELECT id INTO v_x FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 2;
  SELECT id INTO v_y FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line = 3;
  UPDATE majordhome.catalog_items SET merged_into = v_y, is_active = false WHERE id = v_x;
  -- Un devis cite la LIGNE fournisseur (pas l'article) : l'article est conservé
  INSERT INTO majordhome.quotes (org_id, quote_number) VALUES (v_a, 'ZZ-RETRAIT-2') RETURNING id INTO v_quote;
  INSERT INTO majordhome.quote_lines (quote_id, designation, supplier_product_id)
  SELECT v_quote, 'Ligne citant la ligne fournisseur', id FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'R-LIGNE-CITEE';

  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_removal_preview(v_imp);
  -- Point fixe : l'absorbé, puis le survivant qu'il libère ; conservés : la ligne citée et l'article proposé
  IF r IS DISTINCT FROM '{"retirables": 2, "conservees": 2}'::jsonb THEN RAISE EXCEPTION 'aperçu fusion (point fixe) : %', r; END IF;
  -- Premier appel : l'absorbé part ; le survivant, libéré, est recompté (restantes 1)
  r := public.catalog_items_import_remove(v_imp, 100);
  r2 := public.catalog_items_import_remove(v_imp, 100);
  SET LOCAL ROLE postgres;
  IF r IS DISTINCT FROM '{"retirees": 1, "conservees": 2, "restantes": 1}'::jsonb THEN RAISE EXCEPTION 'fusion retrait 1 : %', r; END IF;
  IF r2 IS DISTINCT FROM '{"retirees": 1, "conservees": 2, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'fusion retrait 2 : %', r2; END IF;
  -- L'aperçu annonçait exactement ce qui a été retiré
  IF (r ->> 'retirees')::int + (r2 ->> 'retirees')::int <> 2 THEN RAISE EXCEPTION 'aperçu ≠ retiré'; END IF;
  IF (SELECT status FROM majordhome.catalog_imports WHERE id = v_imp) <> 'en_cours' THEN RAISE EXCEPTION 'import fusion (un article conservé) : statut changé'; END IF;
  IF (SELECT string_agg(name, ',' ORDER BY import_line) FROM majordhome.catalog_items WHERE import_id = v_imp) IS DISTINCT FROM 'Ligne citée,Proposé' THEN
    RAISE EXCEPTION 'articles restants : %', (SELECT string_agg(name, ',' ORDER BY import_line) FROM majordhome.catalog_items WHERE import_id = v_imp);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'R-LIGNE-CITEE' AND catalog_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ligne citée par un devis supprimée ou détachée';
  END IF;
  IF (SELECT supplier_product_id FROM majordhome.quote_lines WHERE designation = 'Ligne citant la ligne fournisseur') IS NULL THEN RAISE EXCEPTION 'devis détaché de la ligne'; END IF;
  RAISE NOTICE '§4 fusion (point fixe), ligne citée, proposition de l''aspirateur : OK';
END $$;

-- ── 5. Tout est retirable : l'import passe à « retire » ───────────────────────
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_sa    uuid := current_setting('test.sa')::uuid;
  v_imp   uuid; r jsonb; r2 jsonb; i record;
BEGIN
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r := public.catalog_items_import_start(v_a, 'retrait-3.csv', '{}', '{"lues": 3}', '[]');
  v_imp := (r ->> 'import_id')::uuid;
  r := public.catalog_items_import_batch(v_imp, jsonb_build_array(
    jsonb_build_object('import_line', 2, 'name', 'Tout part 1', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 1,
      'fournisseur', jsonb_build_object('supplier_id', v_sa, 'reference', 'R-TOUT-1', 'purchase_price_ht', 1, 'tarif_public', NULL, 'purchase_price_at', NULL)),
    jsonb_build_object('import_line', 3, 'name', 'Tout part 2', 'product_kind', 'main', 'default_tva_rate', 20, 'selling_price_ht', 1),
    jsonb_build_object('import_line', 4, 'name', 'Tout part 3', 'product_kind', 'accessory', 'default_tva_rate', 20, 'selling_price_ht', 1)));
  PERFORM public.catalog_items_import_finish(v_imp, '{"lues": 3, "importees": 3}');
  r := public.catalog_items_import_removal_preview(v_imp);
  IF r IS DISTINCT FROM '{"retirables": 3, "conservees": 0}'::jsonb THEN RAISE EXCEPTION 'aperçu tout retirable : %', r; END IF;
  r := public.catalog_items_import_remove(v_imp, 2);
  SET LOCAL ROLE postgres;
  IF r IS DISTINCT FROM '{"retirees": 2, "conservees": 0, "restantes": 1}'::jsonb THEN RAISE EXCEPTION 'tout retirable 1 : %', r; END IF;
  SELECT * INTO i FROM majordhome.catalog_imports WHERE id = v_imp;
  IF i.status <> 'termine' OR i.removed_at IS NOT NULL THEN RAISE EXCEPTION 'retire posé avant la fin : %', row_to_json(i); END IF;
  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  r2 := public.catalog_items_import_remove(v_imp, 2);
  SET LOCAL ROLE postgres;
  IF r2 IS DISTINCT FROM '{"retirees": 1, "conservees": 0, "restantes": 0}'::jsonb THEN RAISE EXCEPTION 'tout retirable 2 : %', r2; END IF;
  SELECT * INTO i FROM majordhome.catalog_imports WHERE id = v_imp;
  IF i.status <> 'retire' OR i.removed_at IS NULL OR i.removed_by IS DISTINCT FROM v_admin
     OR (i.counts ->> 'retirees')::int <> 3 OR (i.counts ->> 'conservees')::int <> 0 THEN
    RAISE EXCEPTION 'import vide non passé à retire : %', row_to_json(i);
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE import_id = v_imp)
     OR EXISTS (SELECT 1 FROM majordhome.supplier_products WHERE supplier_id = v_sa AND reference = 'R-TOUT-1') THEN
    RAISE EXCEPTION 'article ou ligne restés';
  END IF;
  RAISE NOTICE '§5 tout retirable ⇒ retire : OK';
END $$;

-- ── Mesure : retrait de 300 articles (TAILLE_LOT_RETRAIT_ARTICLES) d'un import de 20 000 (10 000 avec ligne
--    fournisseur), base au volume de la prod ──
DO $$
DECLARE
  v_a     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid := '8a4907a3-f382-4707-bc38-2ff4832f873a';
  v_fill  uuid; v_sup uuid; v_item uuid; v_imp uuid; t0 timestamptz; d_ap numeric; d1 numeric; d2 numeric; r jsonb; r2 jsonb; ap jsonb;
BEGIN
  -- Volume : ~27 000 articles et ~31 000 lignes fournisseur rattachées (prod, 2026-11-28)
  INSERT INTO majordhome.suppliers (org_id, name) VALUES (v_a, 'ZZ VOLUME RETRAIT') RETURNING id INTO v_fill;
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, code, origin)
  SELECT v_a, 'Volume ' || g, 'MARQUE ' || (g % 50), 'mk' || g, 'VOLR-' || g, 'auto' FROM generate_series(1, 27000) g;
  SELECT id INTO v_item FROM majordhome.catalog_items WHERE org_id = v_a AND code = 'VOLR-1';
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht, purchase_price_at, catalog_item_id, specs)
  SELECT v_fill, v_a, 'VREFR-' || g, 'Ligne ' || g, 10, now(), v_item, '{"source_version": "volume"}'::jsonb FROM generate_series(1, 31000) g;

  -- Import simulé de 20 000 articles (écrit directement : on mesure le retrait, pas l'écriture)
  INSERT INTO majordhome.catalog_imports (org_id, created_by, file_name, status) VALUES (v_a, v_admin, 'volume.xlsx', 'termine') RETURNING id INTO v_imp;
  INSERT INTO majordhome.suppliers (org_id, name) VALUES (v_a, 'ZZ VOLUME IMPORT') RETURNING id INTO v_sup;
  INSERT INTO majordhome.catalog_items (org_id, name, origin, import_id, import_line)
  SELECT v_a, 'Importé ' || g, 'manuel', v_imp, g FROM generate_series(1, 20000) g;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, purchase_price_ht, catalog_item_id, catalog_item_link_source, catalog_item_linked_at, specs)
  SELECT v_sup, v_a, 'IMPR-' || i.import_line, i.name, 5, i.id, 'import', now(), jsonb_build_object('source_version', 'import-articles_' || v_imp)
    FROM majordhome.catalog_items i WHERE i.import_id = v_imp AND i.import_line % 2 = 0;
  ANALYZE majordhome.catalog_items;
  ANALYZE majordhome.supplier_products;
  ANALYZE majordhome.quote_lines;

  PERFORM public.zz_identite(v_admin);
  SET LOCAL ROLE authenticated;
  t0 := clock_timestamp();
  ap := public.catalog_items_import_removal_preview(v_imp);
  d_ap := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  t0 := clock_timestamp();
  r := public.catalog_items_import_remove(v_imp, 300);
  d1 := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  t0 := clock_timestamp();
  r2 := public.catalog_items_import_remove(v_imp, 300);
  d2 := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
  SET LOCAL ROLE postgres;
  IF ap IS DISTINCT FROM '{"retirables": 20000, "conservees": 0}'::jsonb THEN RAISE EXCEPTION 'mesure aperçu : %', ap; END IF;
  IF r IS DISTINCT FROM '{"retirees": 300, "conservees": 0, "restantes": 19700}'::jsonb THEN RAISE EXCEPTION 'mesure retrait : %', r; END IF;
  IF r2 IS DISTINCT FROM '{"retirees": 300, "conservees": 0, "restantes": 19400}'::jsonb THEN RAISE EXCEPTION 'mesure retrait 2 : %', r2; END IF;
  IF (SELECT count(*) FROM majordhome.supplier_products WHERE supplier_id = v_sup)
     <> (SELECT count(*) FROM majordhome.catalog_items WHERE import_id = v_imp AND import_line % 2 = 0) THEN
    RAISE EXCEPTION 'mesure : les lignes fournisseur ne suivent pas leurs articles';
  END IF;
  IF (SELECT count(*) FROM majordhome.catalog_items WHERE import_id = v_imp) <> 19400 THEN RAISE EXCEPTION 'mesure : 19 400 articles attendus'; END IF;
  RAISE NOTICE 'MESURE duree_ms import de 20 000 : aperçu = % ; remove(…, 300) = % puis % (déclencheur recherche actif : %)', d_ap, d1, d2,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'majordhome.supplier_products'::regclass AND tgname = 'trg_supplier_products_recherche_del');
  IF d1 > 2000 OR d2 > 2000 THEN RAISE EXCEPTION 'mesure au-dessus de 2 000 ms : % / %', d1, d2; END IF;
END $$;

DROP FUNCTION public.zz_assert_erreur(text, text, text, text);
DROP FUNCTION public.zz_identite(uuid);
