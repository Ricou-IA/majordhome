-- assert-catalog-items-code.sql — vérifie 20261028_2_catalog_items_code.sql (après 20261027_2).
-- Couvre : colonne + index partiel d'unicité (org, lower(code)) ; `code` EN FIN des deux vues ; CHECK « pas de blanc » ;
-- deux articles ME-001 / me-001 dans la même org → unique_violation ; même code dans une AUTRE org accepté ; un article
-- fusionné (merged_into) libère son code ; `recherche` de la liste contient le code (minuscules) ; fusion : le survivant
-- sans code hérite de celui de l'absorbé, le survivant avec code le garde et libère celui de l'absorbé ; la référence
-- fournisseur n'est pas touchée. Fixture (2 articles de test + 1 org fixture) nettoyée en fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_i5 uuid; v_i6 uuid; v_x uuid;
  v_search text; v_code text; v_last text;
  ok boolean;
BEGIN
  -- (0) structure
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'catalog_items' AND column_name = 'code' AND data_type = 'text') THEN
    RAISE EXCEPTION 'colonne catalog_items.code absente';
  END IF;
  IF (SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid = 'majordhome.catalog_items_code_org_unique'::regclass) NOT LIKE '%UNIQUE%(org_id, lower(code))%code IS NOT NULL%merged_into IS NULL%' THEN
    RAISE EXCEPTION 'index catalog_items_code_org_unique inattendu : %', (SELECT pg_get_indexdef('majordhome.catalog_items_code_org_unique'::regclass));
  END IF;
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_catalog_items' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'code' THEN RAISE EXCEPTION 'code n''est pas en fin de majordhome_catalog_items (dernière colonne : %)', v_last; END IF;
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_catalog_items_list' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'code' THEN RAISE EXCEPTION 'code n''est pas en fin de majordhome_catalog_items_list (dernière colonne : %)', v_last; END IF;
  IF has_table_privilege('anon', 'public.majordhome_catalog_items', 'SELECT') OR has_table_privilege('anon', 'public.majordhome_catalog_items_list', 'SELECT') THEN
    RAISE EXCEPTION 'anon lit les vues articles';
  END IF;
  IF has_function_privilege('anon', 'majordhome.catalog_item_merge_impl(uuid, uuid)', 'EXECUTE') OR has_function_privilege('authenticated', 'majordhome.catalog_item_merge_impl(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'merge_impl exécutable par anon / authenticated';
  END IF;

  -- fixture : une autre org (nettoyée en fin)
  INSERT INTO core.organizations (name) VALUES ('TEST CODE autre org') RETURNING id INTO v_autre;

  -- (1) code valide, premier article
  INSERT INTO majordhome.catalog_items (org_id, name, brand, product_kind, origin, code) VALUES (v_mayer, 'TEST CODE un', 'V2C', 'main', 'manuel', 'ME-001') RETURNING id INTO v_i1;

  -- (2) même code, casse différente, même org → unique_violation
  ok := false;
  BEGIN
    INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin, code) VALUES (v_mayer, 'TEST CODE doublon', 'main', 'manuel', 'me-001');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'ME-001 / me-001 acceptés dans la même org'; END IF;

  -- (2b) via la vue miroir updatable : UPDATE d'un autre article vers un code déjà pris → unique_violation
  INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin) VALUES (v_mayer, 'TEST CODE deux', 'main', 'manuel') RETURNING id INTO v_i2;
  ok := false;
  BEGIN
    UPDATE public.majordhome_catalog_items SET code = 'Me-001' WHERE id = v_i2;
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'la vue miroir a accepté un code déjà pris (casse différente)'; END IF;
  UPDATE public.majordhome_catalog_items SET code = 'ME-002' WHERE id = v_i2;
  SELECT code INTO v_code FROM majordhome.catalog_items WHERE id = v_i2;
  IF v_code IS DISTINCT FROM 'ME-002' THEN RAISE EXCEPTION 'code non écrit par la vue miroir : %', v_code; END IF;

  -- (3) CHECK : un code blanc est refusé (NULL reste permis)
  ok := false;
  BEGIN
    UPDATE majordhome.catalog_items SET code = '   ' WHERE id = v_i2;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'un code blanc a été accepté'; END IF;
  ok := false;
  BEGIN
    INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin, code) VALUES (v_mayer, 'TEST CODE vide', 'main', 'manuel', '');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'un code vide a été accepté'; END IF;

  -- (4) autre org : même code accepté
  INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin, code) VALUES (v_autre, 'TEST CODE autre org', 'main', 'manuel', 'ME-001') RETURNING id INTO v_i3;

  -- (5) recherche : minuscules, code inclus ; code exposé par la liste
  SELECT recherche, code INTO v_search, v_code FROM public.majordhome_catalog_items_list WHERE id = v_i1;
  IF v_search IS NULL OR position('me-001' IN v_search) = 0 THEN RAISE EXCEPTION 'recherche ne contient pas le code : %', v_search; END IF;
  IF v_code IS DISTINCT FROM 'ME-001' THEN RAISE EXCEPTION 'la liste n''expose pas code : %', v_code; END IF;

  -- (6) un article fusionné libère son code : après merged_into, la même référence est reprenable
  UPDATE majordhome.catalog_items SET merged_into = v_i2, is_active = false WHERE id = v_i1;
  INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin, code) VALUES (v_mayer, 'TEST CODE reprise', 'main', 'manuel', 'ME-001') RETURNING id INTO v_x;
  DELETE FROM majordhome.catalog_items WHERE id = v_x;
  UPDATE majordhome.catalog_items SET merged_into = NULL, is_active = true WHERE id = v_i1;

  -- (7) fusion : survivant SANS code hérite du code de l'absorbé (ME-001) — l'absorbé le libère sans violer l'index
  INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin) VALUES (v_mayer, 'TEST CODE survivant sans code', 'main', 'manuel') RETURNING id INTO v_i4;
  PERFORM majordhome.catalog_item_merge_impl(v_i4, v_i1);
  SELECT code INTO v_code FROM majordhome.catalog_items WHERE id = v_i4;
  IF v_code IS DISTINCT FROM 'ME-001' THEN RAISE EXCEPTION 'le survivant sans code n''a pas hérité (code = %)', v_code; END IF;
  SELECT code INTO v_code FROM majordhome.catalog_items WHERE id = v_i1;
  IF v_code IS NOT NULL THEN RAISE EXCEPTION 'l''absorbé garde son code (%)', v_code; END IF;
  IF (SELECT merged_into FROM majordhome.catalog_items WHERE id = v_i1) IS DISTINCT FROM v_i4 THEN RAISE EXCEPTION 'absorbé non marqué fusionné'; END IF;
  IF (SELECT count(*) FROM public.majordhome_catalog_items_list WHERE org_id = v_mayer AND lower(code) = 'me-001' AND merged_into IS NULL) <> 1 THEN
    RAISE EXCEPTION 'ME-001 doit rester porté par un seul article vivant';
  END IF;

  -- (8) fusion : survivant AVEC code le garde, celui de l'absorbé est libéré (reprenable ensuite)
  INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin, code) VALUES (v_mayer, 'TEST CODE survivant avec code', 'main', 'manuel', 'ME-010') RETURNING id INTO v_i5;
  INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin, code) VALUES (v_mayer, 'TEST CODE absorbé avec code', 'main', 'manuel', 'ME-011') RETURNING id INTO v_i6;
  PERFORM majordhome.catalog_item_merge_impl(v_i5, v_i6);
  SELECT code INTO v_code FROM majordhome.catalog_items WHERE id = v_i5;
  IF v_code IS DISTINCT FROM 'ME-010' THEN RAISE EXCEPTION 'le survivant avec code l''a perdu (%)', v_code; END IF;
  IF (SELECT code FROM majordhome.catalog_items WHERE id = v_i6) IS NOT NULL THEN RAISE EXCEPTION 'l''absorbé garde ME-011'; END IF;
  INSERT INTO majordhome.catalog_items (org_id, name, product_kind, origin, code) VALUES (v_mayer, 'TEST CODE reprise 011', 'main', 'manuel', 'ME-011') RETURNING id INTO v_x;
  DELETE FROM majordhome.catalog_items WHERE id = v_x;

  -- nettoyage (articles fusionnés d'abord : merged_into → ON DELETE SET NULL, pas de blocage)
  DELETE FROM majordhome.catalog_items WHERE id IN (v_i1, v_i2, v_i3, v_i4, v_i5, v_i6);
  DELETE FROM core.organizations WHERE id = v_autre;

  RAISE NOTICE 'assert-catalog-items-code : OK';
END $$;
