-- assert-articles-metadonnees.sql — vérifie 20261027_2_articles_metadonnees.sql (après 20261027_1).
-- Couvre : documents portés par l'article (product_documents.catalog_item_id, ligne fournisseur facultative, vue en
-- LEFT JOIN), rattachement qui recopie photo et caractéristiques manquantes, fusion qui déplace les documents de
-- l'article absorbé, proposition (jamais d'office) de deux clés de même marque à un suffixe près. Fixture nettoyée.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid;
  v_a uuid; v_b uuid; v_item uuid; v_item2 uuid; v_pa uuid; v_pb uuid; v_doc uuid;
  v_res jsonb; v_p record; v_n int; ok boolean;
BEGIN
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;

  -- (1) documents d'article
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'product_documents' AND column_name = 'catalog_item_id') THEN RAISE EXCEPTION 'product_documents.catalog_item_id absente'; END IF;
  SELECT column_name INTO v_p FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_product_documents' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_p.column_name <> 'catalog_item_id' THEN RAISE EXCEPTION 'catalog_item_id n''est pas la dernière colonne de majordhome_product_documents (%)', v_p.column_name; END IF;
  SELECT column_name INTO v_p FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_product_documents_write' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_p.column_name <> 'catalog_item_id' THEN RAISE EXCEPTION 'catalog_item_id n''est pas la dernière colonne de majordhome_product_documents_write (%)', v_p.column_name; END IF;

  INSERT INTO majordhome.catalog_items (org_id, name, brand, product_kind, origin, specs) VALUES (v_mayer, 'TEST META Article', 'V2C', 'main', 'manuel', '{"canonical": {"puissance_kw": 7.4}}'::jsonb) RETURNING id INTO v_item;
  INSERT INTO majordhome.product_documents (org_id, catalog_item_id, document_type, file_name, storage_path)
  VALUES (v_mayer, v_item, 'Fiche technique', 'fiche.pdf', v_mayer || '/articles/' || v_item || '/fiche.pdf') RETURNING id INTO v_doc;
  SELECT * INTO v_p FROM public.majordhome_product_documents WHERE id = v_doc;
  IF v_p.catalog_item_id <> v_item OR v_p.supplier_product_id IS NOT NULL THEN RAISE EXCEPTION 'document d''article invisible dans la vue'; END IF;
  ok := false;
  BEGIN INSERT INTO majordhome.product_documents (org_id, document_type, file_name, storage_path) VALUES (v_mayer, 'X', 'x.pdf', 'x');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'document sans ligne ni article accepté'; END IF;

  -- (2) rattachement : photo et caractéristiques manquantes recopiées, celles de l'article gardées
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST META A', true) RETURNING id INTO v_a;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST META B', true) RETURNING id INTO v_b;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, purchase_price_ht, image_url, specs)
  VALUES (v_a, v_mayer, 'META-1', 'Ligne META', 'V2C', 400, 'https://x/photo.jpg', '{"canonical": {"puissance_kw": 22, "phases": 3}}'::jsonb) RETURNING id INTO v_pa;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.catalog_item_attach(v_pa, v_item);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT * INTO v_p FROM majordhome.catalog_items WHERE id = v_item;
  IF v_p.image_url IS DISTINCT FROM 'https://x/photo.jpg' THEN RAISE EXCEPTION 'photo non recopiée au rattachement : %', v_p.image_url; END IF;
  IF (v_p.specs -> 'canonical' ->> 'puissance_kw') <> '7.4' OR (v_p.specs -> 'canonical' ->> 'phases') <> '3' THEN RAISE EXCEPTION 'caractéristiques mal fusionnées : %', v_p.specs; END IF;

  -- (3) fusion : les documents de l'article absorbé passent au survivant
  INSERT INTO majordhome.catalog_items (org_id, name, brand, product_kind, origin) VALUES (v_mayer, 'TEST META Doublon', 'V2C', 'main', 'manuel') RETURNING id INTO v_item2;
  UPDATE majordhome.product_documents SET catalog_item_id = v_item2 WHERE id = v_doc;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.catalog_item_merge(v_item, v_item2);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT catalog_item_id INTO v_p FROM majordhome.product_documents WHERE id = v_doc;
  IF v_p.catalog_item_id <> v_item THEN RAISE EXCEPTION 'document de l''absorbé non déplacé'; END IF;

  -- (4) clés à un suffixe près (TRY323OL10 / TRY323OL10F) : proposées, jamais fusionnées d'office
  UPDATE majordhome.supplier_products SET model_key = 'TRY323OL10', model_key_source = 'manuel' WHERE id = v_pa;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, purchase_price_ht, model_key, model_key_source)
  VALUES (v_b, v_mayer, 'META-2', 'Ligne META BayWa', 'V2C', 632.5, 'TRY323OL10F', 'cle') RETURNING id INTO v_pb;
  SET LOCAL ROLE service_role;
  PERFORM public.catalog_items_ensure(v_mayer);
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM majordhome.catalog_item_proposals pr
  WHERE pr.statut = 'propose' AND pr.motif LIKE '%proche%'
    AND v_item IN (pr.item_a_id, pr.item_b_id)
    AND (SELECT catalog_item_id FROM majordhome.supplier_products WHERE id = v_pb) IN (pr.item_a_id, pr.item_b_id);
  IF v_n <> 1 THEN RAISE EXCEPTION 'paire à suffixe non proposée (résultat %)', v_res; END IF;
  IF (SELECT catalog_item_id FROM majordhome.supplier_products WHERE id = v_pb) = v_item THEN RAISE EXCEPTION 'paire à suffixe fusionnée d''office'; END IF;

  -- nettoyage
  DELETE FROM majordhome.catalog_item_proposals WHERE v_item IN (item_a_id, item_b_id) OR v_item2 IN (item_a_id, item_b_id);
  DELETE FROM majordhome.product_documents WHERE id = v_doc;
  DELETE FROM majordhome.catalog_items WHERE id IN (SELECT catalog_item_id FROM majordhome.supplier_products WHERE supplier_id IN (v_a, v_b));
  DELETE FROM majordhome.supplier_products WHERE supplier_id IN (v_a, v_b);
  DELETE FROM majordhome.catalog_items WHERE id IN (v_item, v_item2);
  DELETE FROM majordhome.suppliers WHERE id IN (v_a, v_b);

  RAISE NOTICE 'assert-articles-metadonnees : OK';
END $$;
