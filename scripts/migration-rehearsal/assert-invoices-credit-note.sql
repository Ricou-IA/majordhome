-- assert-invoices-credit-note.sql — vérifie 20260923_4_invoices_credit_note.sql.
DO $$
DECLARE v_def text;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes WHERE schemaname='majordhome' AND indexname='invoices_one_issued_per_intervention';
  IF v_def IS NULL OR v_def NOT LIKE '%kind = ''invoice''%' THEN RAISE EXCEPTION 'index invoices_one_issued_per_intervention sans kind=invoice : %', v_def; END IF;
  SELECT indexdef INTO v_def FROM pg_indexes WHERE schemaname='majordhome' AND indexname='invoices_one_credit_note_per_invoice';
  IF v_def IS NULL THEN RAISE EXCEPTION 'index invoices_one_credit_note_per_invoice absent'; END IF;
  IF v_def NOT LIKE '%(credited_invoice_id)%' THEN RAISE EXCEPTION 'index % ne porte pas (credited_invoice_id)', v_def; END IF;
  IF v_def NOT LIKE '%kind = ''credit_note''%' THEN RAISE EXCEPTION 'index % sans prédicat kind=credit_note', v_def; END IF;
  IF v_def NOT LIKE '%status = ''issued''%' THEN RAISE EXCEPTION 'index % sans prédicat status=issued', v_def; END IF;
  IF v_def NOT LIKE '%credited_invoice_id IS NOT NULL%' THEN RAISE EXCEPTION 'index % sans prédicat credited_invoice_id IS NOT NULL', v_def; END IF;
  IF pg_get_functiondef('public.invoice_issue(uuid, text)'::regprocedure) NOT LIKE '%kind = ''invoice''%' THEN RAISE EXCEPTION 'invoice_issue : garde non restreinte aux factures'; END IF;
  IF has_function_privilege('anon', 'public.invoice_cancel_with_credit_note(uuid, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_cancel_with_credit_note exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.invoice_cancel_with_credit_note(uuid, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_cancel_with_credit_note non exécutable par authenticated'; END IF;
  IF (SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_invoices' ORDER BY ordinal_position DESC LIMIT 1) <> 'credited_number' THEN RAISE EXCEPTION 'majordhome_invoices : credited_number pas en dernière colonne'; END IF;
  IF (SELECT is_updatable FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_invoices') <> 'YES' THEN RAISE EXCEPTION 'majordhome_invoices non updatable'; END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_invoices', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur majordhome_invoices'; END IF;
  RAISE NOTICE 'assert-invoices-credit-note A (structure) : OK';
END $$;

BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_membre uuid; v_etranger uuid; v_client uuid; v_project uuid; v_interv uuid;
  v_inv uuid; v_draft uuid; v_res jsonb; v_row record; v_year text := extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::text;
  ok boolean;
BEGIN
  SELECT om.user_id INTO v_membre FROM core.organization_members om JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role IN ('org_admin','team_leader') LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'fixture : aucun org_admin/team_leader Mayer avec profil'; END IF;
  SELECT om.user_id INTO v_etranger FROM core.organization_members om JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id <> v_mayer AND om.user_id IS NOT NULL
     AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;
  IF v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : aucun membre d''une autre org hors Mayer'; END IF;
  -- Fixture intervention (même approche que assert-invoices-unique.sql : reprendre son bloc d'insertion
  -- clients/interventions tel quel ici) → v_interv
  SELECT c.id, c.project_id INTO v_client, v_project
    FROM majordhome.clients c WHERE c.org_id = v_mayer LIMIT 1;
  IF v_client IS NULL THEN RAISE EXCEPTION 'fixture : aucun client Mayer'; END IF;
  INSERT INTO majordhome.interventions (project_id, client_id)
  VALUES (v_project, v_client)
  RETURNING id INTO v_interv;

  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;

  -- (1) Facture émise sur l'intervention, 2 lignes, TVA 10 %
  v_inv := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'intervention_id', v_interv, 'subject', 'Entretien', 'due_days', 30,
      'total_ht', 92.73, 'total_tva', 9.27, 'total_ttc', 102.00,
      'vat_breakdown', '[{"rate":10,"base":92.73,"amount":9.27}]'::jsonb,
      'customer', jsonb_build_object('name', 'REHEARSAL Client')),
    jsonb_build_array(
      jsonb_build_object('position', 1, 'kind', 'contrat', 'label', 'Entretien poêle', 'quantity', 1, 'unit_price_ht', 81.8182, 'vat_rate', 10, 'vat_code', 'FR_100', 'ht', 81.82, 'tva', 8.18, 'ttc', 90.00),
      jsonb_build_object('position', 2, 'kind', 'piece', 'label', 'Joint', 'quantity', 2, 'unit_price_ht', 5.4545, 'vat_rate', 10, 'vat_code', 'FR_100', 'ht', 10.91, 'tva', 1.09, 'ttc', 12.00)));
  PERFORM public.invoice_issue(v_inv, 'F');

  -- (2) Annulation par avoir
  v_res := public.invoice_cancel_with_credit_note(v_inv, 'F', 'Erreur de tarif');
  IF v_res->>'number' <> 'F-' || v_year || '-00002' THEN RAISE EXCEPTION '(2) numéro d''avoir % inattendu', v_res->>'number'; END IF;
  SELECT status INTO v_row FROM public.majordhome_invoices WHERE id = v_inv;
  IF v_row.status <> 'cancelled' THEN RAISE EXCEPTION '(2) original non annulé (%)', v_row.status; END IF;
  SELECT kind, status, credited_invoice_id, credited_number, total_ht, total_tva, total_ttc, due_days, subject, vat_breakdown
    INTO v_row FROM public.majordhome_invoices WHERE id = (v_res->>'credit_note_id')::uuid;
  IF v_row.kind <> 'credit_note' OR v_row.status <> 'issued' OR v_row.credited_invoice_id <> v_inv THEN RAISE EXCEPTION '(2) avoir mal formé : %', to_jsonb(v_row); END IF;
  IF v_row.credited_number NOT LIKE 'F-%-00001' THEN RAISE EXCEPTION '(2) credited_number % inattendu', v_row.credited_number; END IF;
  IF v_row.total_ttc <> -102.00 OR v_row.total_ht <> -92.73 OR v_row.total_tva <> -9.27 OR v_row.due_days <> 0 THEN RAISE EXCEPTION '(2) totaux avoir : %', to_jsonb(v_row); END IF;
  IF v_row.subject NOT LIKE 'Avoir sur la facture F-%00001 — Erreur de tarif' THEN RAISE EXCEPTION '(2) objet % inattendu', v_row.subject; END IF;
  IF (v_row.vat_breakdown->0->>'amount')::numeric <> -9.27 THEN RAISE EXCEPTION '(2) ventilation TVA non négative : %', v_row.vat_breakdown; END IF;
  SELECT count(*), sum(ttc), array_agg(quantity ORDER BY position) INTO v_row FROM public.majordhome_invoice_lines WHERE invoice_id = (v_res->>'credit_note_id')::uuid;
  IF v_row.count <> 2 OR v_row.sum <> -102.00 OR v_row.array_agg <> ARRAY[1,2]::numeric[] THEN RAISE EXCEPTION '(2) lignes avoir : %', to_jsonb(v_row); END IF;
  -- Négation ligne à ligne (une requête par colonne : un record avec 3 max() porterait
  -- 3 champs nommés "max", ambigus au premier accès par nom).
  SELECT max(unit_price_ht) INTO v_row FROM public.majordhome_invoice_lines WHERE invoice_id = (v_res->>'credit_note_id')::uuid;
  IF v_row.max >= 0 THEN RAISE EXCEPTION '(2) unit_price_ht non négatif sur au moins une ligne : %', v_row.max; END IF;
  SELECT max(ht) INTO v_row FROM public.majordhome_invoice_lines WHERE invoice_id = (v_res->>'credit_note_id')::uuid;
  IF v_row.max >= 0 THEN RAISE EXCEPTION '(2) ht non négatif sur au moins une ligne : %', v_row.max; END IF;
  SELECT max(tva) INTO v_row FROM public.majordhome_invoice_lines WHERE invoice_id = (v_res->>'credit_note_id')::uuid;
  IF v_row.max >= 0 THEN RAISE EXCEPTION '(2) tva non négatif sur au moins une ligne : %', v_row.max; END IF;

  -- (3) Deuxième annulation : refusée ; annuler l'avoir lui-même : refusé ; annuler un brouillon : refusé
  ok := false; BEGIN PERFORM public.invoice_cancel_with_credit_note(v_inv, 'F', NULL); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) facture annulée ré-annulable'; END IF;
  ok := false; BEGIN PERFORM public.invoice_cancel_with_credit_note((v_res->>'credit_note_id')::uuid, 'F', NULL); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) avoir annulable'; END IF;
  v_draft := public.invoice_create_draft(jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  ok := false; BEGIN PERFORM public.invoice_cancel_with_credit_note(v_draft, 'F', NULL); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) brouillon annulable'; END IF;

  -- (4) L'intervention est refacturable après l'avoir (index restreint aux factures émises)
  v_draft := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'intervention_id', v_interv, 'total_ht', 10, 'total_tva', 1, 'total_ttc', 11),
    jsonb_build_array(jsonb_build_object('label', 'Refacturation', 'vat_rate', 10, 'vat_code', 'FR_100', 'ht', 10, 'tva', 1, 'ttc', 11)));
  v_res := public.invoice_issue(v_draft, 'F');
  IF v_res->>'number' <> 'F-' || v_year || '-00003' THEN RAISE EXCEPTION '(4) refacturation : numéro % inattendu', v_res->>'number'; END IF;
  RESET ROLE;

  -- (5) Cross-org : refusé
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, false);
  SET LOCAL ROLE authenticated;
  ok := false; BEGIN PERFORM public.invoice_cancel_with_credit_note(v_draft, 'F', NULL); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(5) annulation cross-org acceptée'; END IF;
  RESET ROLE;

  RAISE NOTICE 'assert-invoices-credit-note B (fonctionnel) : OK';
END $$;
ROLLBACK;
