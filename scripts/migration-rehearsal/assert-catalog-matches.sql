-- assert-catalog-matches.sql — vérifie 20261025_3_catalog_matches.sql (après 20261024_2, _5, 20261025_2).
-- Fixture : deux fournisseurs, HUAWEI/LUNA20007E1 ×1 de chaque côté ⇒ confirmée d'office ; HUAWEI/SUN2000X ×2 chez A
-- et ×1 chez B ⇒ 2 propositions ; EAN égal ⇒ confirmée ; idempotence ; refus mémorisé ; décisions org_admin seul ;
-- rapprochement manuel ; privilèges ; ordre des paires imposé ; vue lisible.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_a uuid; v_b uuid;
  v_admin uuid; v_membre uuid;
  v_res jsonb; v_n int; ok boolean;
  v_luna_a uuid; v_luna_b uuid; v_sun_a1 uuid; v_sun_a2 uuid; v_sun_b uuid; v_ean_a uuid; v_ean_b uuid; v_seul_a uuid; v_seul_b uuid;
  v_match uuid; v_ids uuid[];
BEGIN
  IF has_function_privilege('anon', 'public.catalog_matches_propose(uuid)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.catalog_matches_propose(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'propose ouverte à anon/authenticated'; END IF;
  IF has_function_privilege('anon', 'public.catalog_match_set_status(uuid[], text)', 'EXECUTE') THEN RAISE EXCEPTION 'set_status ouverte à anon'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.catalog_matches', 'INSERT') THEN RAISE EXCEPTION 'authenticated insère dans catalog_matches'; END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'majordhome' AND c.relname = 'catalog_matches' AND c.relrowsecurity;
  IF v_n <> 1 THEN RAISE EXCEPTION 'RLS inactive'; END IF;

  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST MATCH A', true) RETURNING id INTO v_a;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST MATCH B', true) RETURNING id INTO v_b;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category) VALUES
    (v_a, v_mayer, 'A1', 'LUNA2000-7-E1 Battery Module', 'Huawei', 'LUNA20007E1', 2001.90, 'batterie') RETURNING id INTO v_luna_a;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category) VALUES
    (v_b, v_mayer, 'B1', 'HUAWEI – Batterie LUNA2000-7-E1', 'HUAWEI', 'LUNA20007E1', 2119.94, 'batterie') RETURNING id INTO v_luna_b;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category) VALUES
    (v_a, v_mayer, 'A2', 'SUN2000X v1', 'Huawei', 'SUN2000X', 500, 'photovoltaique') RETURNING id INTO v_sun_a1;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category) VALUES
    (v_a, v_mayer, 'A3', 'SUN2000X v2', 'Huawei', 'SUN2000X', 520, 'photovoltaique') RETURNING id INTO v_sun_a2;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category) VALUES
    (v_b, v_mayer, 'B2', 'HUAWEI – SUN2000X', 'HUAWEI', 'SUN2000X', 530, 'photovoltaique') RETURNING id INTO v_sun_b;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, code_ean, purchase_price_ht, category) VALUES
    (v_a, v_mayer, 'A4', 'EcoFlow 5kWh', 'EcoFlow', '4895251670951', 1300, 'batterie') RETURNING id INTO v_ean_a;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, code_ean, purchase_price_ht, category) VALUES
    (v_b, v_mayer, 'B4', 'ECOFLOW – Batterie Ocean 2 – 5kWh', 'ECOFLOW', '4895251670951', 1326.25, 'batterie') RETURNING id INTO v_ean_b;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category) VALUES
    (v_a, v_mayer, 'A5', 'Seul chez A', 'Enphase', 'IQ8PLUS72', 100, 'photovoltaique') RETURNING id INTO v_seul_a;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category) VALUES
    (v_b, v_mayer, 'B5', 'Seul chez B, autre marque', 'Hoymiles', 'IQ8PLUS72', 100, 'photovoltaique') RETURNING id INTO v_seul_b;
  -- accessoire à 10,93 € citant le modèle de l'onduleur à 2 449 € (vécu en prod, SUN2000-50KTL-M3) ⇒ proposé, jamais confirmé d'office
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category, product_kind) VALUES
    (v_a, v_mayer, 'A6', 'Subassembly | Accessories SUN2000-50KTL-M3', 'Huawei', 'SUN200050KTLM3', 10.93, 'photovoltaique', 'accessory');
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, purchase_price_ht, category, product_kind) VALUES
    (v_b, v_mayer, 'B6', 'HUAWEI – Onduleur SUN2000-50KTL-M3', 'HUAWEI', 'SUN200050KTLM3', 2449.77, 'photovoltaique', 'main');

  -- paire qui correspond À LA FOIS par marque+modèle et par EAN (relecture I-5) : une seule ligne, pas de 23505
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, code_ean, purchase_price_ht, category) VALUES
    (v_a, v_mayer, 'A7', 'Pytes V5', 'Pytes', 'PYTESV5', '6971234567890', 880, 'batterie');
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, brand, model_key, code_ean, purchase_price_ht, category) VALUES
    (v_b, v_mayer, 'B7', 'PYTES – V5 Batterie', 'PYTES', 'PYTESV5', '6971234567890', 900, 'batterie');

  -- (a) proposition : LUNA confirmée, EAN confirmée, Pytes (clé + EAN) confirmée une fois, SUN2000X ×2 + accessoire/onduleur proposés, marques différentes ignorées
  SET LOCAL ROLE service_role;
  v_res := public.catalog_matches_propose(v_mayer);
  RESET ROLE;
  IF (v_res->>'confirmes')::int <> 3 OR (v_res->>'proposes')::int <> 3 THEN RAISE EXCEPTION 'proposition : %', v_res; END IF;
  SELECT count(*) INTO v_n FROM majordhome.catalog_matches m JOIN majordhome.supplier_products a ON a.id = m.product_a_id WHERE a.reference IN ('A7', 'B7');
  IF v_n <> 1 THEN RAISE EXCEPTION 'paire clé+EAN : % lignes', v_n; END IF;
  IF has_table_privilege('anon', 'majordhome.catalog_matches', 'SELECT') THEN RAISE EXCEPTION 'anon lit catalog_matches'; END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.catalog_matches m JOIN majordhome.supplier_products a ON a.id = m.product_a_id WHERE a.reference IN ('A6', 'B6') AND m.statut = 'propose') THEN
    RAISE EXCEPTION 'accessoire / onduleur confirmé d''office';
  END IF;
  SELECT statut INTO v_res FROM (SELECT to_jsonb(m.statut) AS statut FROM majordhome.catalog_matches m WHERE m.product_a_id = least(v_luna_a, v_luna_b) AND m.product_b_id = greatest(v_luna_a, v_luna_b)) x;
  IF v_res <> '"confirme"'::jsonb THEN RAISE EXCEPTION 'LUNA non confirmée : %', v_res; END IF;
  SELECT count(*) INTO v_n FROM majordhome.catalog_matches WHERE statut = 'propose' AND source = 'cle' AND (product_a_id IN (v_sun_a1, v_sun_a2, v_sun_b) OR product_b_id IN (v_sun_a1, v_sun_a2, v_sun_b));
  IF v_n <> 2 THEN RAISE EXCEPTION 'SUN2000X : % propositions', v_n; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_matches WHERE product_a_id IN (v_seul_a, v_seul_b) OR product_b_id IN (v_seul_a, v_seul_b)) THEN RAISE EXCEPTION 'marques différentes rapprochées'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.catalog_matches WHERE NOT (product_a_id < product_b_id)) THEN RAISE EXCEPTION 'ordre des paires'; END IF;

  -- (b) idempotence
  SET LOCAL ROLE service_role;
  v_res := public.catalog_matches_propose(v_mayer);
  RESET ROLE;
  IF (v_res->>'nouvelles')::int <> 0 THEN RAISE EXCEPTION 'relance non idempotente : %', v_res; END IF;

  -- (c) décisions : membre refusé, admin confirme / refuse en lot ; un refus survit à une relance
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer AND role <> 'org_admin' LIMIT 1;
  SELECT array_agg(id) INTO v_ids FROM majordhome.catalog_matches WHERE statut = 'propose';
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  ok := false;
  BEGIN PERFORM public.catalog_match_set_status(v_ids, 'refuse'); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un membre a décidé'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_n := public.catalog_match_set_status(v_ids, 'refuse');
  IF v_n <> 3 THEN RAISE EXCEPTION 'refus en lot : %', v_n; END IF;
  ok := false;
  BEGIN PERFORM public.catalog_match_set_status(v_ids, 'bidule'); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'statut invalide accepté'; END IF;
  -- (d) rapprochement manuel
  v_match := public.catalog_match_create(v_seul_b, v_seul_a);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO v_n FROM majordhome.catalog_matches WHERE id = v_match AND statut = 'confirme' AND source = 'manuel' AND product_a_id = least(v_seul_a, v_seul_b) AND confirmed_by = v_admin;
  IF v_n <> 1 THEN RAISE EXCEPTION 'rapprochement manuel absent'; END IF;
  SET LOCAL ROLE service_role;
  v_res := public.catalog_matches_propose(v_mayer);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM majordhome.catalog_matches WHERE id = ANY (v_ids) AND statut = 'refuse';
  IF v_n <> 3 THEN RAISE EXCEPTION 'un refus a été reproposé'; END IF;

  -- (e) vue : écart de prix et noms de fournisseurs
  SELECT count(*) INTO v_n FROM public.majordhome_catalog_matches v WHERE v.supplier_a_name LIKE 'TEST MATCH%' AND v.supplier_b_name LIKE 'TEST MATCH%' AND v.ecart_pct IS NOT NULL;
  IF v_n < 2 THEN RAISE EXCEPTION 'vue incomplète : %', v_n; END IF;
  -- le signe dépend de l'ordre des UUID (a = le plus petit) : on contrôle la valeur absolue (5,6 % ou 5,9 %)
  SELECT round(abs(ecart_pct)) INTO v_n FROM public.majordhome_catalog_matches WHERE product_a_id = least(v_luna_a, v_luna_b);
  IF v_n NOT BETWEEN 5 AND 7 THEN RAISE EXCEPTION 'écart LUNA inattendu : %', v_n; END IF;

  RAISE NOTICE 'assert-catalog-matches : OK';
END $$;
