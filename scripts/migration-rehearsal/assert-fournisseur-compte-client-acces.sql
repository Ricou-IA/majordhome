-- assert-fournisseur-compte-client-acces.sql — vérifie 20261124_1_fournisseur_compte_client_acces.sql
-- Chaîne : 20261024_2 (org_secret_* et leurs privilèges) puis 20261124_1.
-- Couvre : colonne customer_account dans les deux miroirs (en fin, security_invoker, insérable par la vue d'écriture),
-- supplier_credentials_reveal : anon n'exécute rien, appelant anonyme / membre non admin / admin d'une autre org /
-- fournisseur d'une autre org refusés, org_admin relit identifiant et mot de passe, rien ⇒ NULL.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre_org uuid;
  v_sup uuid;
  v_sup_autre uuid;
  v_admin uuid;
  v_membre uuid;
  v_res jsonb;
  v_n int;
  ok boolean;
BEGIN
  IF has_function_privilege('anon', 'public.supplier_credentials_reveal(uuid, uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon exécute supplier_credentials_reveal'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.supplier_credentials_reveal(uuid, uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated n''exécute pas supplier_credentials_reveal'; END IF;

  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('majordhome_suppliers', 'majordhome_suppliers_write') AND column_name = 'customer_account';
  IF v_n <> 2 THEN RAISE EXCEPTION 'customer_account absente d''une vue (%/2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('majordhome_suppliers', 'majordhome_suppliers_write')
     AND c.reloptions::text LIKE '%security_invoker=true%';
  IF v_n <> 2 THEN RAISE EXCEPTION 'security_invoker perdu sur une vue fournisseurs'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_suppliers', 'SELECT') THEN RAISE EXCEPTION 'anon lit majordhome_suppliers'; END IF;

  -- fixture
  SELECT id INTO v_autre_org FROM core.organizations WHERE id <> v_mayer LIMIT 1;
  INSERT INTO majordhome.suppliers (org_id, name, is_active, customer_account) VALUES (v_mayer, 'TEST ACCES', true, 'CL-0042') RETURNING id INTO v_sup;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_autre_org, 'TEST ACCES AUTRE', true) RETURNING id INTO v_sup_autre;
  IF (SELECT customer_account FROM public.majordhome_suppliers WHERE id = v_sup) <> 'CL-0042' THEN RAISE EXCEPTION 'compte client non relu par la vue'; END IF;
  UPDATE public.majordhome_suppliers_write SET customer_account = '  ' WHERE id = v_sup;
  ok := false;
  BEGIN UPDATE majordhome.suppliers SET customer_account = repeat('x', 61) WHERE id = v_sup; EXCEPTION WHEN check_violation THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'compte client de 61 caractères accepté'; END IF;

  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' AND status = 'active' LIMIT 1;
  SELECT user_id INTO v_membre FROM core.organization_members WHERE org_id = v_mayer AND role <> 'org_admin' LIMIT 1;
  IF v_admin IS NULL OR v_membre IS NULL THEN RAISE EXCEPTION 'fixture : membres Mayer absents du snapshot'; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  -- rien d'enregistré ⇒ NULL
  IF public.supplier_credentials_reveal(v_mayer, v_sup) IS NOT NULL THEN RAISE EXCEPTION 'accès inventés'; END IF;
  PERFORM public.org_secret_set(v_mayer, 'supplier:' || v_sup::text || ':credentials', '{"email":"CL-0042","password":"s3cret"}');
  v_res := public.supplier_credentials_reveal(v_mayer, v_sup);
  IF v_res->>'identifiant' <> 'CL-0042' OR v_res->>'mot_de_passe' <> 's3cret' THEN RAISE EXCEPTION 'relecture : %', v_res; END IF;
  -- fournisseur d'une autre organisation passé avec notre org
  ok := false;
  BEGIN PERFORM public.supplier_credentials_reveal(v_mayer, v_sup_autre); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'fournisseur d''une autre org relu'; END IF;
  -- notre fournisseur demandé au nom d'une autre organisation (où l'appelant n'est pas admin)
  ok := false;
  BEGIN PERFORM public.supplier_credentials_reveal(v_autre_org, v_sup); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'relecture au nom d''une autre org'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  ok := false;
  BEGIN PERFORM public.supplier_credentials_reveal(v_mayer, v_sup); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un membre non admin a relu les accès'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  ok := false;
  BEGIN PERFORM public.supplier_credentials_reveal(v_mayer, v_sup); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'un appelant anonyme a relu les accès'; END IF;
  RESET ROLE;

  RAISE NOTICE 'assert-fournisseur-compte-client-acces : OK';
END $$;
