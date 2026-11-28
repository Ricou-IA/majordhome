-- assert-proposition-seule-doublon-importe.sql — vérifie 20261129_5_proposition_seule_doublon_importe.sql sur le
-- cluster de répétition : un article qui porte une ligne d'import pas encore reprise par un relevé n'est jamais
-- fusionné d'office, la paire devient une proposition (décision d'Eric 2026-11-28, « proposition seule »). Témoin :
-- deux articles relevés chez deux fournisseurs différents, mêmes clés, prix proches ⇒ toujours fusionnés d'office.
-- Chaîne : fixture-catalog-harmonisation-prod.sql → 20261028_4 → 20261124_2 → 20261129_2 → 20261129_3 → 20261129_4
-- → 20261129_5. Sans 20261129_5, le cas (1) échoue (fusion d'office de X et Y).
-- Autonome : crée ses fournisseurs et ses articles dans Mayer, les supprime à la fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_s uuid; v_s8 uuid; v_s9 uuid;
  v_x uuid; v_y uuid; v_t1 uuid; v_t2 uuid;
  v_tous uuid[];
  v_res jsonb;
  v_p record;
  f text := 'public.catalog_item_proposals_propose(uuid)';
BEGIN
  -- (0) signature et droits inchangés : service_role seul, SECURITY DEFINER
  IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par anon', f; END IF;
  IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par authenticated', f; END IF;
  IF has_function_privilege('service_role', f, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION '% non exécutable par service_role', f; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION '% exécutable par PUBLIC', f;
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '% doit être SECURITY DEFINER', f; END IF;

  INSERT INTO majordhome.suppliers (org_id, name, is_active, category_mapping) VALUES (v_mayer, 'TEST PROP SEULE S', true, '{}'::jsonb) RETURNING id INTO v_s;
  INSERT INTO majordhome.suppliers (org_id, name, is_active, category_mapping) VALUES (v_mayer, 'TEST PROP SEULE S8', true, '{}'::jsonb) RETURNING id INTO v_s8;
  INSERT INTO majordhome.suppliers (org_id, name, is_active, category_mapping) VALUES (v_mayer, 'TEST PROP SEULE S9', true, '{}'::jsonb) RETURNING id INTO v_s9;

  -- (1) X relevé chez S (référence A, 100 €) ; Y = doublon fort recoché à l'import (même marque + modèle, même nature),
  --     ligne d'import S référence B à 110 €, pas encore reprise par un relevé
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin, created_at)
  VALUES (v_mayer, 'Relevé X20', 'TESTPROPSEULE', 'X20', 'main', 150, 'auto', now() - interval '1 day') RETURNING id INTO v_x;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category,
                                            catalog_item_id, catalog_item_link_source, catalog_item_linked_at, specs)
  VALUES (v_s, v_mayer, 'A-20', 'Relevé X20', 'TESTPROPSEULE', 'X20', 100, 'photovoltaique',
          v_x, 'auto', now(), '{"source_version":"releve-test-20"}'::jsonb);
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin)
  VALUES (v_mayer, 'Importé X20', 'TESTPROPSEULE', 'X20', 'main', 150, 'manuel') RETURNING id INTO v_y;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category,
                                            catalog_item_id, catalog_item_link_source, catalog_item_linked_at, specs)
  VALUES (v_s, v_mayer, 'B-20', 'Importé X20', 'TESTPROPSEULE', 'X20', 110, 'photovoltaique',
          v_y, 'import', now(), jsonb_build_object('source_version', 'import-articles_' || gen_random_uuid()));

  -- (2) témoin : deux articles relevés chez deux fournisseurs différents, mêmes clés, prix proches, aucune ligne d'import
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin, created_at)
  VALUES (v_mayer, 'Témoin X21 (S8)', 'TESTPROPSEULE', 'X21', 'main', 0, 'auto', now() - interval '1 day') RETURNING id INTO v_t1;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category,
                                            catalog_item_id, catalog_item_link_source, catalog_item_linked_at, specs)
  VALUES (v_s8, v_mayer, 'T8-21', 'Témoin X21', 'TESTPROPSEULE', 'X21', 100, 'photovoltaique',
          v_t1, 'auto', now(), '{"source_version":"releve-test-s8"}'::jsonb);
  INSERT INTO majordhome.catalog_items (org_id, name, brand, model_key, product_kind, selling_price_ht, origin)
  VALUES (v_mayer, 'Témoin X21 (S9)', 'TESTPROPSEULE', 'X21', 'main', 0, 'auto') RETURNING id INTO v_t2;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category,
                                            catalog_item_id, catalog_item_link_source, catalog_item_linked_at, specs)
  VALUES (v_s9, v_mayer, 'T9-21', 'Témoin X21', 'TESTPROPSEULE', 'X21', 105, 'photovoltaique',
          v_t2, 'auto', now(), '{"source_version":"releve-test-s9"}'::jsonb);

  SET LOCAL ROLE service_role;
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;

  -- (1) X ↔ Y : proposée, pas fusionnée
  IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE id IN (v_x, v_y) AND merged_into IS NOT NULL) THEN
    RAISE EXCEPTION '(1) X20 : article importé fusionné d''office avec l''article relevé (%)', v_res;
  END IF;
  SELECT * INTO v_p FROM majordhome.catalog_item_proposals WHERE item_a_id = least(v_x, v_y) AND item_b_id = greatest(v_x, v_y);
  IF v_p.statut IS DISTINCT FROM 'propose' OR v_p.source IS DISTINCT FROM 'cle' OR v_p.motif LIKE '%fusion d''office%' THEN
    RAISE EXCEPTION '(1) X20 : proposition attendue entre X et Y : statut % source % motif % (%)', v_p.statut, v_p.source, v_p.motif, v_res;
  END IF;
  IF (SELECT count(*) FROM majordhome.catalog_item_proposals WHERE item_a_id IN (v_x, v_y) OR item_b_id IN (v_x, v_y)) <> 1 THEN
    RAISE EXCEPTION '(1) X20 : plus d''une ligne de proposition';
  END IF;
  IF (SELECT count(*) FROM majordhome.supplier_products WHERE catalog_item_id = v_y AND reference = 'B-20' AND is_active) <> 1 THEN
    RAISE EXCEPTION '(1) X20 : la ligne d''import a quitté l''article importé';
  END IF;

  -- (2) témoin : fusion d'office comme avant (survivant = le plus ancien, t1)
  IF (SELECT merged_into FROM majordhome.catalog_items WHERE id = v_t2) IS DISTINCT FROM v_t1 THEN
    RAISE EXCEPTION '(2) témoin X21 : non fusionné d''office dans l''article le plus ancien (%)', v_res;
  END IF;
  IF (SELECT merged_into FROM majordhome.catalog_items WHERE id = v_t1) IS NOT NULL THEN RAISE EXCEPTION '(2) témoin : le survivant est absorbé'; END IF;
  SELECT * INTO v_p FROM majordhome.catalog_item_proposals WHERE item_a_id = least(v_t1, v_t2) AND item_b_id = greatest(v_t1, v_t2);
  IF v_p.statut IS DISTINCT FROM 'fusionne' THEN RAISE EXCEPTION '(2) témoin : statut % au lieu de fusionne', v_p.statut; END IF;

  IF (v_res->>'fusionnes')::int <> 1 OR (v_res->>'proposes')::int <> 1 THEN
    RAISE EXCEPTION 'propose : % (1 fusion — le témoin —, 1 proposition — X20 — attendues)', v_res;
  END IF;

  -- idempotence : une relance ne fusionne ni ne propose rien
  SET LOCAL ROLE service_role;
  v_res := public.catalog_item_proposals_propose(v_mayer);
  RESET ROLE;
  IF (v_res->>'nouvelles')::int <> 0 THEN RAISE EXCEPTION 'relance non idempotente : %', v_res; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_items WHERE id IN (v_x, v_y) AND merged_into IS NOT NULL) THEN
    RAISE EXCEPTION 'relance : X20 fusionné d''office';
  END IF;

  -- nettoyage
  v_tous := ARRAY[v_x, v_y, v_t1, v_t2];
  DELETE FROM majordhome.catalog_item_proposals WHERE item_a_id = ANY (v_tous) OR item_b_id = ANY (v_tous);
  DELETE FROM majordhome.supplier_products WHERE supplier_id IN (v_s, v_s8, v_s9);
  UPDATE majordhome.catalog_items SET merged_into = NULL WHERE id = ANY (v_tous);
  DELETE FROM majordhome.catalog_items WHERE id = ANY (v_tous);
  DELETE FROM majordhome.suppliers WHERE id IN (v_s, v_s8, v_s9);

  RAISE NOTICE 'assert-proposition-seule-doublon-importe : OK';
END $$;
