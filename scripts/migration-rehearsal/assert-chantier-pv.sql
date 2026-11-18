-- assert-chantier-pv.sql — vérifie 20261117_3 (PV de réception signé en ligne) sur le cluster de
-- répétition. Autonome : crée son lead, ses chantiers et leurs RDV. Un écart lève une exception.
-- Depuis 20261118_1 (chaîne 20261117_3 + 20261118_1) : une signature exige une préparation par
-- l'entreprise (chantier_pv_preparer) et n'écrit plus les trois booléens ; majordhome_chantiers a
-- deux colonnes de plus (46). Le reste du PV complété est vérifié par assert-chantier-pv-points.sql.
DO $$
DECLARE
  v_org     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_mh_org  uuid;
  v_lead    uuid := '77777777-7777-7777-7777-777777777777';
  v_planif  uuid := '77777777-7777-7777-7777-000000000001'; -- Planifié : la signature le fait passer en Réceptionné
  v_amont   uuid := '77777777-7777-7777-7777-000000000002'; -- À planifier : la signature ne déplace pas la carte
  v_archive uuid := '77777777-7777-7777-7777-000000000003'; -- PV déjà archivé (signé sur tablette)
  v_absent  uuid := '77777777-7777-7777-7777-0000000000ff';
  v_membre  uuid;
  v_points  jsonb := jsonb_build_array(
              jsonb_build_object('cle', 'e_mise_en_service', 'texte', 'L''installation a été mise en service et essayée.', 'reponse', 'oui'));
  v_today   date := CURRENT_DATE;
  v_sig     text := 'data:image/png;base64,' || repeat('A', 400);
  v_ok      jsonb := jsonb_build_object(
              'reception_type', 'sans_reserves', 'signataire_nom', '  Marie DURAND ', 'signature_png',
              'data:image/png;base64,' || repeat('A', 400),
              'info_recues', true, 'notices_recues', true, 'entretien_recues', false);
  r   jsonb;
  ligne record;
  n   int;
  f   text;
