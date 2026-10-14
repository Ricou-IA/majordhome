-- assert-webshop-editeur.sql — vérifie 20261014_1_webshop_editeur.sql. Un écart lève une exception.

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; v_last text;
BEGIN
  -- Policies catalogue : plus aucune écriture « tout membre »
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='majordhome' AND tablename='webshop_products'
    AND policyname IN ('webshop_products_insert_org_members','webshop_products_update_org_members','webshop_products_delete_org_members');
  IF n <> 0 THEN RAISE EXCEPTION 'policies membres encore présentes sur webshop_products (%)', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='majordhome' AND tablename='webshop_products'
    AND cmd IN ('INSERT','UPDATE','DELETE') AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%org_admin%';
  IF n <> 3 THEN RAISE EXCEPTION 'attendu 3 policies org_admin en écriture sur webshop_products, trouvé %', n; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='majordhome' AND tablename='webshop_categories' AND policyname='webshop_categories_org') THEN
    RAISE EXCEPTION 'webshop_categories_org (ALL membres) toujours présente'; END IF;

  -- Vue : delivery_instructions conservée, dernière colonne, security_invoker
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_webshop_orders' AND column_name='delivery_instructions') THEN
    RAISE EXCEPTION 'majordhome_webshop_orders a perdu delivery_instructions'; END IF;
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema='public' AND table_name='majordhome_webshop_orders' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'pickup_point_name' THEN RAISE EXCEPTION 'majordhome_webshop_orders : dernière colonne % au lieu de pickup_point_name', v_last; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.majordhome_webshop_orders'::regclass AND reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'majordhome_webshop_orders a perdu security_invoker'; END IF;

  -- Storage : 4 policies posées
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='storage' AND policyname LIKE 'webshop_images_%';
  IF n <> 4 THEN RAISE EXCEPTION 'attendu 4 policies storage webshop_images_*, trouvé %', n; END IF;
  RAISE NOTICE 'assert-webshop-editeur A (structure) : OK';
END $$;

-- ── B. Droits : un membre non admin ne modifie pas un produit, l'admin oui ──
DO $$
DECLARE v_org uuid; v_admin uuid; v_member uuid; v_prod uuid; n int;
BEGIN
  SELECT org_id, id INTO v_org, v_prod FROM majordhome.webshop_products LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'assert B : aucun produit dans le snapshot'; END IF;
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_org AND role = 'org_admin' AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_member FROM core.organization_members WHERE org_id = v_org AND role <> 'org_admin' AND user_id IS NOT NULL LIMIT 1;

  IF v_member IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.majordhome_webshop_products SET name = name WHERE id = v_prod AND org_id = v_org;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    IF n <> 0 THEN RAISE EXCEPTION 'un membre non admin a pu modifier un produit'; END IF;
    -- mais il lit toujours le catalogue
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.majordhome_webshop_products WHERE org_id = v_org;
    RESET ROLE;
    IF n = 0 THEN RAISE EXCEPTION 'un membre non admin ne lit plus le catalogue'; END IF;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.majordhome_webshop_products SET name = name WHERE id = v_prod AND org_id = v_org;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'l''admin ne peut pas modifier un produit (% ligne)', n; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-webshop-editeur B (droits) : OK';
END $$;
