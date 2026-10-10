-- assert-anomalie-certificat.sql — vérifie 20261010_1_anomalie_certificat_sav_facture_commentaire_devis.sql.
-- Un écart lève une exception → run.mjs sort en ECHEC.

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; v_last text;
BEGIN
  -- 1. Devis
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='quotes' AND column_name='commentaire') THEN
    RAISE EXCEPTION 'quotes.commentaire absente'; END IF;
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_quotes' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'commentaire' THEN RAISE EXCEPTION 'majordhome_quotes : dernière colonne % au lieu de commentaire', v_last; END IF;
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_quotes_write' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'commentaire' THEN RAISE EXCEPTION 'majordhome_quotes_write : dernière colonne % au lieu de commentaire', v_last; END IF;
  IF (SELECT is_insertable_into FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_quotes_write') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_quotes_write n''est plus insérable'; END IF;

  -- 2. Interventions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='interventions' AND column_name='source_certificat_id') THEN
    RAISE EXCEPTION 'interventions.source_certificat_id absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='majordhome' AND tablename='interventions' AND indexname='interventions_source_certificat_uniq' AND indexdef LIKE '%UNIQUE%') THEN
    RAISE EXCEPTION 'index unique interventions_source_certificat_uniq absent'; END IF;
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_interventions' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'source_certificat_id' THEN RAISE EXCEPTION 'majordhome_interventions : dernière colonne % au lieu de source_certificat_id', v_last; END IF;
  IF (SELECT is_insertable_into FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_interventions') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_interventions n''est plus insérable'; END IF;

  -- 3. Factures
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='invoices' AND column_name='client_note') THEN
    RAISE EXCEPTION 'invoices.client_note absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_invoices' AND column_name='client_note') THEN
    RAISE EXCEPTION 'vue majordhome_invoices sans client_note (non recréée)'; END IF;
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_invoices' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'credited_number' THEN RAISE EXCEPTION 'majordhome_invoices : dernière colonne % au lieu de credited_number', v_last; END IF;
  IF (SELECT is_updatable FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_invoices') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_invoices n''est plus updatable'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_invoices', 'SELECT') THEN RAISE EXCEPTION 'majordhome_invoices : SELECT authenticated perdu'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_invoices', 'UPDATE') THEN RAISE EXCEPTION 'majordhome_invoices : UPDATE authenticated perdu'; END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_invoices', 'SELECT') THEN RAISE EXCEPTION 'majordhome_invoices : SELECT service_role perdu'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_invoices', 'SELECT') THEN RAISE EXCEPTION 'majordhome_invoices lisible par anon'; END IF;
  IF pg_get_functiondef('public.invoice_create_draft(jsonb, jsonb)'::regprocedure) NOT LIKE '%client_note%' THEN RAISE EXCEPTION 'invoice_create_draft n''insère pas client_note'; END IF;
  IF pg_get_functiondef('majordhome.invoices_guard_immutable()'::regprocedure) NOT LIKE '%NEW.client_note IS DISTINCT FROM OLD.client_note%' THEN RAISE EXCEPTION 'invoices_guard_immutable ne fige pas client_note'; END IF;
  IF has_function_privilege('anon', 'public.invoice_create_draft(jsonb, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_create_draft exécutable par anon'; END IF;

  -- 4. Vue Kanban
  SELECT column_name INTO v_last FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_entretien_sav' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'anomalies' THEN RAISE EXCEPTION 'majordhome_entretien_sav : dernière colonne % au lieu de anomalies', v_last; END IF;
  SELECT count(*) INTO n FROM pg_class c WHERE c.relnamespace='public'::regnamespace
     AND c.relname IN ('majordhome_quotes','majordhome_quotes_write','majordhome_interventions','majordhome_invoices','majordhome_entretien_sav') AND c.reloptions::text LIKE '%security_invoker=true%';
  IF n <> 5 THEN RAISE EXCEPTION 'security_invoker attendu sur 5 vues, trouvé %', n; END IF;
  RAISE NOTICE 'assert-anomalie-certificat A (structure) : OK';
END $$;

-- ── B. Fonctionnel (rollback) : la vue interroge, l'agrégat a la forme attendue ─
BEGIN;
SET LOCAL ROLE postgres;
DO $$
DECLARE v_cert uuid; v_parent uuid; v_child uuid; v_sav uuid; v_anom jsonb; v_proj uuid; v_client uuid; v_org uuid;
BEGIN
  -- Fixture : un client du snapshot (avec projet) + une racine d'entretien créée ici (interventions
  -- est photographiée sans données).
  SELECT cl.id, cl.project_id, cl.org_id INTO v_client, v_proj, v_org
    FROM majordhome.clients cl WHERE cl.project_id IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1;
  IF v_client IS NULL THEN RAISE EXCEPTION 'assert-anomalie-certificat B : aucun client avec projet dans le snapshot'; END IF;
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, status, workflow_status)
  VALUES (gen_random_uuid(), v_proj, v_client, 'entretien', 'scheduled', 'realise') RETURNING id INTO v_parent;

  -- Certificat enfant avec anomalie « devis »
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, status, workflow_status, parent_id)
  VALUES (gen_random_uuid(), v_proj, v_client, 'entretien', 'scheduled', 'realise', v_parent) RETURNING id INTO v_child;
  INSERT INTO majordhome.certificats (id, org_id, client_id, intervention_id, equipement_type, type_document, equipement_marque, equipement_modele, bilan_conformite, anomalies_detail, action_corrective, statut, date_intervention)
  VALUES (gen_random_uuid(), v_org, v_client, v_child, 'chaudiere_bois', 'entretien_ramonage', 'Burneco', 'Cap 30', 'anomalie', 'Creuset commence a se deformer', 'devis', 'signe', '2026-10-07') RETURNING id INTO v_cert;

  SELECT anomalies INTO v_anom FROM public.majordhome_entretien_sav WHERE id = v_parent;
  IF jsonb_array_length(COALESCE(v_anom, '[]'::jsonb)) < 1 THEN RAISE EXCEPTION 'anomalies vide sur la racine alors qu''un certificat enfant est en anomalie : %', v_anom; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_anom) a WHERE a->>'certificat_id' = v_cert::text AND a->>'equipement' = 'Burneco Cap 30' AND a->>'action' = 'devis' AND a->>'sav_id' IS NULL) THEN
    RAISE EXCEPTION 'élément anomalies inattendu : %', v_anom; END IF;

  -- Demande SAV ouverte depuis ce certificat : sav_id renseigné, doublon refusé
  INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, status, workflow_status, sav_origin, sav_description, source_certificat_id)
  VALUES (gen_random_uuid(), v_proj, v_client, 'sav', 'scheduled', 'demande', 'entretien', 'Suite à l''entretien', v_cert) RETURNING id INTO v_sav;
  SELECT anomalies INTO v_anom FROM public.majordhome_entretien_sav WHERE id = v_parent;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_anom) a WHERE a->>'certificat_id' = v_cert::text AND a->>'sav_id' = v_sav::text) THEN
    RAISE EXCEPTION 'sav_id non remonté dans anomalies : %', v_anom; END IF;
  BEGIN
    INSERT INTO majordhome.interventions (id, project_id, client_id, intervention_type, status, workflow_status, sav_origin, source_certificat_id)
    VALUES (gen_random_uuid(), v_proj, v_client, 'sav', 'scheduled', 'demande', 'entretien', v_cert);
    RAISE EXCEPTION 'second SAV accepté pour le même certificat';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'assert-anomalie-certificat B (fonctionnel) : OK';
END $$;
ROLLBACK;
