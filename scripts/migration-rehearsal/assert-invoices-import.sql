-- assert-invoices-import.sql — vérifie 20260923_3_invoices_pennylane_import.sql.
-- Un écart lève une exception → run.mjs sort en ECHEC.

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; v_last text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='invoice_lines' AND column_name='vat_code') THEN
    RAISE EXCEPTION 'invoice_lines.vat_code absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='invoices' AND column_name='import_attempted_at') THEN
    RAISE EXCEPTION 'invoices.import_attempted_at absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_invoices' AND column_name='import_attempted_at') THEN
    RAISE EXCEPTION 'vue majordhome_invoices sans import_attempted_at (non recréée)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_invoice_lines' AND column_name='vat_code') THEN
    RAISE EXCEPTION 'vue majordhome_invoice_lines sans vat_code (non recréée)'; END IF;
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema='public' AND table_name='majordhome_entretien_sav' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'invoice_import_status' THEN RAISE EXCEPTION 'majordhome_entretien_sav : dernière colonne % au lieu de invoice_import_status', v_last; END IF;
  SELECT count(*) INTO n FROM pg_class c WHERE c.relnamespace='public'::regnamespace
     AND c.relname IN ('majordhome_invoices','majordhome_invoice_lines','majordhome_entretien_sav') AND c.reloptions::text LIKE '%security_invoker=true%';
  IF n <> 3 THEN RAISE EXCEPTION 'security_invoker attendu sur 3 vues, trouvé %', n; END IF;
  IF has_function_privilege('anon', 'public.invoice_set_import_result(uuid, text, bigint, bigint, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_set_import_result exécutable par anon'; END IF;
  IF has_function_privilege('authenticated', 'public.invoice_set_import_result(uuid, text, bigint, bigint, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_set_import_result exécutable par authenticated'; END IF;
  IF NOT has_function_privilege('service_role', 'public.invoice_set_import_result(uuid, text, bigint, bigint, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_set_import_result non exécutable par service_role'; END IF;
  IF pg_get_functiondef('public.invoice_create_draft(jsonb, jsonb)'::regprocedure) NOT LIKE '%vat_code%' THEN RAISE EXCEPTION 'invoice_create_draft n''insère pas vat_code'; END IF;
  RAISE NOTICE 'assert-invoices-import A (structure) : OK';
END $$;

-- ── B. Fonctionnel (rollback) ──────────────────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_membre uuid; v_id uuid; v_draft uuid; v_res jsonb; v_row record; ok boolean; n int;
BEGIN
  SELECT om.user_id INTO v_membre FROM core.organization_members om JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role IN ('org_admin','team_leader') LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'fixture : aucun org_admin/team_leader Mayer avec profil'; END IF;

  -- (1) Brouillon avec vat_code, émis, comme team_leader
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;
  v_id := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'total_ht', 10, 'total_tva', 1, 'total_ttc', 11),
    jsonb_build_array(jsonb_build_object('label', 'Entretien', 'vat_rate', 10, 'vat_code', 'FR_100', 'ht', 10, 'tva', 1, 'ttc', 11)));
  SELECT vat_code INTO v_row FROM public.majordhome_invoice_lines WHERE invoice_id = v_id;
  IF v_row.vat_code <> 'FR_100' THEN RAISE EXCEPTION '(1) vat_code % au lieu de FR_100', v_row.vat_code; END IF;
  PERFORM public.invoice_issue(v_id, 'F');
  v_draft := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  -- (2) authenticated ne peut pas poser un résultat d'import
  ok := false;
  BEGIN
    PERFORM public.invoice_set_import_result(v_id, 'imported', 123, 456, NULL);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(2) authenticated a posé un résultat d''import'; END IF;
  RESET ROLE;

  -- (3) service_role : succès puis échec, colonnes de suivi ; brouillon refusé
  SET LOCAL ROLE service_role;
  v_res := public.invoice_set_import_result(v_id, 'imported', 123, 456, NULL);
  SELECT import_status, import_error, import_attempted_at, pennylane_invoice_id, pennylane_ledger_entry_id INTO v_row
    FROM majordhome.invoices WHERE id = v_id;
  IF v_row.import_status <> 'imported' OR v_row.pennylane_invoice_id <> 123 OR v_row.pennylane_ledger_entry_id <> 456
     OR v_row.import_attempted_at IS NULL OR v_row.import_error IS NOT NULL THEN
    RAISE EXCEPTION '(3) résultat imported mal posé : %', to_jsonb(v_row); END IF;
  v_res := public.invoice_set_import_result(v_id, 'error', NULL, NULL, 'Pennylane 422 : test');
  SELECT import_status, import_error, pennylane_invoice_id INTO v_row FROM majordhome.invoices WHERE id = v_id;
  IF v_row.import_status <> 'error' OR v_row.import_error NOT LIKE 'Pennylane 422%' OR v_row.pennylane_invoice_id <> 123 THEN
    RAISE EXCEPTION '(3) résultat error mal posé : %', to_jsonb(v_row); END IF;
  ok := false;
  BEGIN
    PERFORM public.invoice_set_import_result(v_draft, 'imported', 1, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(3) résultat posé sur un brouillon'; END IF;
  ok := false;
  BEGIN
    PERFORM public.invoice_set_import_result(v_id, 'bogus', NULL, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(3) statut invalide accepté'; END IF;
  RESET ROLE;

  -- (4) La vue carte expose le statut pour un invoice_id uuid, NULL pour un id Pennylane
  SELECT count(*) INTO n FROM public.majordhome_entretien_sav WHERE invoice_import_status IS NOT NULL;
  RAISE NOTICE '(4) % carte(s) avec statut d''import (0 attendu sur le snapshot : interventions sans données)', n;

  RAISE NOTICE 'assert-invoices-import B (fonctionnel) : OK';
END $$;
ROLLBACK;
