-- scripts/migration-rehearsal/assert-fumisterie-fabricants.sql — vérifie 20261128_1_fumisterie_fabricants.sql
-- (chaîne : 20260929_1_fumisterie_tables.sql → 20261128_1_fumisterie_fabricants.sql).
DO $$
DECLARE n int; v_der text;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'majordhome' AND table_name = 'fum_metres' AND column_name = 'supplier_id';
  IF n <> 1 THEN RAISE EXCEPTION 'fum_metres.supplier_id absente'; END IF;
  SELECT column_name INTO v_der FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_fum_metres' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_der IS DISTINCT FROM 'supplier_id' THEN RAISE EXCEPTION 'majordhome_fum_metres : dernière colonne % au lieu de supplier_id', v_der; END IF;
END;
$$;

DO $$
DECLARE
  n int; ok boolean; v_n int; r record;
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_membre uuid; v_autre uuid; v_etranger uuid;
  v_sup uuid; v_sup_autre uuid;
BEGIN
  SELECT count(*) INTO n FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_fum_metres' AND is_updatable = 'YES';
  IF n <> 1 THEN RAISE EXCEPTION 'majordhome_fum_metres n''est plus un miroir modifiable'; END IF;
  FOR r IN SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname IN ('majordhome_fum_metres', 'majordhome_fum_gamme_equivalences', 'majordhome_fum_fabricants') LOOP
    IF coalesce(r.reloptions::text, '') NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'vue % sans security_invoker', r.relname; END IF;
    IF has_table_privilege('anon', 'public.' || r.relname, 'SELECT') THEN RAISE EXCEPTION 'anon lit %', r.relname; END IF;
    IF NOT has_table_privilege('service_role', 'public.' || r.relname, 'SELECT') THEN RAISE EXCEPTION 'service_role ne lit pas %', r.relname; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname IN ('majordhome_fum_gamme_equivalences', 'majordhome_fum_fabricants');
  IF n <> 2 THEN RAISE EXCEPTION '% vue(s) créée(s) au lieu de 2', n; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.fum_gamme_equivalences'::regclass) THEN RAISE EXCEPTION 'RLS absente sur fum_gamme_equivalences'; END IF;
  IF has_table_privilege('anon', 'majordhome.fum_gamme_equivalences', 'SELECT') THEN RAISE EXCEPTION 'anon lit fum_gamme_equivalences'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.fum_gamme_equivalences', 'SELECT') THEN RAISE EXCEPTION 'service_role ne lit pas fum_gamme_equivalences'; END IF;
  IF has_table_privilege('service_role', 'majordhome.fum_gamme_equivalences', 'INSERT') THEN RAISE EXCEPTION 'service_role écrit fum_gamme_equivalences (charte : écritures par l''écran org_admin ou SQL)'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'fum_gamme_equivalences';
  IF n <> 2 THEN RAISE EXCEPTION 'fum_gamme_equivalences : % policies au lieu de 2', n; END IF;

  -- ── 2. Fixture : un org_admin et un membre non admin de Mayer, une autre organisation et un de ses membres ──
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role = 'org_admin' LIMIT 1;
  SELECT om.user_id INTO v_membre FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role <> 'org_admin' LIMIT 1;
  SELECT o.id INTO v_autre FROM core.organizations o WHERE o.id <> v_mayer
    AND EXISTS (SELECT 1 FROM core.organization_members om WHERE om.org_id = o.id AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer)) LIMIT 1;
  SELECT om.user_id INTO v_etranger FROM core.organization_members om WHERE om.org_id = v_autre
    AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer) LIMIT 1;
  IF v_admin IS NULL OR v_membre IS NULL OR v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : admin, membre Mayer et membre d''une autre org requis'; END IF;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_mayer, 'TEST FAB DINAK', true) RETURNING id INTO v_sup;
  INSERT INTO majordhome.suppliers (org_id, name, is_active) VALUES (v_autre, 'TEST FAB autre org', true) RETURNING id INTO v_sup_autre;

  -- ── 3. org_admin : écrit l'équivalence de son org ; refusé avec le fournisseur d'une autre org ─────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  INSERT INTO public.majordhome_fum_gamme_equivalences (org_id, configuration_code, gamme_catalogue, supplier_id, gamme_tarif, finition, longueurs_elements_mm, reglable_min_mm, reglable_max_mm)
  VALUES (v_mayer, 'CFG-24', 'PTR30', v_sup, 'DW BOIS BLACK', 'noir', ARRAY[940, 440, 270], 350, 530);
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_fum_gamme_equivalences (org_id, configuration_code, gamme_catalogue, supplier_id, gamme_tarif)
    VALUES (v_mayer, 'CFG-24', 'PTR30', v_sup_autre, 'X');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'org_admin : équivalence acceptée avec le fournisseur d''une autre organisation'; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_fum_gamme_equivalences (org_id, configuration_code, gamme_catalogue, supplier_id, gamme_tarif, finition)
    VALUES (v_mayer, 'CFG-24', 'PTR30', v_sup, 'DW BOIS BLACK', 'noir');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'doublon d''équivalence accepté'; END IF;
  -- supplier_id sur un métré : colonne écrivable par la vue (le métré est écrit par tout membre)
  PERFORM 1 FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'majordhome_fum_metres'
    AND column_name = 'supplier_id' AND privilege_type = 'INSERT' AND grantee = 'authenticated';
  IF NOT FOUND THEN RAISE EXCEPTION 'authenticated ne peut pas écrire supplier_id par la vue'; END IF;

  -- ── 4. membre non admin : lit, n'écrit pas ─────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  SELECT count(*) INTO n FROM public.majordhome_fum_gamme_equivalences WHERE supplier_id = v_sup;
  IF n <> 1 THEN RAISE EXCEPTION 'membre Mayer : % équivalence(s) lue(s) au lieu de 1', n; END IF;
  UPDATE public.majordhome_fum_gamme_equivalences SET validee_par = 'X', validee_le = current_date WHERE supplier_id = v_sup;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'membre non admin : validation d''équivalence acceptée'; END IF;

  -- ── 5. membre d'une autre organisation : ne voit rien de Mayer ─────────────────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, true);
  SELECT count(*) INTO n FROM public.majordhome_fum_gamme_equivalences WHERE org_id = v_mayer;
  IF n <> 0 THEN RAISE EXCEPTION 'cross-org : % équivalence(s) Mayer visible(s)', n; END IF;
  SELECT count(*) INTO n FROM public.majordhome_fum_fabricants WHERE org_id = v_mayer;
  IF n <> 0 THEN RAISE EXCEPTION 'cross-org : % fabricant(s) Mayer visible(s)', n; END IF;

  RESET ROLE;
  RAISE NOTICE 'assert-fumisterie-fabricants OK';
END;
$$;
