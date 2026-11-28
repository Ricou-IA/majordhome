-- assert-aspirateur.sql — vérifie 20261129_1_aspirateur.sql (aspirateur de sites fournisseurs, tranche 1).
-- Recettes communes (service_role seul), journal des travaux et propositions (lecture membre), RPC service_role,
-- deux RPC d'écran. Impersonation : SET LOCAL ROLE authenticated + request.jwt.claim.sub. Fixtures supprimées en fin.
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre uuid;
  v_admin uuid;            -- org_admin actif de Mayer
  v_etranger uuid;         -- membre de l'autre org, pas de Mayer
  v_sup uuid; v_sup_a uuid;
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_rec uuid; v_rec2 uuid;
  v_ok boolean;
  v_n int;
  v_j jsonb;
  f text; r text; p text;
  v_service text[] := ARRAY[
    'public.aspiration_ouvrir(uuid, uuid, text, text, uuid, numeric, uuid)',
    'public.aspiration_quota(uuid, integer)',
    'public.aspiration_cout_ajouter(uuid, numeric)',
    'public.aspiration_recette_enregistrer(uuid, jsonb, text[])',
    'public.aspiration_recette_a_utiliser(uuid)',
    'public.aspiration_essai(uuid, jsonb)',
    'public.aspiration_propositions_ajouter(uuid, jsonb)',
    'public.aspiration_clore(uuid, text, text, jsonb, jsonb)',
    'public.aspiration_recette_promouvoir(uuid)'];
  v_ecran text[] := ARRAY[
    'public.aspiration_recette_etat(uuid, text)',
    'public.catalogue_propositions_decider(uuid, uuid[], text)'];
  v_recette jsonb := '{"schema":1,"domaine":"pro.exemple-test.fr","listes":{"departs":["https://pro.exemple-test.fr/poeles"],"lien_produit":"a.p"},"produit":{"nom":"h1","reference":".ref"}}';
