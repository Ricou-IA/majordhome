-- assert-equipment-documents-update-colonnes.sql — vérifie 20261114_3_equipment_documents_update_colonnes.sql
-- (chaîne : celle d'assert-equipment-documents-portee.sql + 20261114_3 ; equipment_documents n'est pas photographiée).
-- Couvre : (1) privilèges UPDATE par colonne (table et miroir) ; (2) un membre qui a clients.edit modifie le libellé
-- et le type d'un document, mais ni la marque, ni le modèle, ni le chemin, ni l'auteur, ni la date, ni l'org, ni la
-- portée ; (3) l'org_admin non plus (corriger = retirer + redéposer) ; (4) le trigger tient toujours l'immuabilité
-- de la portée pour un écrivain serveur ; (5) l'écrivain du relevé (ON CONFLICT DO UPDATE) n'est pas gêné.
-- Les écarts lèvent une exception → run.mjs sort en ECHEC. Fixtures annulées par le ROLLBACK final.

-- ── (1) Privilèges ──────────────────────────────────────────────────────────
DO $$
DECLARE v_rel text; v_col text;
BEGIN
  FOREACH v_rel IN ARRAY ARRAY['majordhome.equipment_documents', 'public.majordhome_equipment_documents'] LOOP
    IF has_table_privilege('authenticated', v_rel, 'UPDATE') THEN
      RAISE EXCEPTION '(1) % : UPDATE de table entière encore accordé à authenticated', v_rel; END IF;
    FOREACH v_col IN ARRAY ARRAY['label', 'document_type'] LOOP
      IF has_column_privilege('authenticated', v_rel, v_col, 'UPDATE') IS NOT TRUE THEN
        RAISE EXCEPTION '(1) % : UPDATE de % non accordé', v_rel, v_col; END IF;
    END LOOP;
    FOREACH v_col IN ARRAY ARRAY['org_id', 'brand', 'model', 'brand_key', 'model_key', 'file_name', 'storage_path',
                                 'file_size', 'mime_type', 'uploaded_by', 'created_at', 'equipment_model_id', 'source',
                                 'scope', 'equipment_id'] LOOP
      IF has_column_privilege('authenticated', v_rel, v_col, 'UPDATE') THEN
        RAISE EXCEPTION '(1) % : UPDATE de % encore accordé à authenticated', v_rel, v_col; END IF;
    END LOOP;
    IF has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('anon', v_rel, 'UPDATE') THEN
      RAISE EXCEPTION '(1) % ouvert à anon', v_rel; END IF;
    -- le reste des droits d'écriture du front est intact
    IF NOT (has_table_privilege('authenticated', v_rel, 'INSERT') AND has_table_privilege('authenticated', v_rel, 'DELETE')
            AND has_table_privilege('authenticated', v_rel, 'SELECT')) THEN
      RAISE EXCEPTION '(1) % : SELECT / INSERT / DELETE retirés à authenticated', v_rel; END IF;
  END LOOP;
END $$;

