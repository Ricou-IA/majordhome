-- assert-suppliers-connecteur-admin.sql — vérifie 20261113_4_suppliers_connecteur_admin.sql : sous `authenticated`,
-- connector, auto_sync, site_url (avec connecteur) et connector_config.public / .catalogue_pieces / .accord sont
-- réservés à l'org_admin de l'org du fournisseur ; le reste de la fiche reste modifiable par tout membre ;
-- service_role et l'écrivain SECURITY DEFINER supplier_pieces_upsert ne sont pas gênés.
-- Chaîne : 20261113_1 + _2 + _3 + _4. RLS de suppliers = policies de prod photographiées (POLICY_TABLES).
-- Impersonation : SET LOCAL ROLE authenticated + request.jwt.claim.sub (stub auth.uid() du harnais) ; request.jwt.claims
-- posé aussi, comme en prod. Chaque refus attendu doit être EXACTEMENT `connecteur_admin_requis` (jeton lu par l'écran),
-- sauf le membre d'une autre org (refusé par la RLS existante). Fixtures supprimées en fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;            -- autre org CORE
  v_membre uuid;           -- membre de Mayer, PAS org_admin (ni de Mayer ni ailleurs)
  v_admin uuid;            -- org_admin de Mayer
  v_etranger uuid;         -- membre de l'autre org, pas de Mayer
  v_s uuid;                -- Mayer : boutique publique de pièces, accord posé
  v_p uuid;                -- Mayer : fournisseur simple, sans connecteur
  v_ins uuid;
  v_cfg jsonb := '{"public": true, "catalogue_pieces": true, "accord": {"contact": "M. Martin", "date": "2026-11-10"},
                   "pieces": {"remise_pct": 30}, "sca_path": "/sca"}'::jsonb;
  v_avant record;
  v_apres record;
  v_cible text;
  v_sql text;
  v_err text;
  v_ok boolean;
  v_n int;
  v_grant_sr boolean := false;
  v_res jsonb;
  v_items uuid[];
  v_refus text[] := ARRAY[
    'UPDATE %s SET connector = ''suitecommerce'' WHERE id = %L',
    'UPDATE %s SET connector = NULL WHERE id = %L',
    'UPDATE %s SET auto_sync = true WHERE id = %L',
    'UPDATE %s SET site_url = ''https://pirate.test'' WHERE id = %L',
    'UPDATE %s SET connector_config = connector_config || ''{"public": false}''::jsonb WHERE id = %L',
    'UPDATE %s SET connector_config = connector_config - ''public'' WHERE id = %L',
    'UPDATE %s SET connector_config = jsonb_set(connector_config, ''{catalogue_pieces}'', ''false'') WHERE id = %L',
    'UPDATE %s SET connector_config = connector_config || ''{"accord": {"contact": "Moi", "date": "2026-01-01"}}''::jsonb WHERE id = %L',
    'UPDATE %s SET connector_config = connector_config - ''accord'' WHERE id = %L',
    'UPDATE %s SET connector_config = ''{}''::jsonb WHERE id = %L',
    'UPDATE %s SET connector_config = NULL WHERE id = %L'
  ];
