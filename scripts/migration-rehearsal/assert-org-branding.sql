-- assert-org-branding.sql — vérifie 20261121_8_org_branding_logo.sql (compartiment du logo de l'entreprise).
-- Le cluster n'a qu'un stub de Storage (bucket + objets + RLS) : on éprouve les règles en se mettant à la place
-- d'un org_admin, d'un membre et d'un administrateur d'une AUTRE organisation.
DO $$
DECLARE
  v_admin uuid; v_org uuid; v_membre uuid; v_autre_org uuid;
  n int;
BEGIN
  SELECT count(*) INTO n FROM storage.buckets WHERE id = 'org-branding' AND public AND file_size_limit = 2097152
    AND allowed_mime_types = array['image/png','image/jpeg','image/webp'];
  IF n <> 1 THEN RAISE EXCEPTION 'compartiment org-branding absent ou mal réglé'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'org_branding_%';
  IF n <> 4 THEN RAISE EXCEPTION '% règle(s) org_branding au lieu de 4', n; END IF;

  SELECT om.user_id, om.org_id INTO v_admin, v_org FROM core.organization_members om WHERE om.role = 'org_admin' ORDER BY om.org_id LIMIT 1;
  SELECT om.user_id INTO v_membre FROM core.organization_members om WHERE om.org_id = v_org AND om.role <> 'org_admin' LIMIT 1;
  SELECT gen_random_uuid() INTO v_autre_org;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'aucun org_admin dans la photographie'; END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
  GRANT USAGE ON SCHEMA storage TO authenticated;

  -- org_admin : écrit dans le dossier de son organisation, pas dans celui d'une autre.
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO storage.objects (bucket_id, name) VALUES ('org-branding', v_org::text || '/logo-1.png');
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('org-branding', v_autre_org::text || '/logo-1.png');
    RAISE EXCEPTION 'écriture acceptée dans le dossier d''une autre organisation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- membre non administrateur : lit, n'écrit ni ne supprime.
  IF v_membre IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_membre::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'org-branding';
    IF n <> 1 THEN RAISE EXCEPTION 'un membre ne lit pas le logo de son organisation'; END IF;
    BEGIN
      INSERT INTO storage.objects (bucket_id, name) VALUES ('org-branding', v_org::text || '/logo-2.png');
      RAISE EXCEPTION 'écriture acceptée pour un membre non administrateur';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    DELETE FROM storage.objects WHERE bucket_id = 'org-branding';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'suppression acceptée pour un membre non administrateur'; END IF;
    RESET ROLE;
  END IF;

  -- org_admin : supprime.
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM storage.objects WHERE bucket_id = 'org-branding';
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'l''org_admin n''a pas pu supprimer son logo'; END IF;

  RAISE NOTICE 'assert-org-branding : OK';
END $$;