-- ── (2)-(5) Fonctionnel (impersonation) ─────────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_tech uuid; v_doc uuid; v_m uuid; v_n int; v_err text; v_set text;
BEGIN
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role = 'org_admin' LIMIT 1;
  SELECT om.user_id INTO v_tech FROM core.organization_members om WHERE om.org_id = v_mayer AND om.role <> 'org_admin' LIMIT 1;
  IF v_admin IS NULL OR v_tech IS NULL THEN RAISE EXCEPTION 'fixture : il faut un org_admin et un membre non admin Mayer'; END IF;

  -- technicien : dépôt d'un document « modèle »
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  INSERT INTO public.majordhome_equipment_documents (org_id, brand, model, document_type, label, file_name, storage_path, mime_type)
  VALUES (v_mayer, 'TestColonnes', 'Modele Un', 'notice', 'Notice', 'n.pdf', v_mayer || '/equipment-models/n.pdf', 'application/pdf')
  RETURNING id INTO v_doc;

  -- (2) libellé et type : oui
  UPDATE public.majordhome_equipment_documents SET label = 'Notice 2019', document_type = 'autre' WHERE id = v_doc;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '(2) modification du libellé et du type refusée (% ligne)', v_n; END IF;

  -- (2) tout le reste : refus de privilège, par le miroir comme par la table
  FOREACH v_set IN ARRAY ARRAY[
    $q$brand = 'AutreMarque'$q$, $q$model = 'Autre Modele'$q$, $q$brand_key = 'x'$q$, $q$model_key = 'x'$q$,
    $q$storage_path = org_id::text || '/equipment-models/autre.pdf'$q$, $q$uploaded_by = NULL$q$,
    $q$created_at = now()$q$, $q$org_id = org_id$q$, $q$scope = 'marque'$q$, $q$file_name = 'z.pdf'$q$,
    $q$label = 'x', brand = 'AutreMarque'$q$] LOOP
    v_err := NULL;
    BEGIN EXECUTE format('UPDATE public.majordhome_equipment_documents SET %s WHERE id = %L', v_set, v_doc);
    EXCEPTION WHEN insufficient_privilege THEN v_err := 'refus'; WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS DISTINCT FROM 'refus' THEN RAISE EXCEPTION '(2) miroir, SET % : %', v_set, coalesce(v_err, 'accepté'); END IF;
    v_err := NULL;
    BEGIN EXECUTE format('UPDATE majordhome.equipment_documents SET %s WHERE id = %L', v_set, v_doc);
    EXCEPTION WHEN insufficient_privilege THEN v_err := 'refus'; WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err IS DISTINCT FROM 'refus' THEN RAISE EXCEPTION '(2) table, SET % : %', v_set, coalesce(v_err, 'accepté'); END IF;
  END LOOP;
  RESET ROLE;
  IF (SELECT brand || '|' || model || '|' || label || '|' || document_type FROM majordhome.equipment_documents WHERE id = v_doc)
     <> 'TestColonnes|Modele Un|Notice 2019|autre' THEN RAISE EXCEPTION '(2) ligne inattendue après les refus'; END IF;

  -- (3) org_admin : même refus sur la marque (corriger = retirer + redéposer), libellé accepté
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_err := NULL;
  BEGIN UPDATE public.majordhome_equipment_documents SET brand = 'AutreMarque' WHERE id = v_doc;
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'refus'; WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'refus' THEN RAISE EXCEPTION '(3) org_admin, marque : %', coalesce(v_err, 'accepté'); END IF;
  UPDATE public.majordhome_equipment_documents SET label = 'Notice' WHERE id = v_doc;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '(3) org_admin : libellé refusé'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- (4) écrivain serveur (propriétaire) : le trigger tient toujours l'immuabilité de la portée
  v_err := NULL;
  BEGIN UPDATE majordhome.equipment_documents SET scope = 'marque' WHERE id = v_doc;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'equipment_document_scope_immutable' THEN
    RAISE EXCEPTION '(4) changement de portée côté serveur : %', coalesce(v_err, 'accepté'); END IF;

  -- (5) relevé du fabricant : second passage = ON CONFLICT DO UPDATE, toujours accepté
  INSERT INTO majordhome.equipment_models (org_id, brand, source_id, reference, name, model_name)
  VALUES (v_mayer, 'TestColonnes', 'TC1', 'TCREF1', 'POELE TEST COLONNES', 'TEST COLONNES') RETURNING id INTO v_m;
  PERFORM public.equipment_models_set_files(v_mayer, 'TestColonnes', 'p1', jsonb_build_array(jsonb_build_object('source_id', 'TC1',
    'documents', jsonb_build_array(jsonb_build_object('id', 'R1', 'type', 'notice', 'label', 'Notice', 'file_name', 'r1.pdf',
      'storage_path', v_mayer || '/equipment-models/site/doc-tc1.pdf', 'file_size', 10, 'mime_type', 'application/pdf', 'fileKey', 'K')))));
  PERFORM public.equipment_models_set_files(v_mayer, 'TestColonnes', 'p2', jsonb_build_array(jsonb_build_object('source_id', 'TC1',
    'documents', jsonb_build_array(jsonb_build_object('id', 'R1', 'type', 'notice', 'label', 'Notice v2', 'file_name', 'r1.pdf',
      'storage_path', v_mayer || '/equipment-models/site/doc-tc1.pdf', 'file_size', 10, 'mime_type', 'application/pdf', 'fileKey', 'K')))));
  IF NOT EXISTS (SELECT 1 FROM majordhome.equipment_documents WHERE equipment_model_id = v_m AND label = 'Notice v2') THEN
    RAISE EXCEPTION '(5) relevé non mis à jour par equipment_models_set_files'; END IF;

  RAISE NOTICE 'assert-equipment-documents-update-colonnes : OK';
END $$;
ROLLBACK;
