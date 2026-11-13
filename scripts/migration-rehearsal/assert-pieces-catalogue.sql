-- assert-pieces-catalogue.sql — vérifie 20261113_3_pieces_catalogue.sql (base de pièces : vue de recherche des
-- catalogues de pièces relevés, indicateur nb_pieces_base des recherches de l'assistant).
-- Chaîne : 20261113_1 + 20261113_2 + 20261113_3. L'écrivain public.supplier_pieces_upsert est celui de la PROD
-- (photographié par snapshot.mjs), jamais une copie : l'assertion 6 prouve son comportement sous une marque de
-- relevé unique ('CATALOGUE', un relevé = un seul appel), tel que la base de pièces le suppose.
-- Impersonation : SET LOCAL ROLE authenticated + request.jwt.claim.sub (stub auth.uid() du harnais) ; request.jwt.claims
-- posé aussi, comme en prod. RLS de suppliers / supplier_products = policies de prod (POLICY_TABLES). Fixtures
-- supprimées en fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;            -- autre org CORE
  v_membre uuid;           -- membre de Mayer, pas de l'autre org
  v_etranger uuid;         -- membre de l'autre org, pas de Mayer
  v_eq uuid;               -- équipement Mayer (assertion 7)
  v_s1 uuid;               -- Mayer : marchand de pièces relevé (catalogue de pièces)
  v_s2 uuid;               -- Mayer : autre fournisseur (tarif + pièce Invicta sans catalogue_pieces)
  v_s3 uuid;               -- autre org : marchand de pièces relevé
  v_s4 uuid;               -- Mayer : marchand de pièces relevé, fournisseur désactivé
  v_s5 uuid;               -- Mayer : AUTRE marchand de pièces relevé, actif, même marque de relevé 'CATALOGUE'
  v_s5_piece uuid;         -- sa pièce active, absente de tous les relevés de S1
  v_sum_s5 text; v_sum_s5_apres text;
  v_tests uuid[];          -- fournisseurs de test : les comptes de la vue s'y limitent (suite indépendante des données de prod)
  v_a uuid; v_b uuid; v_c uuid; v_inv uuid; v_tarif uuid; v_autre_piece uuid; v_inactif uuid;
  v_items uuid[];
  v_res jsonb;
  v_sum_s2 text; v_sum_s2_apres text;
  v_sum_s1 text; v_sum_s1_apres text;
  v_n int; v_n2 int;
  v_row record;
  v_id uuid; v_id_close uuid;
  v_ok boolean;
  v_cols text[];
  v_s6 uuid;               -- Mayer : marchand de test à marque accentuée (assertion 5 ter, supprimé dans la foulée)
  v_marques text;
  v_refs text[];
  p text;
  r text;
  v_vue regclass;
  -- Lignes de la forme produite par l'adaptateur (src/lib/catalogue/woocommercePieces.js, ligneDepuisItem).
  v_abc jsonb := $j$[
    {"reference":"41450901500","name":"Bougie d'allumage CÉRAMIQUE","brand":"MCZ","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":39.75,"taux_remise":0,
     "purchase_price_ht":39.75,"selling_price_ht_defaut":39.75,
     "image_url":"https://exemple.test/img/bougie.jpg","image_source_url":"https://exemple.test/produit/bougie",
     "specs":{"source_version":"essai-2026-11-12","canonical":{"catalogue_pieces":true,
       "fiche_produit":"https://exemple.test/produit/bougie",
       "rayons":["Pièces détachées MCZ","Pièces détachées FREEPOINT"],"prix_public_ttc":47.7,
       "stock_releve":{"en_stock":true,"at":"2026-11-12T03:00:00.000Z"},
       "description_marchand":"Bougie compatible avec les poêles GLOBE AIRTIGHT et EGO 2.0."}}},
    {"reference":"41451101900","name":"Joint de porte Ø 8 mm","brand":"FREEPOINT","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":12.5,"taux_remise":0,
     "purchase_price_ht":12.5,"selling_price_ht_defaut":12.5,
     "image_url":null,"image_source_url":"https://exemple.test/produit/joint",
     "specs":{"source_version":"essai-2026-11-12","canonical":{"catalogue_pieces":true,
       "fiche_produit":"https://exemple.test/produit/joint","rayons":["Pièces détachées FREEPOINT"],"prix_public_ttc":15,
       "stock_releve":{"en_stock":false,"at":"2026-11-12T03:00:00.000Z"},
       "description_marchand":"Joint plat pour Freepoint Vulcano."}}},
    {"reference":"41201500200","name":"Motoréducteur 2 tr/min","brand":"MCZ","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":75,"taux_remise":0,
     "purchase_price_ht":75,"selling_price_ht_defaut":75,
     "image_url":null,"image_source_url":"https://exemple.test/produit/motoreducteur",
     "specs":{"source_version":"essai-2026-11-12","canonical":{"catalogue_pieces":true,
       "fiche_produit":"https://exemple.test/produit/motoreducteur","rayons":["Pièces détachées MCZ"],"prix_public_ttc":90,
       "stock_releve":{"en_stock":true,"at":"2026-11-12T03:00:00.000Z"},
       "description_marchand":"Motoréducteur de vis sans fin."}}}
  ]$j$::jsonb;
  -- Relevé suivant : C a disparu du catalogue ; B est revenu en stock à un autre prix.
  v_ab jsonb := $j$[
    {"reference":"41450901500","name":"Bougie d'allumage CÉRAMIQUE","brand":"MCZ","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":39.75,"taux_remise":0,
     "purchase_price_ht":39.75,"selling_price_ht_defaut":39.75,
     "image_url":"https://exemple.test/img/bougie.jpg","image_source_url":"https://exemple.test/produit/bougie",
     "specs":{"source_version":"essai-2026-11-13","canonical":{"catalogue_pieces":true,
       "fiche_produit":"https://exemple.test/produit/bougie",
       "rayons":["Pièces détachées MCZ","Pièces détachées FREEPOINT"],"prix_public_ttc":47.7,
       "stock_releve":{"en_stock":true,"at":"2026-11-13T03:00:00.000Z"},
       "description_marchand":"Bougie compatible avec les poêles GLOBE AIRTIGHT et EGO 2.0."}}},
    {"reference":"41451101900","name":"Joint de porte Ø 8 mm","brand":"FREEPOINT","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":14,"taux_remise":0,
     "purchase_price_ht":14,"selling_price_ht_defaut":14,
     "image_url":null,"image_source_url":"https://exemple.test/produit/joint",
     "specs":{"source_version":"essai-2026-11-13","canonical":{"catalogue_pieces":true,
       "fiche_produit":"https://exemple.test/produit/joint","rayons":["Pièces détachées FREEPOINT"],"prix_public_ttc":16.8,
       "stock_releve":{"en_stock":true,"at":"2026-11-13T03:00:00.000Z"},
       "description_marchand":"Joint plat pour Freepoint Vulcano."}}}
  ]$j$::jsonb;
  v_attendues text[] := ARRAY['id', 'org_id', 'supplier_id', 'supplier_name', 'reference', 'name', 'brand', 'rayons',
                              'prix_public_ttc', 'en_stock', 'releve_at', 'fiche_url', 'image_url', 'recherche',
                              'marque_recherche'];
BEGIN
  -- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────
  SELECT om.org_id, om.user_id INTO v_autre, v_etranger FROM core.organization_members om
  WHERE om.org_id <> v_mayer
    AND NOT EXISTS (SELECT 1 FROM core.organization_members m2 WHERE m2.user_id = om.user_id AND m2.org_id = v_mayer)
  LIMIT 1;
  SELECT om.user_id INTO v_membre FROM core.organization_members om
  WHERE om.org_id = v_mayer
    AND NOT EXISTS (SELECT 1 FROM core.organization_members m2 WHERE m2.user_id = om.user_id AND m2.org_id = v_autre)
  LIMIT 1;
  IF v_membre IS NULL OR v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : il faut un membre Mayer et un membre d''une autre org'; END IF;
  SELECT e.id INTO v_eq FROM majordhome.equipments e WHERE majordhome.project_org_id(e.project_id) = v_mayer LIMIT 1;
  IF v_eq IS NULL THEN RAISE EXCEPTION 'fixture : aucun équipement Mayer'; END IF;

  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active)
  VALUES (v_mayer, 'TEST CATALOGUE PIECES', 'woocommerce', 'https://exemple.test', true) RETURNING id INTO v_s1;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST TARIF INVICTA', true) RETURNING id INTO v_s2;
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active)
  VALUES (v_autre, 'TEST CATALOGUE AUTRE ORG', 'woocommerce', 'https://autre.test', true) RETURNING id INTO v_s3;
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active)
  VALUES (v_mayer, 'TEST CATALOGUE DESACTIVE', 'woocommerce', 'https://inactif.test', true) RETURNING id INTO v_s4;
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active)
  VALUES (v_mayer, 'TEST CATALOGUE AUTRE MARCHAND', 'woocommerce', 'https://autre-marchand.test', true) RETURNING id INTO v_s5;
  v_tests := ARRAY[v_s1, v_s2, v_s3, v_s4, v_s5];

  SET LOCAL ROLE service_role;
  -- S2 : une ligne de tarif (écrivain du tarif), puis une pièce « comme Invicta » (marque du site, sans catalogue_pieces)
  PERFORM public.supplier_catalog_upsert(v_mayer, v_s2, 'tarif-essai', $j$[
    {"reference":"TST-TARIF-1","name":"Batterie céramique de test","brand":"INVICTA","category":"batterie","product_kind":"main",
     "purchase_price_ht":900,"selling_price_ht_defaut":1200,"default_tva_rate":20,"unit":"pièce",
     "specs":{"source_version":"tarif-essai","canonical":{}}}]$j$::jsonb, '{}'::jsonb);
  PERFORM public.supplier_pieces_upsert(v_mayer, v_s2, 'invicta-essai', 'INVICTA', $j$[
    {"reference":"TST-INV-1","name":"Vitre céramique Invicta","brand":"INVICTA","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":80,"taux_remise":30,
     "purchase_price_ht":56,"selling_price_ht_defaut":80,
     "specs":{"source_version":"invicta-essai","canonical":{"prix_public_ttc":96}}}]$j$::jsonb);
  -- S3 : pièce de catalogue d'une AUTRE org (même forme, même marque de relevé)
  PERFORM public.supplier_pieces_upsert(v_autre, v_s3, 'essai-2026-11-12', 'CATALOGUE', $j$[
    {"reference":"TST-AUTRE-1","name":"Bougie d'allumage céramique autre org","brand":"MCZ","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":30,"taux_remise":0,
     "purchase_price_ht":30,"selling_price_ht_defaut":30,
     "specs":{"source_version":"essai-2026-11-12","canonical":{"catalogue_pieces":true,"fiche_produit":"https://autre.test/p",
       "rayons":["Pièces détachées MCZ"],"prix_public_ttc":36,"stock_releve":{"en_stock":true,"at":"2026-11-12T03:00:00.000Z"},
       "description_marchand":"GLOBE AIRTIGHT"}}}]$j$::jsonb);
  -- S4 : pièce de catalogue d'un fournisseur ensuite désactivé
  PERFORM public.supplier_pieces_upsert(v_mayer, v_s4, 'essai-2026-11-12', 'CATALOGUE', $j$[
    {"reference":"TST-INACTIF-1","name":"Bougie d'allumage céramique fournisseur désactivé","brand":"MCZ",
     "category":"piece_detachee","product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":30,
     "taux_remise":0,"purchase_price_ht":30,"selling_price_ht_defaut":30,
     "specs":{"source_version":"essai-2026-11-12","canonical":{"catalogue_pieces":true,"rayons":["Pièces détachées MCZ"],
       "prix_public_ttc":36,"stock_releve":{"en_stock":true,"at":"2026-11-12T03:00:00.000Z"}}}}]$j$::jsonb);
  -- S5 : pièce de catalogue ACTIVE d'un autre marchand de la même org, sous la MÊME marque de relevé, absente des
  -- relevés de S1 — la fixture qu'un écrivain oubliant son filtre supplier_id désactiverait (assertion 6)
  PERFORM public.supplier_pieces_upsert(v_mayer, v_s5, 'essai-2026-11-12', 'CATALOGUE', $j$[
    {"reference":"TST-S5-1","name":"Thermocouple de test autre marchand","brand":"MCZ","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":20,"taux_remise":0,
     "purchase_price_ht":20,"selling_price_ht_defaut":20,
     "specs":{"source_version":"essai-2026-11-12","canonical":{"catalogue_pieces":true,"rayons":["Pièces détachées MCZ"],
       "prix_public_ttc":24,"stock_releve":{"en_stock":true,"at":"2026-11-12T03:00:00.000Z"}}}}]$j$::jsonb);
  RESET ROLE;
  UPDATE majordhome.suppliers SET is_active = false WHERE id = v_s4;

  SELECT id INTO v_tarif FROM majordhome.supplier_products WHERE supplier_id = v_s2 AND reference = 'TST-TARIF-1';
  SELECT id INTO v_inv FROM majordhome.supplier_products WHERE supplier_id = v_s2 AND reference = 'TST-INV-1';
  SELECT id INTO v_autre_piece FROM majordhome.supplier_products WHERE supplier_id = v_s3 AND reference = 'TST-AUTRE-1';
  SELECT id INTO v_inactif FROM majordhome.supplier_products WHERE supplier_id = v_s4 AND reference = 'TST-INACTIF-1';
  SELECT id INTO v_s5_piece FROM majordhome.supplier_products WHERE supplier_id = v_s5 AND reference = 'TST-S5-1';
  IF v_tarif IS NULL OR v_inv IS NULL OR v_autre_piece IS NULL OR v_inactif IS NULL OR v_s5_piece IS NULL THEN
    RAISE EXCEPTION 'fixture : lignes des fournisseurs S2 / S3 / S4 / S5 non écrites';
  END IF;

  -- Empreinte des lignes de l'AUTRE fournisseur de la même org (S2), avant tout relevé de S1
  SELECT count(*), md5(string_agg(row_to_json(sp)::text, '|' ORDER BY sp.id)) INTO v_n, v_sum_s2
  FROM majordhome.supplier_products sp WHERE sp.supplier_id = v_s2;
  IF v_n <> 2 THEN RAISE EXCEPTION 'fixture : S2 devrait porter 2 lignes, % trouvée(s)', v_n; END IF;
  -- Empreinte de l'autre marchand S5 (même org, même marque de relevé) ; sa pièce est active, marquée, dans la vue
  SELECT md5(string_agg(row_to_json(sp)::text, '|' ORDER BY sp.id)) INTO v_sum_s5
  FROM majordhome.supplier_products sp WHERE sp.supplier_id = v_s5;
  IF (SELECT is_active FROM majordhome.supplier_products WHERE id = v_s5_piece) IS NOT TRUE
     OR (SELECT specs -> 'canonical' -> 'releves_pieces' FROM majordhome.supplier_products WHERE id = v_s5_piece) IS DISTINCT FROM '["CATALOGUE"]'::jsonb
     OR NOT EXISTS (SELECT 1 FROM public.majordhome_pieces_catalogue v WHERE v.id = v_s5_piece) THEN
    RAISE EXCEPTION 'fixture : la pièce de S5 devrait être active, marquée CATALOGUE et dans la vue';
  END IF;

  -- ── 6 a. premier relevé du catalogue de S1 : A, B, C, un seul appel sous la marque 'CATALOGUE' ──────────
  SET LOCAL ROLE service_role;
  v_res := public.supplier_pieces_upsert(v_mayer, v_s1, 'essai-2026-11-12', 'CATALOGUE', v_abc);
  RESET ROLE;
  -- l'autre marchand S5 (même org, même marque) n'est pas touché par le relevé de S1, dès le premier appel
  IF (SELECT is_active FROM majordhome.supplier_products WHERE id = v_s5_piece) IS NOT TRUE
     OR (SELECT specs -> 'canonical' -> 'releves_pieces' FROM majordhome.supplier_products WHERE id = v_s5_piece) IS DISTINCT FROM '["CATALOGUE"]'::jsonb THEN
    RAISE EXCEPTION '(6 a) la pièce CATALOGUE de l''autre marchand S5 a été désactivée ou démarquée par le relevé de S1 : %', v_res;
  END IF;
  IF (v_res ->> 'inseres')::int IS DISTINCT FROM 3 OR (v_res ->> 'pieces_desactivees')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '(6) premier relevé inattendu : %', v_res;
  END IF;
  SELECT id INTO v_a FROM majordhome.supplier_products WHERE supplier_id = v_s1 AND reference = '41450901500';
  SELECT id INTO v_b FROM majordhome.supplier_products WHERE supplier_id = v_s1 AND reference = '41451101900';
  SELECT id INTO v_c FROM majordhome.supplier_products WHERE supplier_id = v_s1 AND reference = '41201500200';
  IF v_a IS NULL OR v_b IS NULL OR v_c IS NULL THEN RAISE EXCEPTION '(6) premier relevé : A, B ou C absente'; END IF;

  -- ── 1. colonnes de la vue : exactement les données publiques du marchand + le champ de recherche ────────
  v_vue := to_regclass('public.majordhome_pieces_catalogue');
  IF v_vue IS NULL THEN RAISE EXCEPTION '(1) vue public.majordhome_pieces_catalogue absente'; END IF;
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a WHERE a.attrelid = v_vue AND a.attnum > 0 AND NOT a.attisdropped;
  FOREACH p IN ARRAY ARRAY['purchase_price_ht', 'taux_remise', 'tarif_public', 'selling_price_ht', 'specs', 'description'] LOOP
    IF p = ANY (v_cols) THEN RAISE EXCEPTION '(1) la vue expose la colonne %', p; END IF;
  END LOOP;
  IF v_cols IS DISTINCT FROM v_attendues THEN RAISE EXCEPTION '(1) colonnes de la vue : % au lieu de %', v_cols, v_attendues; END IF;
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = v_vue AND a.attname = 'prix_public_ttc') <> 'numeric'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = v_vue AND a.attname = 'en_stock') <> 'boolean'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = v_vue AND a.attname = 'releve_at') <> 'timestamp with time zone'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = v_vue AND a.attname = 'rayons') <> 'text'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = v_vue AND a.attname = 'recherche') <> 'text'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = v_vue AND a.attname = 'marque_recherche') <> 'text' THEN
    RAISE EXCEPTION '(1) types de colonnes inattendus';
  END IF;

  -- ── 2. privilèges : anon rien, authenticated SELECT seul, service_role SELECT, PUBLIC rien ; security_invoker ──
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.majordhome_pieces_catalogue', p) THEN RAISE EXCEPTION '(2) anon a % sur la vue', p; END IF;
    IF p <> 'SELECT' AND has_table_privilege('authenticated', 'public.majordhome_pieces_catalogue', p) THEN
      RAISE EXCEPTION '(2) authenticated a % sur la vue', p;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_pieces_catalogue', 'SELECT') THEN RAISE EXCEPTION '(2) authenticated sans SELECT sur la vue'; END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_pieces_catalogue', 'SELECT') THEN RAISE EXCEPTION '(2) service_role sans SELECT sur la vue'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = v_vue AND x.grantee = 0) THEN
    RAISE EXCEPTION '(2) PUBLIC garde un privilège sur la vue';
  END IF;
  -- assistant de la vue (lecture de date sans erreur) : INVOKER, pas exécutable par anon
  IF has_function_privilege('anon', 'majordhome.horodatage_ou_null(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'majordhome.horodatage_ou_null(text)', 'EXECUTE')
     OR (SELECT p2.prosecdef FROM pg_proc p2 WHERE p2.oid = 'majordhome.horodatage_ou_null(text)'::regprocedure) IS NOT FALSE THEN
    RAISE EXCEPTION '(2) majordhome.horodatage_ou_null : privilèges ou mode inattendus';
  END IF;
  -- IS NOT TRUE : des reloptions NULL (aucune option) donnent NULL au LIKE, et doivent aussi lever.
  IF ((SELECT array_to_string(c.reloptions, ',') FROM pg_class c WHERE c.oid = v_vue) LIKE '%security_invoker=true%') IS NOT TRUE THEN
    RAISE EXCEPTION '(2) vue sans security_invoker=true';
  END IF;

  -- ── 3. isolement : un membre voit les pièces de catalogue de son org, aucune d'une autre org ──────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_membre, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.majordhome_pieces_catalogue v WHERE v.supplier_id = v_s1;
  IF v_n <> 3 THEN RAISE EXCEPTION '(3) le membre voit % pièce(s) du catalogue de son org au lieu de 3', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.majordhome_pieces_catalogue v WHERE v.supplier_id = ANY (v_tests) AND (v.org_id <> v_mayer OR v.id = v_autre_piece);
  IF v_n <> 0 THEN RAISE EXCEPTION '(3) le membre voit % pièce(s) d''une autre org', v_n; END IF;
  -- même filtré par le texte de l'autre org : rien
  SELECT count(*) INTO v_n FROM public.majordhome_pieces_catalogue v WHERE v.supplier_id = ANY (v_tests) AND v.recherche LIKE '%autre org%';
  IF v_n <> 0 THEN RAISE EXCEPTION '(3) la recherche du membre trouve % pièce(s) d''une autre org', v_n; END IF;
  -- fournisseur désactivé : sa pièce n'est pas proposée
  IF EXISTS (SELECT 1 FROM public.majordhome_pieces_catalogue v WHERE v.id = v_inactif) THEN
    RAISE EXCEPTION '(3) une pièce d''un fournisseur désactivé est dans la vue';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_etranger, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.majordhome_pieces_catalogue v WHERE v.supplier_id = ANY (v_tests) AND v.org_id = v_mayer;
  IF v_n <> 0 THEN RAISE EXCEPTION '(3) un membre d''une autre org voit % pièce(s) Mayer', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.majordhome_pieces_catalogue v WHERE v.id = v_autre_piece;
  IF v_n <> 1 THEN RAISE EXCEPTION '(3) le membre de l''autre org ne voit pas sa propre pièce (% ligne)', v_n; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM public.majordhome_pieces_catalogue;
  IF v_n <> 0 THEN RAISE EXCEPTION '(3) un appel sans utilisateur voit % pièce(s)', v_n; END IF;
  RESET ROLE;
  SET LOCAL ROLE anon;
  v_ok := false;
  BEGIN
    PERFORM 1 FROM public.majordhome_pieces_catalogue LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  RESET ROLE;
  IF NOT v_ok THEN RAISE EXCEPTION '(2) anon lit la vue'; END IF;

  -- ── 4. une pièce détachée sans catalogue_pieces (comme une pièce Invicta) n'est pas dans la vue ; le tarif non plus ──
  IF EXISTS (SELECT 1 FROM public.majordhome_pieces_catalogue v WHERE v.id IN (v_inv, v_tarif)) THEN
    RAISE EXCEPTION '(4) une pièce Invicta ou une ligne de tarif est dans la vue';
  END IF;
  IF (SELECT category FROM majordhome.supplier_products WHERE id = v_inv) IS DISTINCT FROM 'piece_detachee'
     OR (SELECT is_active FROM majordhome.supplier_products WHERE id = v_inv) IS NOT TRUE THEN
    RAISE EXCEPTION '(4) fixture : la pièce Invicta devrait être une pièce détachée active';
  END IF;

  -- ── 5. recherche sans casse ni accents, contenu et colonnes lues dans specs.canonical ─────────────────────
  SELECT * INTO v_row FROM public.majordhome_pieces_catalogue v WHERE v.id = v_a;
  IF v_row.id IS NULL THEN RAISE EXCEPTION '(5) la pièce A n''est pas dans la vue'; END IF;
  IF v_row.recherche IS DISTINCT FROM lower(v_row.recherche) OR v_row.recherche IS DISTINCT FROM public.unaccent(v_row.recherche) THEN
    RAISE EXCEPTION '(5) recherche avec casse ou accents : %', v_row.recherche;
  END IF;
  IF (SELECT array_agg(v.id) FROM public.majordhome_pieces_catalogue v WHERE v.supplier_id = ANY (v_tests) AND v.org_id = v_mayer AND v.recherche ILIKE '%ceramique%')
     IS DISTINCT FROM ARRAY[v_a] THEN
    RAISE EXCEPTION '(5) « ceramique » ne trouve pas exactement la bougie A';
  END IF;
  IF v_row.recherche NOT LIKE '%41450901500%' OR v_row.recherche NOT LIKE '%mcz%'
     OR v_row.recherche NOT LIKE '%pieces detachees freepoint%' OR v_row.recherche NOT LIKE '%globe airtight%' THEN
    RAISE EXCEPTION '(5) recherche incomplète (référence, marque, rayons, description) : %', v_row.recherche;
  END IF;
  IF v_row.recherche IS DISTINCT FROM
     'bougie d''allumage ceramique 41450901500 mcz pieces detachees mcz | pieces detachees freepoint bougie compatible avec les poeles globe airtight et ego 2.0.' THEN
    RAISE EXCEPTION '(5) recherche inattendue : %', v_row.recherche;
  END IF;
  IF v_row.rayons IS DISTINCT FROM 'Pièces détachées MCZ | Pièces détachées FREEPOINT'
     OR v_row.prix_public_ttc IS DISTINCT FROM 47.7 OR v_row.en_stock IS NOT TRUE
     OR v_row.releve_at IS DISTINCT FROM '2026-11-12T03:00:00Z'::timestamptz
     OR v_row.fiche_url IS DISTINCT FROM 'https://exemple.test/produit/bougie'
     OR v_row.image_url IS DISTINCT FROM 'https://exemple.test/img/bougie.jpg'
     OR v_row.supplier_name IS DISTINCT FROM 'TEST CATALOGUE PIECES' OR v_row.supplier_id IS DISTINCT FROM v_s1
     OR v_row.org_id IS DISTINCT FROM v_mayer OR v_row.reference IS DISTINCT FROM '41450901500'
     OR v_row.name IS DISTINCT FROM 'Bougie d''allumage CÉRAMIQUE' OR v_row.brand IS DISTINCT FROM 'MCZ' THEN
    RAISE EXCEPTION '(5) ligne A inattendue : %', row_to_json(v_row);
  END IF;
  IF (SELECT v.en_stock FROM public.majordhome_pieces_catalogue v WHERE v.id = v_b) IS NOT FALSE THEN
    RAISE EXCEPTION '(5) la pièce B (rupture au relevé) n''est pas en_stock = false';
  END IF;

  -- ── 5 ter. marque_recherche = marque + rayons normalisés (casse, accents, ø) ; ni désignation ni description ──
  -- Marchand S6 dédié (créé et supprimé ici) : une pièce « JØTUL » au rayon « Pièces détachées Jøtul », et une pièce MCZ
  -- dont la DÉSIGNATION et la DESCRIPTION citent Jotul — le filtre de marque ne doit retrouver que la première.
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active)
  VALUES (v_mayer, 'TEST CATALOGUE MARQUE ACCENTUEE', 'woocommerce', 'https://jotul.test', true) RETURNING id INTO v_s6;
  SET LOCAL ROLE service_role;
  PERFORM public.supplier_pieces_upsert(v_mayer, v_s6, 'essai-2026-11-12', 'CATALOGUE', $j$[
    {"reference":"TST-JOTUL-1","name":"Vitre de porte","brand":"JØTUL","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":50,"taux_remise":30,
     "purchase_price_ht":35,"selling_price_ht_defaut":50,
     "specs":{"source_version":"essai-2026-11-12","canonical":{"catalogue_pieces":true,"rayons":["Pièces détachées Jøtul"],
       "prix_public_ttc":60,"stock_releve":{"en_stock":true,"at":"2026-11-12T03:00:00.000Z"},
       "description_marchand":"Vitre céramique."}}},
    {"reference":"TST-JOTUL-2","name":"Joint type Jøtul F 100","brand":"MCZ","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":10,"taux_remise":30,
     "purchase_price_ht":7,"selling_price_ht_defaut":10,
     "specs":{"source_version":"essai-2026-11-12","canonical":{"catalogue_pieces":true,"rayons":["Pièces détachées MCZ"],
       "prix_public_ttc":12,"stock_releve":{"en_stock":true,"at":"2026-11-12T03:00:00.000Z"},
       "description_marchand":"Remplace le joint d'origine des poêles jotul."}}}
  ]$j$::jsonb);
  RESET ROLE;
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a WHERE a.attrelid = 'public.majordhome_pieces_catalogue'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols[array_length(v_cols, 1)] IS DISTINCT FROM 'marque_recherche' THEN
    RAISE EXCEPTION '(5 ter) marque_recherche n''est pas la dernière colonne de la vue : %', v_cols;
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_membre, 'role', 'authenticated')::text, true);
  EXECUTE 'SELECT string_agg(v.reference || ''='' || v.marque_recherche, '' ; '' ORDER BY v.reference)
           FROM public.majordhome_pieces_catalogue v WHERE v.supplier_id = $1' INTO v_marques USING v_s6;
  EXECUTE 'SELECT array_agg(v.reference ORDER BY v.reference) FROM public.majordhome_pieces_catalogue v
           WHERE v.supplier_id = $1 AND v.marque_recherche ILIKE ''%jotul%''' INTO v_refs USING v_s6;
  RESET ROLE;
  IF v_marques IS DISTINCT FROM 'TST-JOTUL-1=jotul pieces detachees jotul ; TST-JOTUL-2=mcz pieces detachees mcz' THEN
    RAISE EXCEPTION '(5 ter) marque_recherche inattendue (marque + rayons seulement, normalisés) : %', v_marques;
  END IF;
  IF v_refs IS DISTINCT FROM ARRAY['TST-JOTUL-1'] THEN
    RAISE EXCEPTION '(5 ter) marque_recherche ILIKE ''%%jotul%%'' : % au lieu de {TST-JOTUL-1} (désignation ou description ne doivent pas compter)', v_refs;
  END IF;
  SELECT array_agg(DISTINCT sp.catalog_item_id) INTO v_items FROM majordhome.supplier_products sp
  WHERE sp.supplier_id = v_s6 AND sp.catalog_item_id IS NOT NULL;
  DELETE FROM majordhome.supplier_products WHERE supplier_id = v_s6;
  DELETE FROM majordhome.catalog_items WHERE id = ANY (COALESCE(v_items, '{}'::uuid[]));
  DELETE FROM majordhome.suppliers WHERE id = v_s6;
  v_items := NULL;

  -- ── 6 b. relevé suivant SANS C (un seul appel, même marque) : C désactivée et hors vue, A et B une fois ──
  SET LOCAL ROLE service_role;
  v_res := public.supplier_pieces_upsert(v_mayer, v_s1, 'essai-2026-11-13', 'CATALOGUE', v_ab);
  RESET ROLE;
  IF (v_res ->> 'inseres')::int IS DISTINCT FROM 0 OR (v_res ->> 'pieces_desactivees')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '(6) second relevé inattendu : %', v_res;
  END IF;
  SELECT * INTO v_row FROM majordhome.supplier_products WHERE id = v_c;
  IF v_row.is_active IS NOT FALSE OR (v_row.specs ->> 'desactive_par_releve')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '(6) la pièce C absente du relevé n''est pas désactivée par le relevé : actif=%, specs=%', v_row.is_active, v_row.specs;
  END IF;
  IF EXISTS (SELECT 1 FROM public.majordhome_pieces_catalogue v WHERE v.id = v_c) THEN
    RAISE EXCEPTION '(6) la pièce C désactivée est encore dans la vue';
  END IF;
  FOREACH p IN ARRAY ARRAY['41450901500', '41451101900'] LOOP
    SELECT count(*) INTO v_n FROM majordhome.supplier_products WHERE supplier_id = v_s1 AND reference = p;
    SELECT count(*) INTO v_n2 FROM public.majordhome_pieces_catalogue v WHERE v.supplier_id = v_s1 AND v.reference = p;
    IF v_n <> 1 OR v_n2 <> 1 THEN RAISE EXCEPTION '(6) pièce % : % ligne(s) en table, % dans la vue (1 attendue)', p, v_n, v_n2; END IF;
  END LOOP;
  SELECT * INTO v_row FROM public.majordhome_pieces_catalogue v WHERE v.id = v_b;
  IF v_row.en_stock IS NOT TRUE OR v_row.prix_public_ttc IS DISTINCT FROM 16.8 OR v_row.releve_at IS DISTINCT FROM '2026-11-13T03:00:00Z'::timestamptz THEN
    RAISE EXCEPTION '(6) le second relevé n''a pas rafraîchi B : %', row_to_json(v_row);
  END IF;
  IF (SELECT specs -> 'canonical' -> 'releves_pieces' FROM majordhome.supplier_products WHERE id = v_a) IS DISTINCT FROM '["CATALOGUE"]'::jsonb THEN
    RAISE EXCEPTION '(6) marque de relevé de A inattendue';
  END IF;
  -- l'autre fournisseur de la même org n'a pas bougé
  SELECT count(*), md5(string_agg(row_to_json(sp)::text, '|' ORDER BY sp.id)) INTO v_n, v_sum_s2_apres
  FROM majordhome.supplier_products sp WHERE sp.supplier_id = v_s2;
  IF v_n <> 2 OR v_sum_s2_apres IS DISTINCT FROM v_sum_s2 THEN
    RAISE EXCEPTION '(6) les lignes de l''autre fournisseur S2 ont changé (% ligne(s))', v_n;
  END IF;
  -- ni la pièce CATALOGUE active de l'autre marchand S5 de la même org (même marque, absente du relevé de S1)
  IF (SELECT is_active FROM majordhome.supplier_products WHERE id = v_s5_piece) IS NOT TRUE
     OR (SELECT specs -> 'canonical' -> 'releves_pieces' FROM majordhome.supplier_products WHERE id = v_s5_piece) IS DISTINCT FROM '["CATALOGUE"]'::jsonb
     OR NOT EXISTS (SELECT 1 FROM public.majordhome_pieces_catalogue v WHERE v.id = v_s5_piece) THEN
    RAISE EXCEPTION '(6 b) la pièce CATALOGUE de l''autre marchand S5 a été désactivée ou démarquée par le relevé de S1';
  END IF;
  SELECT md5(string_agg(row_to_json(sp)::text, '|' ORDER BY sp.id)) INTO v_sum_s5_apres FROM majordhome.supplier_products sp WHERE sp.supplier_id = v_s5;
  IF v_sum_s5_apres IS DISTINCT FROM v_sum_s5 THEN RAISE EXCEPTION '(6 b) les lignes de l''autre marchand S5 ont changé'; END IF;
  -- ni la pièce de l'autre org
  IF (SELECT is_active FROM majordhome.supplier_products WHERE id = v_autre_piece) IS NOT TRUE THEN
    RAISE EXCEPTION '(6) la pièce de l''autre org a été désactivée';
  END IF;

  -- ── 6 c. rejouer le second relevé : rien ne change, aucun doublon (lignes ni articles) ──────────────────
  SELECT count(*), md5(string_agg((to_jsonb(sp) - 'updated_at' - 'purchase_price_at' - 'created_at')::text, '|' ORDER BY sp.id))
  INTO v_n, v_sum_s1 FROM majordhome.supplier_products sp WHERE sp.supplier_id = v_s1;
  SELECT count(*) INTO v_n2 FROM majordhome.catalog_items ci WHERE ci.org_id = v_mayer;
  SET LOCAL ROLE service_role;
  v_res := public.supplier_pieces_upsert(v_mayer, v_s1, 'essai-2026-11-13', 'CATALOGUE', v_ab);
  RESET ROLE;
  IF (v_res ->> 'inseres')::int IS DISTINCT FROM 0 OR (v_res ->> 'pieces_desactivees')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '(6) relevé rejoué inattendu : %', v_res;
  END IF;
  SELECT md5(string_agg((to_jsonb(sp) - 'updated_at' - 'purchase_price_at' - 'created_at')::text, '|' ORDER BY sp.id))
  INTO v_sum_s1_apres FROM majordhome.supplier_products sp WHERE sp.supplier_id = v_s1;
  IF v_n <> 3 OR v_sum_s1_apres IS DISTINCT FROM v_sum_s1 THEN RAISE EXCEPTION '(6) rejouer le second relevé a changé les lignes de S1'; END IF;
  IF (SELECT count(*) FROM majordhome.catalog_items ci WHERE ci.org_id = v_mayer) <> v_n2 THEN
    RAISE EXCEPTION '(6) rejouer le second relevé a créé des articles';
  END IF;
  SELECT md5(string_agg(row_to_json(sp)::text, '|' ORDER BY sp.id)) INTO v_sum_s2_apres FROM majordhome.supplier_products sp WHERE sp.supplier_id = v_s2;
  IF v_sum_s2_apres IS DISTINCT FROM v_sum_s2 THEN RAISE EXCEPTION '(6) rejouer a changé les lignes de l''autre fournisseur S2'; END IF;
  -- ni la pièce CATALOGUE active de l'autre marchand S5 de la même org (même marque, absente du relevé de S1)
  IF (SELECT is_active FROM majordhome.supplier_products WHERE id = v_s5_piece) IS NOT TRUE
     OR (SELECT specs -> 'canonical' -> 'releves_pieces' FROM majordhome.supplier_products WHERE id = v_s5_piece) IS DISTINCT FROM '["CATALOGUE"]'::jsonb
     OR NOT EXISTS (SELECT 1 FROM public.majordhome_pieces_catalogue v WHERE v.id = v_s5_piece) THEN
    RAISE EXCEPTION '(6 c) la pièce CATALOGUE de l''autre marchand S5 a été désactivée ou démarquée par le relevé de S1';
  END IF;
  SELECT md5(string_agg(row_to_json(sp)::text, '|' ORDER BY sp.id)) INTO v_sum_s5_apres FROM majordhome.supplier_products sp WHERE sp.supplier_id = v_s5;
  IF v_sum_s5_apres IS DISTINCT FROM v_sum_s5 THEN RAISE EXCEPTION '(6 c) les lignes de l''autre marchand S5 ont changé'; END IF;
  SELECT count(*) INTO v_n FROM public.majordhome_pieces_catalogue v WHERE v.supplier_id = v_s1;
  IF v_n <> 2 THEN RAISE EXCEPTION '(6) après rejeu, % pièce(s) de S1 dans la vue au lieu de 2', v_n; END IF;

  -- 6 d. C revient au relevé d'après : réactivée, toujours une seule ligne
  SET LOCAL ROLE service_role;
  v_res := public.supplier_pieces_upsert(v_mayer, v_s1, 'essai-2026-11-14', 'CATALOGUE', v_abc);
  RESET ROLE;
  IF (SELECT count(*) FROM majordhome.supplier_products WHERE supplier_id = v_s1 AND reference = '41201500200') <> 1
     OR (SELECT is_active FROM majordhome.supplier_products WHERE id = v_c) IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM public.majordhome_pieces_catalogue v WHERE v.id = v_c) THEN
    RAISE EXCEPTION '(6) la pièce C revenue au catalogue n''est pas réactivée (une seule ligne) : %', v_res;
  END IF;

  -- ── 5 bis. valeurs malformées dans specs.canonical : NULL, jamais une erreur qui casse la vue ──────────────
  UPDATE majordhome.supplier_products SET specs = jsonb_set(specs, '{canonical}', (specs -> 'canonical') || $j${
      "prix_public_ttc":"47,70","stock_releve":{"en_stock":"oui","at":"2026-02-30T00:00:00Z"},
      "rayons":"pas un tableau","fiche_produit":12,"description_marchand":{"x":1}}$j$::jsonb) WHERE id = v_a;
  UPDATE majordhome.supplier_products SET specs = jsonb_set(specs, '{canonical}', (specs -> 'canonical') || $j${
      "prix_public_ttc":null,"stock_releve":"texte","rayons":["Pièces détachées FREEPOINT", null, 3]}$j$::jsonb) WHERE id = v_b;
  UPDATE majordhome.supplier_products SET specs = jsonb_set(specs, '{canonical,stock_releve,at}', '"n''importe quoi"'::jsonb) WHERE id = v_c;
  -- lecture de TOUTE la vue, chaque colonne évaluée (row_to_json force le calcul ; un count(*) seul ne le ferait pas)
  SELECT count(*), md5(string_agg(row_to_json(v)::text, '|')) INTO v_n, p FROM public.majordhome_pieces_catalogue v;
  IF v_n < 3 OR p IS NULL THEN RAISE EXCEPTION '(5 bis) lecture complète de la vue inattendue (% ligne(s))', v_n; END IF;
  SELECT * INTO v_row FROM public.majordhome_pieces_catalogue v WHERE v.id = v_a;
  IF v_row.prix_public_ttc IS NOT NULL OR v_row.en_stock IS NOT NULL OR v_row.releve_at IS NOT NULL
     OR v_row.rayons IS NOT NULL OR v_row.fiche_url IS NOT NULL THEN
    RAISE EXCEPTION '(5 bis) valeurs malformées de A non ramenées à NULL : %', row_to_json(v_row);
  END IF;
  IF v_row.recherche IS DISTINCT FROM 'bougie d''allumage ceramique 41450901500 mcz' THEN
    RAISE EXCEPTION '(5 bis) recherche de A (rayons / description malformés) inattendue : %', v_row.recherche;
  END IF;
  SELECT * INTO v_row FROM public.majordhome_pieces_catalogue v WHERE v.id = v_b;
  IF v_row.prix_public_ttc IS NOT NULL OR v_row.en_stock IS NOT NULL OR v_row.releve_at IS NOT NULL
     OR v_row.rayons IS DISTINCT FROM 'Pièces détachées FREEPOINT' THEN -- seuls les éléments texte du tableau
    RAISE EXCEPTION '(5 bis) valeurs malformées de B inattendues : %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM public.majordhome_pieces_catalogue v WHERE v.id = v_c;
  IF v_row.releve_at IS NOT NULL OR v_row.en_stock IS NOT TRUE OR v_row.prix_public_ttc IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION '(5 bis) date malformée de C inattendue : %', row_to_json(v_row);
  END IF;

  -- ── 7. assistant_recherche_noter_base : service_role seul ; borne 0..999 ; ligne en_cours seulement ──────
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, 'public.assistant_recherche_noter_base(uuid, integer)', 'EXECUTE') THEN
      RAISE EXCEPTION '(7) % peut exécuter assistant_recherche_noter_base', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.assistant_recherche_noter_base(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '(7) service_role ne peut pas exécuter assistant_recherche_noter_base';
  END IF;
  IF (SELECT p2.prosecdef FROM pg_proc p2 WHERE p2.oid = 'public.assistant_recherche_noter_base(uuid, integer)'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION '(7) assistant_recherche_noter_base n''est pas SECURITY DEFINER';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(p2.proacl) x
             WHERE p2.oid = 'public.assistant_recherche_noter_base(uuid, integer)'::regprocedure AND x.grantee = 0)
     OR (SELECT p2.proacl FROM pg_proc p2 WHERE p2.oid = 'public.assistant_recherche_noter_base(uuid, integer)'::regprocedure) IS NULL THEN
    RAISE EXCEPTION '(7) PUBLIC peut exécuter assistant_recherche_noter_base';
  END IF;

  v_id := public.assistant_recherche_ouvrir(v_mayer, v_eq, NULL, 'Bougie d''allumage', v_membre);
  v_id_close := public.assistant_recherche_ouvrir(v_mayer, v_eq, NULL, 'Joint de porte', v_membre);
  PERFORM public.assistant_recherche_clore(v_id_close, 'terminee', '{}'::jsonb, NULL, NULL, NULL);
  IF (SELECT nb_pieces_base FROM majordhome.assistant_recherches WHERE id = v_id) IS NOT NULL THEN
    RAISE EXCEPTION '(7) nb_pieces_base n''est pas NULL à l''ouverture';
  END IF;
  SET LOCAL ROLE service_role;
  PERFORM public.assistant_recherche_noter_base(v_id, 1000);
  PERFORM public.assistant_recherche_noter_base(v_id, -1);
  RESET ROLE;
  IF (SELECT nb_pieces_base FROM majordhome.assistant_recherches WHERE id = v_id) IS NOT NULL THEN
    RAISE EXCEPTION '(7) une valeur hors 0..999 a été écrite';
  END IF;
  SET LOCAL ROLE service_role;
  PERFORM public.assistant_recherche_noter_base(v_id, 0);
  RESET ROLE;
  IF (SELECT nb_pieces_base FROM majordhome.assistant_recherches WHERE id = v_id) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '(7) la borne 0 n''est pas écrite';
  END IF;
  -- NULL (ou hors borne) sur une valeur déjà posée : rien n'est écrit, la valeur reste 0 (NULL sur NULL ne prouverait rien)
  SET LOCAL ROLE service_role;
  PERFORM public.assistant_recherche_noter_base(v_id, NULL);
  PERFORM public.assistant_recherche_noter_base(v_id, 1000);
  RESET ROLE;
  IF (SELECT nb_pieces_base FROM majordhome.assistant_recherches WHERE id = v_id) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '(7) NULL ou une valeur hors borne a remplacé la valeur posée';
  END IF;
  SET LOCAL ROLE service_role;
  PERFORM public.assistant_recherche_noter_base(v_id, 999);
  PERFORM public.assistant_recherche_noter_base(v_id_close, 5);
  PERFORM public.assistant_recherche_noter_base(gen_random_uuid(), 5); -- id inconnu : rien, sans exception
  RESET ROLE;
  IF (SELECT nb_pieces_base FROM majordhome.assistant_recherches WHERE id = v_id) IS DISTINCT FROM 999 THEN
    RAISE EXCEPTION '(7) la borne 999 n''est pas écrite sur la recherche en cours';
  END IF;
  IF (SELECT nb_pieces_base FROM majordhome.assistant_recherches WHERE id = v_id_close) IS NOT NULL THEN
    RAISE EXCEPTION '(7) une recherche close a reçu nb_pieces_base';
  END IF;
  -- la base tient la borne, même en écriture directe (CHECK)
  v_ok := false;
  BEGIN
    UPDATE majordhome.assistant_recherches SET nb_pieces_base = 1000 WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '(7) le CHECK 0..999 de nb_pieces_base est absent'; END IF;

  -- 7 bis. vue des recherches : nb_pieces_base EN FIN de liste, privilèges de 20261113_1 inchangés
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols FROM pg_attribute a
  WHERE a.attrelid = 'public.majordhome_assistant_recherches'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM ARRAY['id', 'org_id', 'equipment_id', 'intervention_id', 'demande', 'statut', 'run_id', 'reponse',
       'texte_brut', 'usage', 'erreur', 'created_by', 'created_at', 'finished_at', 'created_by_name', 'nb_pieces_base'] THEN
    RAISE EXCEPTION '(7 bis) colonnes de majordhome_assistant_recherches : %', v_cols;
  END IF;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.majordhome_assistant_recherches', p) THEN RAISE EXCEPTION '(7 bis) anon a % sur la vue des recherches', p; END IF;
    IF p <> 'SELECT' AND has_table_privilege('authenticated', 'public.majordhome_assistant_recherches', p) THEN
      RAISE EXCEPTION '(7 bis) authenticated a % sur la vue des recherches', p;
    END IF;
    IF p <> 'SELECT' AND has_table_privilege('authenticated', 'majordhome.assistant_recherches', p) THEN
      RAISE EXCEPTION '(7 bis) authenticated a % sur la table des recherches', p;
    END IF;
  END LOOP;
  IF ((SELECT array_to_string(c.reloptions, ',') FROM pg_class c WHERE c.oid = 'public.majordhome_assistant_recherches'::regclass)
      LIKE '%security_invoker=true%') IS NOT TRUE THEN
    RAISE EXCEPTION '(7 bis) vue des recherches sans security_invoker';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_membre, 'role', 'authenticated')::text, true);
  IF (SELECT v.nb_pieces_base FROM public.majordhome_assistant_recherches v WHERE v.id = v_id) IS DISTINCT FROM 999 THEN
    RAISE EXCEPTION '(7 bis) le membre ne lit pas nb_pieces_base par la vue';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_etranger, 'role', 'authenticated')::text, true);
  IF EXISTS (SELECT 1 FROM public.majordhome_assistant_recherches v WHERE v.id = v_id) THEN
    RAISE EXCEPTION '(7 bis) un membre d''une autre org lit la recherche';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RESET ROLE;

  -- ── Nettoyage ────────────────────────────────────────────────────────────────────────────────────────────
  DELETE FROM majordhome.assistant_recherches WHERE id IN (v_id, v_id_close);
  SELECT array_agg(DISTINCT sp.catalog_item_id) INTO v_items FROM majordhome.supplier_products sp
  WHERE sp.supplier_id IN (v_s1, v_s2, v_s3, v_s4, v_s5) AND sp.catalog_item_id IS NOT NULL;
  DELETE FROM majordhome.supplier_products WHERE supplier_id IN (v_s1, v_s2, v_s3, v_s4, v_s5);
  DELETE FROM majordhome.catalog_items WHERE id = ANY (COALESCE(v_items, '{}'::uuid[]));
  DELETE FROM majordhome.suppliers WHERE id IN (v_s1, v_s2, v_s3, v_s4, v_s5);
  RAISE NOTICE 'assert-pieces-catalogue : OK';
END $$;
