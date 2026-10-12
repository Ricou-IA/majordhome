-- assert-photo-plaque-equipement.sql — vérifie 20261012_2_equipment_photo_plaque.sql.
-- Un écart lève une exception → run.mjs sort en ECHEC.

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE v_last text; v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='equipments' AND column_name='nameplate_photo_path') THEN
    RAISE EXCEPTION 'equipments.nameplate_photo_path absente'; END IF;
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_equipments' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'nameplate_photo_path' THEN RAISE EXCEPTION 'majordhome_equipments : dernière colonne % au lieu de nameplate_photo_path', v_last; END IF;
  IF (SELECT is_updatable FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_equipments') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_equipments n''est plus updatable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname='majordhome_equipments' AND c.reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'majordhome_equipments sans security_invoker'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname='certificats' AND t.tgname='certificats_sync_nameplate_photo' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'trigger certificats_sync_nameplate_photo absent'; END IF;
  SELECT pg_get_functiondef('majordhome.certificat_sync_nameplate_photo()'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%SECURITY DEFINER%' THEN RAISE EXCEPTION 'certificat_sync_nameplate_photo pas SECURITY DEFINER'; END IF;
  IF v_def NOT LIKE '%search_path%' THEN RAISE EXCEPTION 'certificat_sync_nameplate_photo sans search_path'; END IF;
  IF has_function_privilege('anon', 'majordhome.certificat_sync_nameplate_photo()', 'EXECUTE') THEN RAISE EXCEPTION 'certificat_sync_nameplate_photo exécutable par anon'; END IF;
  IF has_function_privilege('authenticated', 'majordhome.certificat_sync_nameplate_photo()', 'EXECUTE') THEN RAISE EXCEPTION 'certificat_sync_nameplate_photo exécutable par authenticated'; END IF;
  RAISE NOTICE 'assert-photo-plaque-equipement A (structure) : OK';
END $$;

-- ── B. Fonctionnel (rollback) : la photo du certificat suit l'équipement ───
BEGIN;
-- Rôle applicatif : prouve que le trigger (EXECUTE révoqué) se déclenche quand même pour l'appelant
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_eq uuid; v_proj uuid; v_client uuid; v_org uuid; v_parent uuid; v_child uuid; v_cert uuid; v_path text; v_path2 text; v_got text;
BEGIN
  SELECT e.id, e.project_id, cl.id, cl.org_id INTO v_eq, v_proj, v_client, v_org
    FROM majordhome.equipments e JOIN majordhome.clients cl ON cl.project_id = e.project_id
   WHERE e.nameplate_photo_path IS NULL ORDER BY e.created_at DESC LIMIT 1;
  IF v_eq IS NULL THEN RAISE EXCEPTION 'assert-photo-plaque-equipement B : aucun équipement avec client dans le snapshot'; END IF;

  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, status, workflow_status)
  VALUES (gen_random_uuid(), v_proj, v_client, 'entretien', 'scheduled', 'realise') RETURNING id INTO v_parent;
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, status, workflow_status, parent_id, equipment_id)
  VALUES (gen_random_uuid(), v_proj, v_client, 'entretien', 'scheduled', 'realise', v_parent, v_eq) RETURNING id INTO v_child;

  -- 1. Certificat sans photo : l'équipement ne bouge pas
  INSERT INTO public.majordhome_certificats (id, org_id, client_id, intervention_id, equipment_id, equipement_type, type_document, bilan_conformite, anomalies_detail, action_corrective, statut, date_intervention, technicien_nom)
  VALUES (gen_random_uuid(), v_org, v_client, v_child, v_eq, 'chaudiere_bois', 'entretien_ramonage', 'anomalie', 'Creuset deforme', 'devis', 'brouillon', '2026-10-12', 'Test') RETURNING id INTO v_cert;
  IF (SELECT nameplate_photo_path FROM majordhome.equipments WHERE id = v_eq) IS NOT NULL THEN
    RAISE EXCEPTION 'équipement modifié sans photo'; END IF;

  -- 2. Photo posée sur le certificat (comme le wizard, par la vue) → recopiée sur l'équipement
  v_path := v_org::text || '/' || v_client::text || '/2026/' || v_cert::text || '-plaque.jpg';
  UPDATE public.majordhome_certificats SET photo_plaque_path = v_path WHERE id = v_cert;
  SELECT nameplate_photo_path INTO v_got FROM majordhome.equipments WHERE id = v_eq;
  IF v_got IS DISTINCT FROM v_path THEN RAISE EXCEPTION 'equipments.nameplate_photo_path = % attendu %', v_got, v_path; END IF;
  -- … et visible par la vue de la fiche client
  IF (SELECT nameplate_photo_path FROM public.majordhome_equipments WHERE id = v_eq) IS DISTINCT FROM v_path THEN
    RAISE EXCEPTION 'vue majordhome_equipments sans la photo'; END IF;

  -- 3. Photo reprise depuis la fiche équipement : le certificat ne la retire pas (ce n'est plus la même)
  v_path2 := v_org::text || '/' || v_client::text || '/equipements/' || v_eq::text || '-plaque.jpg';
  UPDATE public.majordhome_equipments SET nameplate_photo_path = v_path2 WHERE id = v_eq;
  UPDATE public.majordhome_certificats SET photo_plaque_path = NULL WHERE id = v_cert;
  IF (SELECT nameplate_photo_path FROM majordhome.equipments WHERE id = v_eq) IS DISTINCT FROM v_path2 THEN
    RAISE EXCEPTION 'retrait côté certificat a effacé la photo propre de l''équipement'; END IF;

  -- 4. Même photo des deux côtés : retrait côté certificat ⇒ retrait côté équipement
  UPDATE public.majordhome_certificats SET photo_plaque_path = v_path WHERE id = v_cert;
  UPDATE public.majordhome_certificats SET photo_plaque_path = NULL WHERE id = v_cert;
  IF (SELECT nameplate_photo_path FROM majordhome.equipments WHERE id = v_eq) IS NOT NULL THEN
    RAISE EXCEPTION 'retrait côté certificat non propagé'; END IF;
  RAISE NOTICE 'assert-photo-plaque-equipement B (fonctionnel) : OK';
END $$;
ROLLBACK;