BEGIN
  -- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role = 'org_admin' LIMIT 1;
  SELECT om.user_id INTO v_membre FROM core.organization_members om
  WHERE om.org_id = v_mayer AND om.role IS DISTINCT FROM 'org_admin'
    AND NOT EXISTS (SELECT 1 FROM core.organization_members m2 WHERE m2.user_id = om.user_id AND m2.role = 'org_admin')
  LIMIT 1;
  SELECT om.org_id, om.user_id INTO v_autre, v_etranger FROM core.organization_members om
  WHERE om.org_id <> v_mayer
    AND NOT EXISTS (SELECT 1 FROM core.organization_members m2 WHERE m2.user_id = om.user_id AND m2.org_id = v_mayer)
  LIMIT 1;
  IF v_admin IS NULL OR v_membre IS NULL OR v_etranger IS NULL THEN
    RAISE EXCEPTION 'fixture : il faut un org_admin Mayer, un membre Mayer non admin et un membre d''une autre org';
  END IF;

  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, connector_config, auto_sync, is_active)
  VALUES (v_mayer, 'TEST CONNECTEUR ADMIN', 'woocommerce', 'https://exemple.test', v_cfg, false, true) RETURNING id INTO v_s;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST FOURNISSEUR SIMPLE', true) RETURNING id INTO v_p;

  -- 0. Le trigger existe, sa fonction n'est exécutable ni par PUBLIC ni par anon.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'suppliers_connecteur_admin' AND tgrelid = 'majordhome.suppliers'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'A0 : trigger suppliers_connecteur_admin absent';
  END IF;
  IF has_function_privilege('anon', 'majordhome.suppliers_connecteur_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'A0 : anon peut exécuter majordhome.suppliers_connecteur_admin()';
  END IF;

  -- ── 1. Membre non admin : chaque valeur gardée refusée, par la table ET par la vue d'écriture ─────────────
  SELECT connector, site_url, auto_sync, connector_config, name INTO v_avant FROM majordhome.suppliers WHERE id = v_s;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_membre, 'role', 'authenticated')::text, true);
  FOREACH v_cible IN ARRAY ARRAY['majordhome.suppliers', 'public.majordhome_suppliers_write'] LOOP
    FOREACH v_sql IN ARRAY v_refus LOOP
      v_err := NULL;
      BEGIN
        EXECUTE format(v_sql, v_cible, v_s);
      EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
      END;
      IF v_err IS DISTINCT FROM 'connecteur_admin_requis' THEN
        RAISE EXCEPTION 'A1 : membre non admin, % → attendu connecteur_admin_requis, obtenu %', format(v_sql, v_cible, v_s), COALESCE(v_err, 'aucune erreur');
      END IF;
    END LOOP;
  END LOOP;
  RESET ROLE;
  SELECT connector, site_url, auto_sync, connector_config, name INTO v_apres FROM majordhome.suppliers WHERE id = v_s;
  IF v_apres IS DISTINCT FROM v_avant THEN RAISE EXCEPTION 'A1 : la fiche a bougé malgré les refus : % → %', v_avant, v_apres; END IF;

  -- ── 2. Même membre : nom, remise, autres clés acceptés — y compris connector_config réécrit en entier ──────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_membre, 'role', 'authenticated')::text, true);
  UPDATE majordhome.suppliers SET name = 'TEST CONNECTEUR ADMIN (renommé)', notes = 'note' WHERE id = v_s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'A2 : renommer par la table : % ligne(s)', v_n; END IF;
  UPDATE public.majordhome_suppliers_write SET connector_config = jsonb_set(connector_config, '{pieces,remise_pct}', '25') WHERE id = v_s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'A2 : remise par la vue : % ligne(s)', v_n; END IF;
  -- l'écran renvoie toute la fiche : valeurs gardées identiques (autre ordre de clés), remise et sca_path changés
  UPDATE public.majordhome_suppliers_write
  SET name = 'TEST CONNECTEUR ADMIN', connector = 'woocommerce', site_url = 'https://exemple.test', auto_sync = false,
      connector_config = '{"sca_path": "/autre", "pieces": {"remise_pct": 20}, "accord": {"date": "2026-11-10", "contact": "M. Martin"},
                           "catalogue_pieces": true, "public": true, "site_id": "42"}'::jsonb
  WHERE id = v_s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'A2 : enregistrement complet de la fiche : % ligne(s)', v_n; END IF;
  -- fournisseur SANS connecteur : son site reste modifiable par un membre
  UPDATE majordhome.suppliers SET site_url = 'https://vitrine.test' WHERE id = v_p;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'A2 : site d''un fournisseur sans connecteur : % ligne(s)', v_n; END IF;
  RESET ROLE;
  IF (SELECT connector_config #>> '{pieces,remise_pct}' FROM majordhome.suppliers WHERE id = v_s) <> '20'
     OR (SELECT connector_config ->> 'sca_path' FROM majordhome.suppliers WHERE id = v_s) <> '/autre' THEN
    RAISE EXCEPTION 'A2 : remise / sca_path non écrits';
  END IF;

  -- ── 3. INSERT par le membre : simple accepté (table et vue), avec une valeur gardée refusé ─────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_membre, 'role', 'authenticated')::text, true);
  INSERT INTO majordhome.suppliers (org_id, name, connector_config) VALUES (v_mayer, 'TEST INSERT SIMPLE', '{"pieces": {"remise_pct": 10}}'::jsonb);
  INSERT INTO public.majordhome_suppliers_write (org_id, name, site_url) VALUES (v_mayer, 'TEST INSERT SIMPLE VUE', 'https://vitrine.test');
  FOREACH v_cible IN ARRAY ARRAY['majordhome.suppliers', 'public.majordhome_suppliers_write'] LOOP
    FOREACH v_sql IN ARRAY ARRAY[
      'INSERT INTO %s (org_id, name, connector, site_url) VALUES (%L, ''TEST INSERT REFUSE'', ''woocommerce'', ''https://x.test'')',
      'INSERT INTO %s (org_id, name, auto_sync) VALUES (%L, ''TEST INSERT REFUSE'', true)',
      'INSERT INTO %s (org_id, name, connector_config) VALUES (%L, ''TEST INSERT REFUSE'', ''{"public": true}'')',
      'INSERT INTO %s (org_id, name, connector_config) VALUES (%L, ''TEST INSERT REFUSE'', ''{"catalogue_pieces": true}'')',
      'INSERT INTO %s (org_id, name, connector_config) VALUES (%L, ''TEST INSERT REFUSE'', ''{"accord": {"contact": "X", "date": "2026-01-01"}}'')'
    ] LOOP
      v_err := NULL;
      BEGIN
        EXECUTE format(v_sql, v_cible, v_mayer);
      EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
      END;
      IF v_err IS DISTINCT FROM 'connecteur_admin_requis' THEN
        RAISE EXCEPTION 'A3 : % → attendu connecteur_admin_requis, obtenu %', format(v_sql, v_cible, v_mayer), COALESCE(v_err, 'aucune erreur');
      END IF;
    END LOOP;
  END LOOP;
  -- auth.uid() NULL sous authenticated : la garde refuse (le trigger BEFORE passe avant le WITH CHECK de la RLS)
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  v_err := NULL;
  BEGIN
    INSERT INTO majordhome.suppliers (org_id, name, connector) VALUES (v_mayer, 'TEST INSERT SANS UID', 'woocommerce');
  EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'connecteur_admin_requis' THEN RAISE EXCEPTION 'A3 : auth.uid() NULL → obtenu %', COALESCE(v_err, 'aucune erreur'); END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM majordhome.suppliers WHERE name IN ('TEST INSERT SIMPLE', 'TEST INSERT SIMPLE VUE')) <> 2 THEN
    RAISE EXCEPTION 'A3 : inserts simples absents';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.suppliers WHERE name IN ('TEST INSERT REFUSE', 'TEST INSERT SANS UID')) THEN
    RAISE EXCEPTION 'A3 : un insert refusé a laissé une ligne';
  END IF;

  -- ── 4. org_admin : tout accepté ──────────────────────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  UPDATE public.majordhome_suppliers_write
  SET site_url = 'https://nouveau.test', auto_sync = true,
      connector_config = connector_config || '{"public": true, "catalogue_pieces": true, "accord": {"contact": "Mme Durand", "date": "2026-11-12"}}'::jsonb
  WHERE id = v_s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'A4 : admin, vue : % ligne(s)', v_n; END IF;
  UPDATE majordhome.suppliers SET connector = 'suitecommerce' WHERE id = v_s;
  UPDATE majordhome.suppliers SET connector = 'woocommerce', connector_config = connector_config - 'accord' WHERE id = v_s;
  UPDATE majordhome.suppliers SET connector_config = connector_config || '{"accord": {"contact": "Mme Durand", "date": "2026-11-12"}}'::jsonb, auto_sync = false WHERE id = v_s;
  INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, auto_sync, connector_config)
  VALUES (v_mayer, 'TEST INSERT ADMIN', 'woocommerce', 'https://admin.test', true, '{"public": true, "catalogue_pieces": true}'::jsonb)
  RETURNING id INTO v_ins;
  RESET ROLE;
  IF (SELECT site_url FROM majordhome.suppliers WHERE id = v_s) <> 'https://nouveau.test'
     OR (SELECT connector_config #>> '{accord,contact}' FROM majordhome.suppliers WHERE id = v_s) <> 'Mme Durand'
     OR v_ins IS NULL THEN
    RAISE EXCEPTION 'A4 : écritures de l''org_admin non appliquées';
  END IF;

  -- ── 5. Membre d'une AUTRE org : refusé par la RLS existante (0 ligne, rien ne bouge ; insert hors org refusé) ─
  SELECT connector, site_url, auto_sync, connector_config, name INTO v_avant FROM majordhome.suppliers WHERE id = v_s;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_etranger, 'role', 'authenticated')::text, true);
  UPDATE majordhome.suppliers SET connector = 'suitecommerce', name = 'PIRATE' WHERE id = v_s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'A5 : membre d''une autre org a modifié % ligne(s)', v_n; END IF;
  UPDATE public.majordhome_suppliers_write SET name = 'PIRATE' WHERE id = v_s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'A5 : membre d''une autre org a modifié % ligne(s) par la vue', v_n; END IF;
  v_ok := false;
  BEGIN
    INSERT INTO majordhome.suppliers (org_id, name) VALUES (v_mayer, 'TEST INSERT ETRANGER');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'A5 : un membre d''une autre org a inséré un fournisseur Mayer'; END IF;
  RESET ROLE;
  SELECT connector, site_url, auto_sync, connector_config, name INTO v_apres FROM majordhome.suppliers WHERE id = v_s;
  IF v_apres IS DISTINCT FROM v_avant THEN RAISE EXCEPTION 'A5 : la fiche a bougé'; END IF;

  -- ── 6. service_role et l'écrivain SECURITY DEFINER : non gênés ───────────────────────────────────────────
  -- Le harnais ne photographie pas les ACL par objet : si service_role n'a pas UPDATE sur la table, on le lui
  -- accorde le temps de la preuve (cluster jetable) — la preuve porte sur le trigger, pas sur l'ACL de prod.
  IF NOT has_table_privilege('service_role', 'majordhome.suppliers', 'UPDATE') THEN
    GRANT UPDATE ON majordhome.suppliers TO service_role;
    v_grant_sr := true;
  END IF;
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.majordhome_suppliers_write
  SET catalog_sync_result = '{"ok": true, "total": 1}'::jsonb, catalog_sync_error = NULL, auto_sync = true,
      site_url = 'https://service.test', connector_config = connector_config || '{"public": true}'::jsonb
  WHERE id = v_s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'A6 : service_role : % ligne(s)', v_n; END IF;
  -- relevé de pièces par l'écrivain unique (met à jour suppliers.catalog_sync_result sous son propriétaire)
  v_res := public.supplier_pieces_upsert(v_mayer, v_s, 'essai-connecteur-admin', 'CATALOGUE', $j$[
    {"reference":"TST-CONN-1","name":"Joint de test connecteur","brand":"MCZ","category":"piece_detachee",
     "product_kind":"accessory","unit":"pièce","default_tva_rate":20,"tarif_public":10,"taux_remise":0,
     "purchase_price_ht":10,"selling_price_ht_defaut":10,
     "specs":{"source_version":"essai-connecteur-admin","canonical":{"catalogue_pieces":true,"rayons":["Pièces détachées MCZ"],
       "prix_public_ttc":12,"stock_releve":{"en_stock":true,"at":"2026-11-13T03:00:00.000Z"}}}}]$j$::jsonb);
  RESET ROLE;
  IF v_grant_sr THEN REVOKE UPDATE ON majordhome.suppliers FROM service_role; END IF;
  IF (v_res ->> 'ok') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'A6 : supplier_pieces_upsert : %', v_res; END IF;
  IF (SELECT catalog_sync_result ->> 'releve' FROM majordhome.suppliers WHERE id = v_s) IS DISTINCT FROM 'pieces' THEN
    RAISE EXCEPTION 'A6 : catalog_sync_result du relevé de pièces non écrit';
  END IF;
  IF (SELECT site_url FROM majordhome.suppliers WHERE id = v_s) <> 'https://service.test' THEN
    RAISE EXCEPTION 'A6 : écriture service_role non appliquée';
  END IF;

  -- ── Nettoyage ────────────────────────────────────────────────────────────────────────────────────────────
  SELECT array_agg(DISTINCT sp.catalog_item_id) INTO v_items FROM majordhome.supplier_products sp
  WHERE sp.supplier_id = v_s AND sp.catalog_item_id IS NOT NULL;
  DELETE FROM majordhome.supplier_products WHERE supplier_id = v_s;
  DELETE FROM majordhome.catalog_items WHERE id = ANY (COALESCE(v_items, '{}'::uuid[]));
  DELETE FROM majordhome.suppliers
  WHERE id IN (v_s, v_p, v_ins) OR (org_id = v_mayer AND name IN ('TEST INSERT SIMPLE', 'TEST INSERT SIMPLE VUE'));

  RAISE NOTICE 'assert-suppliers-connecteur-admin : OK (membre % non admin refusé sur 11 × 2 écritures et 5 × 2 inserts, admin %, autre org %, service_role et supplier_pieces_upsert non gênés)',
    v_membre, v_admin, v_etranger;
END $$;
