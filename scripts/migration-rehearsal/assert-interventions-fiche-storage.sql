-- assert-interventions-fiche-storage.sql — fiche d'intervention : photos de terrain et signature
-- dans le dossier Storage `interventions`.
--
-- Éprouve la forme de chemin produite par `src/lib/interventionStoragePath.js`
-- (`${orgId}/${projectId}/${interventionId}/${type}_${horodatage}.${ext}`) contre les quatre
-- règles `interventions_org_*` de 20261118_1 : dépôt, lecture avec le même chemin, suppression,
-- et refus de l'ancienne forme (`${projectId}/${interventionId}/…`), qui n'est jamais passée.
--
-- Chaîne conseillée (photo d'avant le 2026-11-18) : 20261117_3, 20261118_1, 20261118_2 — ce sont
-- alors les règles de la migration qui sont éprouvées. Sur une photo plus récente, les règles
-- Storage ne sont pas photographiées (gotcha du harnais) : le filet ci-dessous les recrée à
-- l'identique de la production (pg_policies relevé le 2026-11-18).
-- Aucune migration ne l'accompagne : la correction est dans le code (chemin), pas dans la base.
-- Un écart lève une exception.
DO $$
DECLARE
  v_org          uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_autre        uuid := '88888888-8888-8888-8888-0000000000bb'; -- org dont l'utilisateur n'est pas membre
  v_projet       uuid := '77777777-7777-7777-7777-000000000001';
  v_intervention uuid := '77777777-7777-7777-7777-000000000002';
  v_etranger     uuid := '77777777-7777-7777-7777-0000000000ee'; -- utilisateur sans aucune adhésion
  v_user         uuid;
  v_photo        text;
  v_signature    text;
  v_ancien       text;
  v_cond         text := $c$bucket_id = 'interventions' AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())$c$;
  n              int;
BEGIN
  SELECT om.user_id INTO v_user FROM core.organization_members om WHERE om.org_id = v_org LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'aucun membre de l''org dans la photographie'; END IF;
  IF EXISTS (SELECT 1 FROM core.organization_members WHERE user_id = v_user AND org_id = v_autre) THEN
    RAISE EXCEPTION 'l''org témoin % ne doit pas compter l''utilisateur parmi ses membres', v_autre;
  END IF;

  v_photo     := v_org || '/' || v_projet || '/' || v_intervention || '/photo_before_1700000000000.jpg';
  v_signature := v_org || '/' || v_projet || '/' || v_intervention || '/signature_1700000000001.png';
  v_ancien    := v_projet || '/' || v_intervention || '/photo_before_1700000000000.jpg';

  -- ── 1. Les quatre règles sont là (filet si la photo ne les porte pas) ──
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'org_members_%_interventions';
  IF n <> 0 THEN RAISE EXCEPTION '1. % ancienne(s) règle(s) org_members_*_interventions restante(s)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'interventions_org_select') THEN
    EXECUTE 'CREATE POLICY interventions_org_select ON storage.objects FOR SELECT TO authenticated USING (' || v_cond || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'interventions_org_insert') THEN
    EXECUTE 'CREATE POLICY interventions_org_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (' || v_cond || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'interventions_org_update') THEN
    EXECUTE 'CREATE POLICY interventions_org_update ON storage.objects FOR UPDATE TO authenticated USING (' || v_cond || ') WITH CHECK (' || v_cond || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'interventions_org_delete') THEN
    EXECUTE 'CREATE POLICY interventions_org_delete ON storage.objects FOR DELETE TO authenticated USING (' || v_cond || ')';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('interventions_org_select', 'interventions_org_insert', 'interventions_org_update', 'interventions_org_delete')
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%interventions%'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%foldername%';
  IF n <> 4 THEN RAISE EXCEPTION '1. 4 règles interventions_org_* attendues, % trouvée(s)', n; END IF;

  GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated; -- stub du harnais : seules les règles sont éprouvées

  -- ── 2. Un membre de l'org dépose une photo et une signature ──
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('interventions', v_photo);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('interventions', v_signature);

  -- ── 3. Lecture avec le même chemin (c'est ce que fait la demande d'URL signée) ──
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'interventions' AND name IN (v_photo, v_signature);
  IF n <> 2 THEN RAISE EXCEPTION '3. le déposant devrait relire ses 2 fichiers, % lu(s)', n; END IF;

  -- ── 4. L'ancienne forme (projet en premier segment) reste refusée ──
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('interventions', v_ancien);
    RAISE EXCEPTION '4. chemin sans organisation accepté : %', v_ancien;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ── 5. Dossier d'une autre organisation : refusé ──
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('interventions', v_autre || '/' || v_projet || '/' || v_intervention || '/photo_before_1.jpg');
    RAISE EXCEPTION '5. fichier rangé dans le dossier d''une autre org';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ── 6. Quelqu'un qui n'est membre de rien ne lit, ne dépose ni ne supprime ──
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, true);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'interventions' AND name IN (v_photo, v_signature);
  IF n <> 0 THEN RAISE EXCEPTION '6. un non-membre lit % fichier(s) de l''org', n; END IF;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('interventions', v_org || '/' || v_projet || '/' || v_intervention || '/photo_extra_2.jpg');
    RAISE EXCEPTION '6. un non-membre a déposé dans le dossier de l''org';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM storage.objects WHERE bucket_id = 'interventions' AND name = v_photo;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '6. un non-membre a supprimé % fichier(s) de l''org', n; END IF;

  -- ── 7. Le membre supprime sa photo (bouton corbeille), la signature reste ──
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  DELETE FROM storage.objects WHERE bucket_id = 'interventions' AND name = v_photo;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '7. suppression de la photo : 1 ligne attendue, %', n; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'interventions' AND name = v_signature;
  IF n <> 1 THEN RAISE EXCEPTION '7. la signature devrait rester lisible'; END IF;

  -- ── 8. Rapport d'intervention SAV : un fichier fixe par carte, déposé puis REMPLACÉ ──
  -- (`buildInterventionReportPath` ; l'écran dépose en « upsert » : INSERT la première fois, UPDATE ensuite)
  INSERT INTO storage.objects (bucket_id, name) VALUES ('interventions', v_org || '/' || v_projet || '/' || v_intervention || '/rapport-intervention.pdf');
  UPDATE storage.objects SET created_at = now()
   WHERE bucket_id = 'interventions' AND name = v_org || '/' || v_projet || '/' || v_intervention || '/rapport-intervention.pdf';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '8. remplacement du rapport : 1 ligne attendue, %', n; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, true);
  UPDATE storage.objects SET created_at = now()
   WHERE bucket_id = 'interventions' AND name = v_org || '/' || v_projet || '/' || v_intervention || '/rapport-intervention.pdf';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '8. un non-membre a remplacé le rapport de l''org'; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  DELETE FROM storage.objects WHERE bucket_id = 'interventions' AND name LIKE '%' || v_intervention || '%';
  REVOKE ALL ON storage.objects FROM authenticated; REVOKE USAGE ON SCHEMA storage FROM authenticated;

  RAISE NOTICE 'assert-interventions-fiche-storage : OK (dépôt photo et signature, lecture au même chemin, suppression, ancienne forme refusée, autre org et non-membre refusés, rapport SAV déposé puis remplacé)';
END $$;