BEGIN
  -- ── Structure ──────────────────────────────────────────────────────────
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.chantier_pv'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'chantier_pv sans RLS';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'chantier_pv';
  IF n <> 1 THEN RAISE EXCEPTION 'chantier_pv : 1 policy attendue (lecture), % trouvée(s)', n; END IF;
  IF (SELECT cmd FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'chantier_pv') <> 'SELECT' THEN
    RAISE EXCEPTION 'chantier_pv : la seule policy doit être une lecture';
  END IF;
  IF has_table_privilege('anon', 'majordhome.chantier_pv', 'SELECT') THEN RAISE EXCEPTION 'chantier_pv lisible par anon'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.chantier_pv', 'SELECT') IS NOT TRUE THEN RAISE EXCEPTION 'chantier_pv illisible par authenticated'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.chantier_pv', 'INSERT')
     OR has_table_privilege('authenticated', 'majordhome.chantier_pv', 'UPDATE')
     OR has_table_privilege('authenticated', 'majordhome.chantier_pv', 'DELETE') THEN
    RAISE EXCEPTION 'chantier_pv : authenticated ne doit pas pouvoir écrire';
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'public.chantier_pv_contexte(uuid, boolean)',
    'public.chantier_pv_marquer_envoi(uuid, text, uuid)',
    'public.chantier_pv_signer(uuid, jsonb)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par anon', f; END IF;
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par authenticated', f; END IF;
    IF has_function_privilege('service_role', f, 'EXECUTE') IS NOT TRUE THEN RAISE EXCEPTION '% non exécutable par service_role', f; END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '% doit être SECURITY DEFINER', f; END IF;
  END LOOP;

  FOREACH f IN ARRAY ARRAY['public.majordhome_chantier_pv', 'public.majordhome_chantiers'] LOOP
    IF (SELECT (reloptions::text LIKE '%security_invoker=true%') FROM pg_class WHERE oid = f::regclass) IS NOT TRUE THEN
      RAISE EXCEPTION '% sans security_invoker', f;
    END IF;
    IF has_table_privilege('anon', f, 'SELECT') THEN RAISE EXCEPTION '% lisible par anon', f; END IF;
    IF has_table_privilege('authenticated', f, 'SELECT') IS NOT TRUE THEN RAISE EXCEPTION '% illisible par authenticated', f; END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.majordhome_chantier_pv', 'INSERT')
     OR has_table_privilege('authenticated', 'public.majordhome_chantier_pv', 'UPDATE') THEN
    RAISE EXCEPTION 'majordhome_chantier_pv : authenticated ne doit pas pouvoir écrire';
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers';
  IF n <> 46 THEN RAISE EXCEPTION 'majordhome_chantiers : 46 colonnes attendues (44 + 2 de 20261118_1), % trouvées', n; END IF;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers' AND ordinal_position > 41
     AND column_name IN ('pv_sent_at', 'pv_signed_at', 'pv_avec_reserves');
  IF n <> 3 THEN RAISE EXCEPTION 'majordhome_chantiers : les 3 colonnes du PV doivent être en fin de liste'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers' AND column_name LIKE '%signature%') THEN
    RAISE EXCEPTION 'majordhome_chantiers ne doit pas porter l''image de la signature';
  END IF;

  -- ── Données ────────────────────────────────────────────────────────────
  SELECT id INTO v_mh_org FROM majordhome.organizations WHERE core_org_id = v_org;
  IF v_mh_org IS NULL THEN RAISE EXCEPTION 'org majordhome introuvable'; END IF;
  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, email, address, postal_code, city, is_deleted)
  VALUES (v_lead, v_org, 'Marie', 'DURAND', ' marie@example.test ', '12 chemin des Vignes', '81600', 'Gaillac', false);
  INSERT INTO majordhome.chantiers (id, org_id, lead_id, chantier_status, won_date, label, equipment_order_status, materials_order_status, pv_reception_path)
  VALUES (v_planif,  v_org, v_lead, 'planification', v_today - 60, 'Pose d''un poêle', 'recu', 'recu', NULL),
         (v_amont,   v_org, v_lead, 'commande_recue', v_today - 60, NULL, 'recu', 'recu', NULL),
         (v_archive, v_org, v_lead, 'planification', v_today - 60, NULL, 'recu', 'recu', 'pv-reception/x/PV.pdf');
  INSERT INTO majordhome.appointments (id, org_id, lead_id, chantier_id, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, client_name)
  VALUES
    ('77777777-7777-7777-7777-000000000011', v_mh_org, v_lead, v_planif, 'installation', v_today - 3, TIME '08:00', TIME '17:00', 540, 'scheduled', 'DURAND'),
    ('77777777-7777-7777-7777-000000000012', v_mh_org, v_lead, v_planif, 'installation', v_today - 2, TIME '08:00', TIME '17:00', 540, 'scheduled', 'DURAND'),
    ('77777777-7777-7777-7777-000000000013', v_mh_org, v_lead, v_planif, 'installation', v_today - 1, TIME '08:00', TIME '17:00', 540, 'cancelled', 'DURAND');

  -- ── Contexte ───────────────────────────────────────────────────────────
  IF public.chantier_pv_contexte(v_absent) IS NOT NULL THEN RAISE EXCEPTION 'contexte : chantier inconnu doit rendre NULL'; END IF;
  r := public.chantier_pv_contexte(v_planif);
  IF r->>'org_id' <> v_org::text OR r->>'statut' <> 'planification' OR r->>'libelle' <> 'Pose d''un poêle' THEN
    RAISE EXCEPTION 'contexte : identité du chantier inattendue : %', r - 'settings';
  END IF;
  IF r->'client'->>'email' <> 'marie@example.test' OR r->'client'->>'nom' <> 'DURAND' OR r->'client'->>'ville' <> 'Gaillac' THEN
    RAISE EXCEPTION 'contexte : client inattendu : %', r->'client';
  END IF;
  IF jsonb_array_length(r->'poses') <> 2 OR r->'poses'->>0 <> (v_today - 3)::text THEN
    RAISE EXCEPTION 'contexte : 2 jours de pose attendus (le jour annulé écarté), trouvé %', r->'poses';
  END IF;
  IF r->'pv' <> 'null'::jsonb OR (r->>'pv_archive')::boolean THEN RAISE EXCEPTION 'contexte : aucun PV attendu au départ'; END IF;
  IF jsonb_typeof(r->'settings') <> 'object' THEN RAISE EXCEPTION 'contexte : réglages de l''org absents'; END IF;

  -- ── Envoi ──────────────────────────────────────────────────────────────
  r := public.chantier_pv_marquer_envoi(v_absent, 'x@example.test', NULL);
  IF (r->>'ok')::boolean OR r->>'code' <> 'chantier_introuvable' THEN RAISE EXCEPTION 'envoi : chantier inconnu accepté : %', r; END IF;
  r := public.chantier_pv_marquer_envoi(v_planif, ' marie@example.test ', NULL);
  r := public.chantier_pv_marquer_envoi(v_planif, 'marie@example.test', NULL);
  IF (r->>'ok')::boolean IS NOT TRUE OR (r->>'sent_count')::int <> 2 THEN RAISE EXCEPTION 'envoi : 2 envois attendus, trouvé %', r; END IF;
  SELECT * INTO ligne FROM majordhome.chantier_pv WHERE chantier_id = v_planif;
  IF ligne.org_id <> v_org OR ligne.sent_to <> 'marie@example.test' OR ligne.opened_at IS NOT NULL OR ligne.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'envoi : ligne inattendue (org %, à %, ouverte %, signée %)', ligne.org_id, ligne.sent_to, ligne.opened_at, ligne.signed_at;
  END IF;
  SELECT count(*) INTO n FROM public.majordhome_chantiers WHERE id = v_planif AND pv_sent_at IS NOT NULL AND pv_signed_at IS NULL AND pv_avec_reserves = false;
  IF n <> 1 THEN RAISE EXCEPTION 'vue : PV envoyé non signé mal reflété'; END IF;

  -- Ouverture : notée une seule fois, seulement si demandée
  PERFORM public.chantier_pv_contexte(v_planif, false);
  IF (SELECT opened_at FROM majordhome.chantier_pv WHERE chantier_id = v_planif) IS NOT NULL THEN RAISE EXCEPTION 'ouverture notée sans demande'; END IF;
  r := public.chantier_pv_contexte(v_planif, true);
  IF r->'pv'->>'opened_at' IS NULL THEN RAISE EXCEPTION 'ouverture non notée'; END IF;

  -- ── Signature : refus ──────────────────────────────────────────────────
  r := public.chantier_pv_signer(v_absent, v_ok);
  IF r->>'code' <> 'chantier_introuvable' THEN RAISE EXCEPTION 'signature : chantier inconnu : %', r; END IF;
  r := public.chantier_pv_signer(v_archive, v_ok);
  IF r->>'code' <> 'deja_signe' THEN RAISE EXCEPTION 'signature : PV déjà archivé doit être refusé : %', r; END IF;
  -- 20261118_1 : préparation de l'entreprise exigée avant toute signature
  r := public.chantier_pv_signer(v_planif, v_ok);
  IF r->>'code' <> 'pv_non_prepare' THEN RAISE EXCEPTION 'signature : PV non préparé accepté : %', r; END IF;
  r := public.chantier_pv_preparer(v_planif, 'generique', v_points, NULL);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'préparation refusée : %', r; END IF;
  r := public.chantier_pv_signer(v_planif, v_ok || '{"reception_type":"autre"}');
  IF r->>'code' <> 'choix_requis' THEN RAISE EXCEPTION 'signature : choix invalide accepté : %', r; END IF;
  r := public.chantier_pv_signer(v_planif, v_ok || '{"signataire_nom":"   "}');
  IF r->>'code' <> 'nom_requis' THEN RAISE EXCEPTION 'signature : nom vide accepté : %', r; END IF;
  r := public.chantier_pv_signer(v_planif, v_ok || '{"signature_png":"data:image/jpeg;base64,AAAA"}');
  IF r->>'code' <> 'signature_requise' THEN RAISE EXCEPTION 'signature : image non PNG acceptée : %', r; END IF;
  r := public.chantier_pv_signer(v_planif, v_ok || jsonb_build_object('signature_png', 'data:image/png;base64,' || repeat('A', 400001)));
  IF r->>'code' <> 'signature_requise' THEN RAISE EXCEPTION 'signature : image trop lourde acceptée : %', r; END IF;
  r := public.chantier_pv_signer(v_planif, v_ok || '{"reception_type":"avec_reserves"}');
  IF r->>'code' <> 'reserves_a_decrire' THEN RAISE EXCEPTION 'signature : réserves non décrites acceptées : %', r; END IF;
  r := public.chantier_pv_signer(v_planif, v_ok || jsonb_build_object('reception_type', 'avec_reserves', 'reserves_nature', repeat('x', 2001)));
  IF r->>'code' <> 'texte_trop_long' THEN RAISE EXCEPTION 'signature : texte trop long accepté : %', r; END IF;
  IF (SELECT signed_at FROM majordhome.chantier_pv WHERE chantier_id = v_planif) IS NOT NULL
     OR (SELECT chantier_status FROM majordhome.chantiers WHERE id = v_planif) <> 'planification' THEN
    RAISE EXCEPTION 'signature : un refus a laissé une trace';
  END IF;

  -- ── Signature : acceptée, avec réserves ────────────────────────────────
  r := public.chantier_pv_signer(v_planif, v_ok || jsonb_build_object(
         'reception_type', 'avec_reserves', 'reserves_nature', ' Joint de porte à reprendre ', 'reserves_travaux', ''));
  IF (r->>'ok')::boolean IS NOT TRUE OR (r->>'passe_en_receptionne')::boolean IS NOT TRUE OR (r->>'avec_reserves')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'signature : acceptation inattendue : %', r;
  END IF;
  SELECT * INTO ligne FROM majordhome.chantier_pv WHERE chantier_id = v_planif;
  IF ligne.signataire_nom <> 'Marie DURAND' OR ligne.reserves_nature <> 'Joint de porte à reprendre' OR ligne.reserves_travaux IS NOT NULL
     OR ligne.info_recues IS NOT NULL OR ligne.notices_recues IS NOT NULL OR ligne.entretien_recues IS NOT NULL -- plus écrits depuis 20261118_1
     OR ligne.points_client IS DISTINCT FROM '[]'::jsonb OR ligne.devis IS DISTINCT FROM '[]'::jsonb
     OR ligne.sent_count <> 2 OR ligne.signed_at IS NULL THEN
    RAISE EXCEPTION 'signature : enregistrement inattendu (nom %, nature %, travaux %, envois %)', ligne.signataire_nom, ligne.reserves_nature, ligne.reserves_travaux, ligne.sent_count;
  END IF;
  IF (SELECT chantier_status FROM majordhome.chantiers WHERE id = v_planif) <> 'realise' THEN RAISE EXCEPTION 'signature : le chantier Planifié doit passer en Réceptionné'; END IF;
  -- La date de réalisation est figée par le trigger de prod trg_chantiers_freeze_realized_date
  -- (BEFORE UPDATE OF chantier_status). Les triggers de majordhome.chantiers ne sont pas photographiés
  -- par snapshot.mjs (TRIGGER_TABLES) : on ne le vérifie que s'il est présent dans le cluster.
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'majordhome.chantiers'::regclass AND tgname = 'trg_chantiers_freeze_realized_date')
     AND (SELECT realized_date FROM majordhome.chantiers WHERE id = v_planif) IS DISTINCT FROM v_today - 2 THEN
    RAISE EXCEPTION 'signature : date de réalisation figée attendue % (dernier jour de pose actif), trouvée %', v_today - 2, (SELECT realized_date FROM majordhome.chantiers WHERE id = v_planif);
  END IF;
  SELECT count(*) INTO n FROM public.majordhome_chantiers WHERE id = v_planif AND chantier_status = 'realise' AND pv_signed_at IS NOT NULL AND pv_avec_reserves;
  IF n <> 1 THEN RAISE EXCEPTION 'vue : PV signé avec réserves mal reflété'; END IF;
  r := public.chantier_pv_contexte(v_planif);
  IF r->'pv'->>'signature_png' IS NULL OR r->'pv'->>'reception_type' <> 'avec_reserves' THEN RAISE EXCEPTION 'contexte : signature absente après signature'; END IF;

  -- Seconde signature refusée ; la première ne bouge pas
  r := public.chantier_pv_signer(v_planif, v_ok);
  IF r->>'code' <> 'deja_signe' THEN RAISE EXCEPTION 'signature : une seconde signature a été acceptée : %', r; END IF;
  IF (SELECT reception_type FROM majordhome.chantier_pv WHERE chantier_id = v_planif) <> 'avec_reserves' THEN RAISE EXCEPTION 'signature : la première a été écrasée'; END IF;

  -- Un chantier en amont : la signature est enregistrée, la carte ne bouge pas
  r := public.chantier_pv_preparer(v_amont, 'generique', v_points, NULL);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'préparation en amont refusée : %', r; END IF;
  r := public.chantier_pv_signer(v_amont, v_ok);
  IF (r->>'ok')::boolean IS NOT TRUE OR (r->>'passe_en_receptionne')::boolean THEN RAISE EXCEPTION 'signature en amont : %', r; END IF;
  IF (SELECT chantier_status FROM majordhome.chantiers WHERE id = v_amont) <> 'commande_recue' THEN RAISE EXCEPTION 'signature en amont : la carte a bougé'; END IF;
  IF (SELECT pv_avec_reserves FROM public.majordhome_chantiers WHERE id = v_amont) THEN RAISE EXCEPTION 'vue : réserves à tort'; END IF;

  -- ── Une signature est figée ────────────────────────────────────────────
  BEGIN
    UPDATE majordhome.chantier_pv SET signataire_nom = 'Autre' WHERE chantier_id = v_planif;
    RAISE EXCEPTION 'une signature a pu être modifiée';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'pv_signe' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM majordhome.chantier_pv WHERE chantier_id = v_planif;
    RAISE EXCEPTION 'une signature a pu être supprimée';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'pv_signe' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM majordhome.appointments WHERE chantier_id = v_planif;
    DELETE FROM majordhome.chantiers WHERE id = v_planif;
    RAISE EXCEPTION 'un chantier au PV signé a pu être supprimé';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'pv_signe' THEN RAISE; END IF;
  END;
  -- Un nouvel envoi après signature reste permis (il ne touche pas la signature)
  r := public.chantier_pv_marquer_envoi(v_planif, 'marie@example.test', NULL);
  IF (r->>'sent_count')::int <> 3 THEN RAISE EXCEPTION 'envoi après signature refusé : %', r; END IF;

  -- ── Droits vus par un utilisateur ──────────────────────────────────────
  SELECT om.user_id INTO v_membre FROM core.organization_members om WHERE om.org_id = v_org LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'aucun membre de l''org dans la photographie'; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
  SELECT count(*) INTO n FROM public.majordhome_chantier_pv WHERE chantier_id IN (v_planif, v_amont);
  IF n <> 2 THEN RAISE EXCEPTION 'un membre doit lire les PV de son org (% lus)', n; END IF;
  BEGIN
    UPDATE public.majordhome_chantier_pv SET sent_to = 'pirate@example.test' WHERE chantier_id = v_amont;
    RAISE EXCEPTION 'un membre a pu écrire dans le PV';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.chantier_pv_signer(v_amont, v_ok);
    RAISE EXCEPTION 'un membre a pu appeler chantier_pv_signer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
  SELECT count(*) INTO n FROM public.majordhome_chantier_pv WHERE chantier_id IN (v_planif, v_amont);
  IF n <> 0 THEN RAISE EXCEPTION 'un inconnu lit % PV', n; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  RAISE NOTICE 'assert-chantier-pv : OK (envoi, ouverture, signature, passage en Réceptionné, signature figée, droits)';
END $$;
