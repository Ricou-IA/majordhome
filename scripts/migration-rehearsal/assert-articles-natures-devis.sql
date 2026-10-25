-- assert-articles-natures-devis.sql — vérifie 20261027_1_articles_natures_devis.sql (après 20261026_1/_2/_3).
-- Couvre : natures d'article (CHECK), création d'article par l'org_admin seul via la vue miroir, marque sur la ligne
-- de devis (colonne en fin des vues), marque exposée par la vue des offres, champ de recherche de la vue liste
-- (minuscules, sans accents, références des lignes fournisseur). Fixture nettoyée en fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_membre uuid;
  v_sup uuid; v_item uuid; v_n int; ok boolean; v_p record;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer AND role <> 'org_admin' LIMIT 1;

  -- (1) structure : brand en dernière colonne des vues de lignes de devis ; brand dans les offres ; recherche dans la liste
  SELECT column_name INTO v_p FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_quote_lines_write' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_p.column_name <> 'brand' THEN RAISE EXCEPTION 'brand n''est pas la dernière colonne de majordhome_quote_lines_write (%)', v_p.column_name; END IF;
  SELECT column_name INTO v_p FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_quote_lines' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_p.column_name <> 'brand' THEN RAISE EXCEPTION 'brand n''est pas la dernière colonne de majordhome_quote_lines (%)', v_p.column_name; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_catalog_item_offers' AND column_name = 'brand') THEN RAISE EXCEPTION 'brand absente des offres'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_catalog_items_list' AND column_name = 'recherche') THEN RAISE EXCEPTION 'recherche absente de la liste'; END IF;
  IF has_table_privilege('anon', 'majordhome.catalog_items', 'INSERT') THEN RAISE EXCEPTION 'anon insère des articles'; END IF;

  -- (2) natures : stock et main_oeuvre acceptées, valeur inconnue refusée
  ok := false;
  BEGIN INSERT INTO majordhome.catalog_items (org_id, name, product_kind) VALUES (v_mayer, 'TEST NATURE', 'bidule'); EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'nature inconnue acceptée'; END IF;

  -- (3) création par la vue miroir : membre refusé, admin accepté
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  ok := false;
  BEGIN INSERT INTO public.majordhome_catalog_items (org_id, name, product_kind, origin) VALUES (v_mayer, 'TEST ART MEMBRE', 'stock', 'manuel');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un membre non admin a créé un article'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  INSERT INTO public.majordhome_catalog_items (org_id, name, product_kind, origin, unit, selling_price_ht)
  VALUES (v_mayer, 'Pose borne 7,4 kW monophasé', 'main_oeuvre', 'manuel', 'forfait', 450) RETURNING id INTO v_item;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT * INTO v_p FROM public.majordhome_catalog_items_list WHERE id = v_item;
  IF v_p.product_kind <> 'main_oeuvre' OR v_p.offres_total <> 0 OR v_p.selling_price_ht <> 450 THEN RAISE EXCEPTION 'article de main d''œuvre : % % %', v_p.product_kind, v_p.offres_total, v_p.selling_price_ht; END IF;
  IF v_p.recherche NOT LIKE '%pose borne 7,4 kw monophase%' THEN RAISE EXCEPTION 'recherche sans accents ni majuscules : %', v_p.recherche; END IF;

  -- (4) offres : marque exposée ; recherche porte les références des lignes
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST NATURES SUP', true) RETURNING id INTO v_sup;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, purchase_price_ht, category, catalog_item_id, catalog_item_link_source)
  VALUES (v_sup, v_mayer, 'HAG-MFN716', 'Disjoncteur 1P+N 16A courbe C', 'Hager', 9.8, NULL, v_item, 'manuel');
  SELECT * INTO v_p FROM public.majordhome_catalog_item_offers WHERE item_id = v_item;
  IF v_p.brand <> 'Hager' THEN RAISE EXCEPTION 'marque de l''offre : %', v_p.brand; END IF;
  SELECT * INTO v_p FROM public.majordhome_catalog_items_list WHERE id = v_item;
  IF v_p.recherche NOT LIKE '%hag-mfn716%' THEN RAISE EXCEPTION 'référence fournisseur absente de la recherche : %', v_p.recherche; END IF;

  -- nettoyage
  DELETE FROM majordhome.supplier_products WHERE supplier_id = v_sup;
  DELETE FROM majordhome.suppliers WHERE id = v_sup;
  DELETE FROM majordhome.catalog_items WHERE id = v_item;

  RAISE NOTICE 'assert-articles-natures-devis : OK';
END $$;
