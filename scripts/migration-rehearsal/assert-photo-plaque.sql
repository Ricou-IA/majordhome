-- assert-photo-plaque.sql — vérifie 20261012_1_certificat_photo_plaque.sql.
-- Un écart lève une exception → run.mjs sort en ECHEC.

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; v_last text; v_avant text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='certificats' AND column_name='photo_plaque_path') THEN
    RAISE EXCEPTION 'certificats.photo_plaque_path absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='certificats' AND column_name='photo_plaque_absence') THEN
    RAISE EXCEPTION 'certificats.photo_plaque_absence absente'; END IF;

  -- Vue miroir : les deux colonnes EN FIN, toujours updatable (le wizard upsert au travers)
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_certificats' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'photo_plaque_absence' THEN RAISE EXCEPTION 'majordhome_certificats : dernière colonne % au lieu de photo_plaque_absence', v_last; END IF;
  SELECT column_name INTO v_avant FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_certificats' ORDER BY ordinal_position DESC OFFSET 1 LIMIT 1;
  IF v_avant <> 'photo_plaque_path' THEN RAISE EXCEPTION 'majordhome_certificats : avant-dernière colonne % au lieu de photo_plaque_path', v_avant; END IF;
  IF (SELECT is_insertable_into FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_certificats') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_certificats n''est plus insérable'; END IF;
  IF (SELECT is_updatable FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_certificats') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_certificats n''est plus updatable'; END IF;

  -- Vue Kanban : même liste de colonnes (anomalies reste la dernière)
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_entretien_sav' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'anomalies' THEN RAISE EXCEPTION 'majordhome_entretien_sav : dernière colonne % au lieu de anomalies', v_last; END IF;

  SELECT count(*) INTO n FROM pg_class c WHERE c.relnamespace='public'::regnamespace
     AND c.relname IN ('majordhome_certificats','majordhome_entretien_sav') AND c.reloptions::text LIKE '%security_invoker=true%';
  IF n <> 2 THEN RAISE EXCEPTION 'security_invoker attendu sur 2 vues, trouvé %', n; END IF;
  RAISE NOTICE 'assert-photo-plaque A (structure) : OK';
END $$;

-- ── B. Fonctionnel (rollback) : la photo suit la carte ─────────────────────
BEGIN;
SET LOCAL ROLE postgres;
DO $$
DECLARE v_cert uuid; v_parent uuid; v_child uuid; v_sav uuid; v_anom jsonb; v_proj uuid; v_client uuid; v_org uuid; v_path text;
BEGIN
  SELECT cl.id, cl.project_id, cl.org_id INTO v_client, v_proj, v_org
    FROM majordhome.clients cl WHERE cl.project_id IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1;
  IF v_client IS NULL THEN RAISE EXCEPTION 'assert-photo-plaque B : aucun client avec projet dans le snapshot'; END IF;
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, status, workflow_status)
  VALUES (gen_random_uuid(), v_proj, v_client, 'entretien', 'scheduled', 'realise') RETURNING id INTO v_parent;
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, status, workflow_status, parent_id)
  VALUES (gen_random_uuid(), v_proj, v_client, 'entretien', 'scheduled', 'realise', v_parent) RETURNING id INTO v_child;

  -- Écriture par la vue miroir (comme le wizard) : brouillon sans photo, puis photo posée
  INSERT INTO public.majordhome_certificats (id, org_id, client_id, intervention_id, equipement_type, type_document, equipement_marque, equipement_modele, bilan_conformite, anomalies_detail, action_corrective, statut, date_intervention, technicien_nom)
  VALUES (gen_random_uuid(), v_org, v_client, v_child, 'chaudiere_bois', 'entretien_ramonage', 'Burneco', 'Cap 30', 'anomalie', 'Creuset commence a se deformer', 'devis', 'brouillon', '2026-10-12', 'Test') RETURNING id INTO v_cert;
  v_path := v_org::text || '/' || v_client::text || '/2026/' || v_cert::text || '-plaque.jpg';
  UPDATE public.majordhome_certificats SET photo_plaque_path = v_path WHERE id = v_cert;
  IF (SELECT photo_plaque_path FROM majordhome.certificats WHERE id = v_cert) IS DISTINCT FROM v_path THEN
    RAISE EXCEPTION 'UPDATE par la vue majordhome_certificats n''a pas écrit photo_plaque_path'; END IF;

  -- La carte racine voit la photo
  SELECT anomalies INTO v_anom FROM public.majordhome_entretien_sav WHERE id = v_parent;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_anom) a WHERE a->>'certificat_id' = v_cert::text AND a->>'photo_plaque_path' = v_path AND a->>'photo_plaque_absence' IS NULL) THEN
    RAISE EXCEPTION 'photo_plaque_path absente de anomalies : %', v_anom; END IF;

  -- La carte SAV ouverte depuis ce certificat la voit aussi (c'est elle que le chiffreur ouvre)
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, status, workflow_status, sav_origin, sav_description, source_certificat_id)
  VALUES (gen_random_uuid(), v_proj, v_client, 'sav', 'scheduled', 'demande', 'entretien', 'Suite à l''entretien', v_cert) RETURNING id INTO v_sav;
  SELECT anomalies INTO v_anom FROM public.majordhome_entretien_sav WHERE id = v_parent;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_anom) a WHERE a->>'certificat_id' = v_cert::text AND a->>'sav_id' = v_sav::text AND a->>'photo_plaque_path' = v_path) THEN
    RAISE EXCEPTION 'sav_id + photo non remontés ensemble : %', v_anom; END IF;

  -- Shunt : motif d'absence remonté à la place
  UPDATE public.majordhome_certificats SET photo_plaque_path = NULL, photo_plaque_absence = 'Plaque illisible' WHERE id = v_cert;
  SELECT anomalies INTO v_anom FROM public.majordhome_entretien_sav WHERE id = v_parent;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_anom) a WHERE a->>'certificat_id' = v_cert::text AND a->>'photo_plaque_path' IS NULL AND a->>'photo_plaque_absence' = 'Plaque illisible') THEN
    RAISE EXCEPTION 'motif d''absence non remonté : %', v_anom; END IF;
  RAISE NOTICE 'assert-photo-plaque B (fonctionnel) : OK';
END $$;
ROLLBACK;