BEGIN
  -- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────
  SELECT om.user_id INTO v_admin FROM core.organization_members om
   WHERE om.org_id = v_mayer AND om.role = 'org_admin' AND om.status = 'active' LIMIT 1;
  SELECT om.org_id, om.user_id INTO v_autre, v_etranger FROM core.organization_members om
   WHERE om.org_id <> v_mayer AND om.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM core.organization_members m2 WHERE m2.user_id = om.user_id AND m2.org_id = v_mayer)
   LIMIT 1;
  IF v_admin IS NULL OR v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : il faut un org_admin Mayer et un membre d''une autre org'; END IF;
  INSERT INTO majordhome.suppliers (org_id, name) VALUES (v_mayer, 'ASPIRATEUR TEST') RETURNING id INTO v_sup;
  INSERT INTO majordhome.suppliers (org_id, name) VALUES (v_autre, 'ASPIRATEUR TEST AUTRE') RETURNING id INTO v_sup_a;

  -- ── 1. Droits : anon n'a rien ; service RPC fermées à anon / authenticated ; RPC d'écran ouvertes à authenticated ──
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    FOREACH f IN ARRAY ARRAY['majordhome.site_recettes', 'majordhome.aspirations', 'majordhome.catalogue_propositions',
                             'public.majordhome_aspirations', 'public.majordhome_catalogue_propositions'] LOOP
      IF has_table_privilege('anon', f, p) THEN RAISE EXCEPTION '(1) anon a % sur %', p, f; END IF;
      IF p <> 'SELECT' AND has_table_privilege('authenticated', f, p) THEN RAISE EXCEPTION '(1) authenticated a % sur %', p, f; END IF;
    END LOOP;
    IF has_table_privilege('authenticated', 'majordhome.site_recettes', p) THEN RAISE EXCEPTION '(1) authenticated a % sur les recettes', p; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['majordhome.site_recettes', 'majordhome.aspirations', 'majordhome.catalogue_propositions'] LOOP
    IF NOT has_table_privilege('service_role', f, 'SELECT') THEN RAISE EXCEPTION '(1) service_role sans SELECT sur %', f; END IF;
  END LOOP;
  FOREACH f IN ARRAY v_service LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(r, f, 'EXECUTE') THEN RAISE EXCEPTION '(1) % peut exécuter %', r, f; END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION '(1) service_role ne peut pas exécuter %', f; END IF;
  END LOOP;
  FOREACH f IN ARRAY v_ecran LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '(1) anon peut exécuter %', f; END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '(1) authenticated ne peut pas exécuter %', f; END IF;
  END LOOP;

  -- ── 2. ouvrir : fournisseur d'une autre org refusé ; un seul travail en cours par domaine ; travail périmé libéré ──
  v_ok := false;
  BEGIN PERFORM public.aspiration_ouvrir(v_mayer, v_sup_a, 'pro.exemple-test.fr', 'apprentissage', v_admin, 3);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := (SQLERRM = 'non_autorise'); END;
  IF NOT v_ok THEN RAISE EXCEPTION '(2) fournisseur d''une autre org accepté'; END IF;

  v_a1 := public.aspiration_ouvrir(v_mayer, v_sup, 'PRO.Exemple-Test.fr', 'apprentissage', v_admin, 3);
  IF (SELECT domaine FROM majordhome.aspirations WHERE id = v_a1) IS DISTINCT FROM 'pro.exemple-test.fr' THEN RAISE EXCEPTION '(2) domaine non normalisé'; END IF;
  v_ok := false;
  BEGIN PERFORM public.aspiration_ouvrir(v_autre, v_sup_a, 'pro.exemple-test.fr', 'aspiration', v_etranger, 3);
  EXCEPTION WHEN lock_not_available THEN v_ok := (SQLERRM = 'deja_en_cours'); END;
  IF NOT v_ok THEN RAISE EXCEPTION '(2) deux travaux simultanés sur un même domaine'; END IF;

  UPDATE majordhome.aspirations SET lance_le = now() - interval '4 hours' WHERE id = v_a1;
  v_a2 := public.aspiration_ouvrir(v_mayer, v_sup, 'pro.exemple-test.fr', 'apprentissage', v_admin, 3);
  IF (SELECT statut || '/' || coalesce(code_erreur, '') FROM majordhome.aspirations WHERE id = v_a1) IS DISTINCT FROM 'echec/service_indisponible' THEN
    RAISE EXCEPTION '(2) travail périmé non libéré';
  END IF;

  -- ── 3. coût : cumul et plafond ───────────────────────────────────────────────────────────────────────────
  v_j := public.aspiration_cout_ajouter(v_a2, 1.25);
  IF (v_j->>'depasse')::boolean IS DISTINCT FROM false OR (v_j->>'cout_usd')::numeric <> 1.25 THEN RAISE EXCEPTION '(3) cumul inattendu : %', v_j; END IF;
  v_j := public.aspiration_cout_ajouter(v_a2, 2);
  IF (v_j->>'depasse')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION '(3) plafond non signalé : %', v_j; END IF;

  -- ── 4. recette : secret refusé (sans casse) ; sinon version 1 en essai liée au travail ───────────────────
  v_ok := false;
  BEGIN PERFORM public.aspiration_recette_enregistrer(v_a2, v_recette || '{"x":"Bonjour ERIC@exemple.fr"}', ARRAY['eric@exemple.fr', 'ab']);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := (SQLERRM = 'recette_contient_secret'); END;
  IF NOT v_ok THEN RAISE EXCEPTION '(4) recette avec secret acceptée'; END IF;
  v_rec := public.aspiration_recette_enregistrer(v_a2, v_recette, ARRAY['eric@exemple.fr', 'ab', NULL]);
  IF (SELECT version || '/' || statut FROM majordhome.site_recettes WHERE id = v_rec) IS DISTINCT FROM '1/essai' THEN RAISE EXCEPTION '(4) version inattendue'; END IF;
  IF (SELECT recette_id FROM majordhome.aspirations WHERE id = v_a2) IS DISTINCT FROM v_rec THEN RAISE EXCEPTION '(4) recette non liée au travail'; END IF;
  IF (public.aspiration_recette_a_utiliser(v_a2)->>'recette_id')::uuid IS DISTINCT FROM v_rec THEN RAISE EXCEPTION '(4) recette à utiliser inattendue'; END IF;

  -- ── 5. essai puis confirmation : aspiration liée à la recette en essai, propositions, promotion ────────────
  PERFORM public.aspiration_essai(v_a2, '[{"nom":"Châtel"}]');
  IF (SELECT statut FROM majordhome.aspirations WHERE id = v_a2) IS DISTINCT FROM 'attente_confirmation' THEN RAISE EXCEPTION '(5) pas en attente de confirmation'; END IF;
  PERFORM public.aspiration_clore(v_a2, 'termine', NULL, NULL, NULL);
  v_a3 := public.aspiration_ouvrir(v_mayer, v_sup, 'pro.exemple-test.fr', 'aspiration', v_admin, 20, v_rec);
  v_n := public.aspiration_propositions_ajouter(v_a3, '[{"reference":"P1","genre":"caracteristique","cle":"etas_pct","valeur":67,"cochee":true,"source_url":"https://pro.exemple-test.fr/p/1","provenance":"compte"}]');
  IF v_n <> 1 OR (SELECT org_id FROM majordhome.catalogue_propositions WHERE aspiration_id = v_a3) IS DISTINCT FROM v_mayer THEN
    RAISE EXCEPTION '(5) proposition non rangée dans l''org du travail';
  END IF;
  PERFORM public.aspiration_clore(v_a3, 'termine', NULL, '{"trouves":10,"lus":10,"echecs":2}', '[]');
  IF public.aspiration_recette_promouvoir(v_a3) IS NOT TRUE THEN RAISE EXCEPTION '(5) promotion refusée'; END IF;
  IF (SELECT statut FROM majordhome.site_recettes WHERE id = v_rec) IS DISTINCT FROM 'active' THEN RAISE EXCEPTION '(5) recette non active'; END IF;

  -- 5 bis. une seconde version promue retire la première ; trop d'échecs ⇒ pas de promotion
  v_a1 := public.aspiration_ouvrir(v_mayer, v_sup, 'pro.exemple-test.fr', 'apprentissage', v_admin, 3);
  v_rec2 := public.aspiration_recette_enregistrer(v_a1, v_recette, NULL);
  PERFORM public.aspiration_clore(v_a1, 'termine', NULL, NULL, NULL);
  v_a1 := public.aspiration_ouvrir(v_mayer, v_sup, 'pro.exemple-test.fr', 'aspiration', v_admin, 20, v_rec2);
  PERFORM public.aspiration_clore(v_a1, 'termine', NULL, '{"lus":10,"echecs":6}', '[]');
  IF public.aspiration_recette_promouvoir(v_a1) IS NOT FALSE THEN RAISE EXCEPTION '(5 bis) promue malgré trop d''échecs'; END IF;
  v_a1 := public.aspiration_ouvrir(v_mayer, v_sup, 'pro.exemple-test.fr', 'aspiration', v_admin, 20, v_rec2);
  PERFORM public.aspiration_clore(v_a1, 'termine', NULL, '{"lus":10,"echecs":1}', '[]');
  IF public.aspiration_recette_promouvoir(v_a1) IS NOT TRUE THEN RAISE EXCEPTION '(5 bis) seconde version non promue'; END IF;
  IF (SELECT string_agg(version || ':' || statut, ',' ORDER BY version) FROM majordhome.site_recettes WHERE domaine = 'pro.exemple-test.fr')
     IS DISTINCT FROM '1:retiree,2:active' THEN RAISE EXCEPTION '(5 bis) versions inattendues'; END IF;

  -- ── 6. quota du jour ────────────────────────────────────────────────────────────────────────────────────
  IF public.aspiration_quota(v_mayer, 100) IS NOT TRUE THEN RAISE EXCEPTION '(6) quota large refusé'; END IF;
  IF public.aspiration_quota(v_mayer, 2) IS NOT FALSE THEN RAISE EXCEPTION '(6) quota dépassé accepté'; END IF;

  -- ── 7. écran : membre de Mayer, puis étranger ──────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_j := public.aspiration_recette_etat(v_mayer, 'pro.exemple-test.fr');
  IF v_j IS DISTINCT FROM '{"connue": true, "en_cours": false}'::jsonb THEN RAISE EXCEPTION '(7) état inattendu : %', v_j; END IF;
  SELECT count(*) INTO v_n FROM public.majordhome_catalogue_propositions WHERE aspiration_id = v_a3;
  IF v_n <> 1 THEN RAISE EXCEPTION '(7) le membre ne lit pas sa proposition'; END IF;
  v_n := public.catalogue_propositions_decider(v_mayer, ARRAY(SELECT id FROM public.majordhome_catalogue_propositions WHERE aspiration_id = v_a3), 'appliquee');
  IF v_n <> 1 THEN RAISE EXCEPTION '(7) décision non appliquée'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_etranger, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.majordhome_catalogue_propositions WHERE org_id = v_mayer;
  IF v_n <> 0 THEN RAISE EXCEPTION '(7) un étranger lit % propositions de Mayer', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.majordhome_aspirations WHERE org_id = v_mayer;
  IF v_n <> 0 THEN RAISE EXCEPTION '(7) un étranger lit % travaux de Mayer', v_n; END IF;
  v_ok := false;
  BEGIN PERFORM public.aspiration_recette_etat(v_mayer, 'pro.exemple-test.fr');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION '(7) état lisible par un étranger'; END IF;
  v_ok := false;
  BEGIN PERFORM public.catalogue_propositions_decider(v_mayer, ARRAY[gen_random_uuid()], 'ecartee');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION '(7) un étranger décide pour Mayer'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  v_ok := false;
  BEGIN PERFORM public.aspiration_recette_etat(v_mayer, 'pro.exemple-test.fr');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION '(7) état lisible sans session'; END IF;
  SET LOCAL ROLE postgres;

  -- ── Nettoyage ─────────────────────────────────────────────────────────────────────────────────────────────
  DELETE FROM majordhome.suppliers WHERE id IN (v_sup, v_sup_a); -- cascade : travaux, propositions
  DELETE FROM majordhome.site_recettes WHERE domaine = 'pro.exemple-test.fr';
  RAISE NOTICE 'assert-aspirateur : OK';
END $$;
