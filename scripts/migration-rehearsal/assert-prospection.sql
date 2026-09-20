-- assert-prospection.sql — vérifie 20260920_2_prospection_tables_vues.sql sur le cluster
-- de répétition. Un écart lève une exception → run.mjs sort en ECHEC.
-- Couvre : structure, updatabilité des vues (le front écrit à travers elles),
-- privilèges par rôle, puis un parcours fonctionnel en rôle `authenticated`
-- (upsert ON CONFLICT DO NOTHING du screener, doublon, update + trigger,
-- interaction + nom d'auteur, isolation cross-org, anon, cascade).

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; r record;
BEGIN
  IF to_regclass('majordhome.prospects') IS NULL THEN RAISE EXCEPTION 'table prospects absente'; END IF;
  IF to_regclass('majordhome.prospect_interactions') IS NULL THEN RAISE EXCEPTION 'table prospect_interactions absente'; END IF;
  IF to_regclass('public.majordhome_prospects') IS NULL THEN RAISE EXCEPTION 'vue majordhome_prospects absente'; END IF;
  IF to_regclass('public.majordhome_prospect_interactions') IS NULL THEN RAISE EXCEPTION 'vue majordhome_prospect_interactions absente'; END IF;

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relname IN ('prospects', 'prospect_interactions') AND c.relrowsecurity;
  IF n <> 2 THEN RAISE EXCEPTION 'RLS activée sur % table(s) au lieu de 2', n; END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'prospects';
  IF n <> 4 THEN RAISE EXCEPTION 'prospects : % policies au lieu de 4', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'prospect_interactions';
  IF n <> 2 THEN RAISE EXCEPTION 'prospect_interactions : % policies au lieu de 2', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome'
   AND tablename IN ('prospects', 'prospect_interactions') AND roles <> '{authenticated}';
  IF n <> 0 THEN RAISE EXCEPTION '% policy(ies) non restreinte(s) à authenticated', n; END IF;

  -- Vues : security_invoker + AUTO-UPDATABLE (insert/update/delete via PostgREST)
  FOR r IN SELECT v.table_name, v.is_updatable, v.is_insertable_into, c.reloptions
             FROM information_schema.views v
             JOIN pg_class c ON c.relname = v.table_name
             JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = v.table_schema
            WHERE v.table_schema = 'public'
              AND v.table_name IN ('majordhome_prospects', 'majordhome_prospect_interactions')
  LOOP
    IF NOT ('security_invoker=true' = ANY (r.reloptions)) THEN RAISE EXCEPTION 'vue % sans security_invoker', r.table_name; END IF;
    IF r.is_insertable_into <> 'YES' THEN RAISE EXCEPTION 'vue % non insérable (is_insertable_into=%)', r.table_name, r.is_insertable_into; END IF;
    IF r.is_updatable <> 'YES' THEN RAISE EXCEPTION 'vue % non updatable (is_updatable=%)', r.table_name, r.is_updatable; END IF;
  END LOOP;

  -- La colonne calculée created_by_name existe et est bien en lecture seule
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_prospect_interactions' AND column_name = 'created_by_name' AND is_updatable = 'NO';
  IF n <> 1 THEN RAISE EXCEPTION 'created_by_name absente ou updatable sur la vue interactions'; END IF;

  -- Trigger updated_at branché
  SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid = 'majordhome.prospects'::regclass AND tgname = 'trg_prospects_updated_at' AND NOT tgisinternal;
  IF n <> 1 THEN RAISE EXCEPTION 'trigger trg_prospects_updated_at absent'; END IF;

  RAISE NOTICE 'A. structure OK (2 tables RLS, 6 policies authenticated, 2 vues security_invoker insérables/updatables)';
END $$;

-- ── B. Privilèges par rôle ─────────────────────────────────────────────────
DO $$
BEGIN
  -- anon : rien, nulle part
  IF has_table_privilege('anon', 'majordhome.prospects', 'SELECT') THEN RAISE EXCEPTION 'anon lit majordhome.prospects'; END IF;
  IF has_table_privilege('anon', 'majordhome.prospect_interactions', 'SELECT') THEN RAISE EXCEPTION 'anon lit prospect_interactions'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_prospects', 'SELECT') THEN RAISE EXCEPTION 'anon lit la vue majordhome_prospects'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_prospect_interactions', 'SELECT') THEN RAISE EXCEPTION 'anon lit la vue interactions'; END IF;
  IF has_table_privilege('anon', 'majordhome.prospects', 'INSERT') THEN RAISE EXCEPTION 'anon insère dans prospects (ACL par défaut non révoquée)'; END IF;

  -- authenticated : CRUD prospects (table + vue), SELECT/INSERT seulement sur les interactions
  IF NOT has_table_privilege('authenticated', 'majordhome.prospects', 'SELECT, INSERT, UPDATE, DELETE') THEN RAISE EXCEPTION 'authenticated : CRUD manquant sur la table prospects'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_prospects', 'SELECT, INSERT, UPDATE, DELETE') THEN RAISE EXCEPTION 'authenticated : CRUD manquant sur la vue prospects'; END IF;
  IF NOT has_table_privilege('authenticated', 'majordhome.prospect_interactions', 'SELECT, INSERT') THEN RAISE EXCEPTION 'authenticated : SELECT/INSERT manquant sur interactions'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_prospect_interactions', 'SELECT, INSERT') THEN RAISE EXCEPTION 'authenticated : SELECT/INSERT manquant sur la vue interactions'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.prospect_interactions', 'UPDATE') OR has_table_privilege('authenticated', 'majordhome.prospect_interactions', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated peut modifier/supprimer des interactions (timeline append-only attendue)';
  END IF;
  IF has_table_privilege('authenticated', 'public.majordhome_prospect_interactions', 'UPDATE') OR has_table_privilege('authenticated', 'public.majordhome_prospect_interactions', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated peut modifier/supprimer via la vue interactions';
  END IF;

  -- service_role : SELECT sur les tables (charte : edges lisant via les vues security_invoker)
  IF NOT has_table_privilege('service_role', 'majordhome.prospects', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur prospects'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.prospect_interactions', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur prospect_interactions'; END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_prospects', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur la vue prospects'; END IF;

  RAISE NOTICE 'B. privilèges OK (anon exclu, authenticated CRUD/append-only, service_role lecture)';
END $$;

-- ── C. Parcours fonctionnel en rôle authenticated ──────────────────────────
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_membre uuid; v_etranger uuid; v_nom text;
  v_id uuid; v_id2 uuid; v_int uuid; v_int_nom text;
  v_created timestamptz; v_updated timestamptz;
  n int; ok boolean;
BEGIN
  -- Fixtures : un membre Mayer ayant un profil (FK created_by), un membre d'une autre org hors Mayer
  SELECT om.user_id INTO v_membre FROM core.organization_members om
    JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL LIMIT 1;
  SELECT om.user_id INTO v_etranger FROM core.organization_members om
    JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id <> v_mayer AND om.user_id IS NOT NULL
     AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'fixture : aucun membre Mayer avec profil'; END IF;
  IF v_etranger IS NULL THEN RAISE NOTICE 'C. aucun membre d''une autre org hors Mayer : tests cross-org sautés'; END IF;
  SELECT full_name INTO v_nom FROM core.profiles WHERE id = v_membre;

  -- (1) Upsert du screener à travers la vue (forme exacte de PostgREST :
  --     Prefer resolution=ignore-duplicates → ON CONFLICT (cols) DO NOTHING RETURNING)
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.majordhome_prospects
      (siren, raison_sociale, naf, departement, commune, module, statut, score, org_id, created_by, created_at, updated_at)
  VALUES ('000000001', 'REHEARSAL SAS', '43.22B', '81', 'Gaillac', 'commercial', 'a_contacter', 42, v_mayer, v_membre,
          now() - interval '1 day', now() - interval '1 day')
  ON CONFLICT (org_id, module, siren) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION '(1) insert via la vue n''a rien renvoyé'; END IF;

  -- (2) Même SIREN, même module : doublon → 0 ligne, pas d'erreur (branche duplicate:true du service)
  INSERT INTO public.majordhome_prospects (siren, raison_sociale, module, org_id, created_by)
  VALUES ('000000001', 'REHEARSAL SAS (bis)', 'commercial', v_mayer, v_membre)
  ON CONFLICT (org_id, module, siren) DO NOTHING
  RETURNING id INTO v_id2;
  IF v_id2 IS NOT NULL THEN RAISE EXCEPTION '(2) le doublon a été inséré'; END IF;
  -- même SIREN dans l'AUTRE module : entrée distincte (clé = org, module, siren)
  INSERT INTO public.majordhome_prospects (siren, raison_sociale, module, org_id, created_by)
  VALUES ('000000001', 'REHEARSAL SAS', 'cedants', v_mayer, v_membre)
  ON CONFLICT (org_id, module, siren) DO NOTHING
  RETURNING id INTO v_id2;
  IF v_id2 IS NULL THEN RAISE EXCEPTION '(2) le même SIREN en module cedants a été refusé'; END IF;

  -- (3) Lecture + update via la vue (ProspectDrawer / updateStatus) ; trigger updated_at
  SELECT count(*) INTO n FROM public.majordhome_prospects WHERE org_id = v_mayer AND module = 'commercial';
  IF n <> 1 THEN RAISE EXCEPTION '(3) membre Mayer voit % prospect(s) commercial au lieu de 1', n; END IF;
  UPDATE public.majordhome_prospects SET statut = 'contacte', notes = 'appelé' WHERE id = v_id
  RETURNING created_at, updated_at INTO v_created, v_updated;
  IF v_updated IS NULL OR v_updated <= v_created THEN RAISE EXCEPTION '(3) trigger updated_at inactif (created %, updated %)', v_created, v_updated; END IF;
  -- l'org_id ne peut pas être déplacé vers une org étrangère (WITH CHECK)
  ok := false;
  BEGIN
    UPDATE public.majordhome_prospects SET org_id = (SELECT id FROM core.organizations WHERE id <> v_mayer LIMIT 1) WHERE id = v_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(3) un membre a pu déplacer un prospect vers une autre org'; END IF;

  -- (4) Interaction via la vue (updateStatus / addInteraction) + nom d'auteur résolu
  INSERT INTO public.majordhome_prospect_interactions
      (prospect_id, type, contenu, ancien_statut, nouveau_statut, created_by)
  VALUES (v_id, 'status_changed', 'Statut : a_contacter → contacte', 'a_contacter', 'contacte', v_membre)
  RETURNING id, created_by_name INTO v_int, v_int_nom;
  IF v_int IS NULL THEN RAISE EXCEPTION '(4) insert interaction via la vue n''a rien renvoyé'; END IF;
  IF v_int_nom IS DISTINCT FROM v_nom THEN RAISE EXCEPTION '(4) created_by_name = % au lieu de %', v_int_nom, v_nom; END IF;
  INSERT INTO public.majordhome_prospect_interactions (prospect_id, type, contenu, metadata, created_by)
  VALUES (v_id, 'note', 'RDV à prévoir', '{}'::jsonb, v_membre);
  SELECT count(*) INTO n FROM public.majordhome_prospect_interactions WHERE prospect_id = v_id;
  IF n <> 2 THEN RAISE EXCEPTION '(4) timeline : % interaction(s) au lieu de 2', n; END IF;
  -- type hors allowlist → 23514
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_prospect_interactions (prospect_id, type, created_by) VALUES (v_id, 'sms', v_membre);
  EXCEPTION WHEN SQLSTATE '23514' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(4) type d''interaction inconnu accepté'; END IF;
  -- timeline append-only : UPDATE via la vue refusé (aucun GRANT UPDATE)
  ok := false;
  BEGIN
    UPDATE public.majordhome_prospect_interactions SET contenu = 'x' WHERE id = v_int;
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(4) un membre a pu modifier une interaction'; END IF;
  RESET ROLE;

  -- (5) Isolation cross-org
  IF v_etranger IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_etranger::text, false);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.majordhome_prospects;
    IF n <> 0 THEN RAISE EXCEPTION '(5) membre étranger voit % prospect(s) Mayer', n; END IF;
    SELECT count(*) INTO n FROM public.majordhome_prospect_interactions;
    IF n <> 0 THEN RAISE EXCEPTION '(5) membre étranger voit % interaction(s) Mayer', n; END IF;
    ok := false;
    BEGIN
      INSERT INTO public.majordhome_prospects (siren, raison_sociale, module, org_id, created_by)
      VALUES ('000000002', 'INTRUS SARL', 'commercial', v_mayer, v_etranger);
    EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION '(5) membre étranger a inséré un prospect dans l''org Mayer'; END IF;
    ok := false;
    BEGIN
      INSERT INTO public.majordhome_prospect_interactions (prospect_id, type, contenu, created_by)
      VALUES (v_id, 'note', 'intrusion', v_etranger);
    EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION '(5) membre étranger a écrit dans la timeline d''un prospect Mayer'; END IF;
    UPDATE public.majordhome_prospects SET statut = 'perdu' WHERE id = v_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION '(5) membre étranger a modifié un prospect Mayer'; END IF;
    DELETE FROM public.majordhome_prospects WHERE id = v_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION '(5) membre étranger a supprimé un prospect Mayer'; END IF;
    RESET ROLE;
  END IF;

  -- (6) Sans claim (jeton sans sub) : rien de visible, rien d'insérable
  PERFORM set_config('request.jwt.claim.sub', '', false);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.majordhome_prospects;
  IF n <> 0 THEN RAISE EXCEPTION '(6) authenticated sans sub voit % prospect(s)', n; END IF;
  ok := false;
  BEGIN
    INSERT INTO public.majordhome_prospects (siren, raison_sociale, module, org_id) VALUES ('000000003', 'ANONYME', 'commercial', v_mayer);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(6) insert sans sub accepté'; END IF;
  RESET ROLE;
  -- anon : la vue elle-même est interdite
  SET LOCAL ROLE anon;
  ok := false;
  BEGIN
    PERFORM count(*) FROM public.majordhome_prospects;
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION '(6) anon peut lire la vue majordhome_prospects'; END IF;

  -- (7) Suppression par un membre → cascade sur la timeline
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.majordhome_prospects WHERE id = v_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '(7) delete via la vue : % ligne(s) au lieu de 1', n; END IF;
  DELETE FROM public.majordhome_prospects WHERE id = v_id2;
  RESET ROLE;
  SELECT count(*) INTO n FROM majordhome.prospect_interactions WHERE prospect_id = v_id;
  IF n <> 0 THEN RAISE EXCEPTION '(7) % interaction(s) orpheline(s) après suppression', n; END IF;
  SELECT count(*) INTO n FROM majordhome.prospects WHERE org_id = v_mayer;
  IF n <> 0 THEN RAISE EXCEPTION '(7) % prospect(s) de test restant(s)', n; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', false);
  RAISE NOTICE 'C. parcours authenticated OK (upsert + doublon, update + trigger, timeline + auteur, cross-org, anon, cascade)';
END $$;
ROLLBACK;
