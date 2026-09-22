-- assert-invoices.sql — vérifie 20260923_1_invoices_hub.sql sur le cluster de répétition.
-- Un écart lève une exception → run.mjs sort en ECHEC.
-- Couvre : structure, RLS, privilèges, puis parcours fonctionnel en rôle authenticated :
-- brouillon → émission (numéro 00001 puis 00002), immuabilité, brouillon vide refusé,
-- anon refusé, isolation cross-org, émission manuelle refusée (10), écart total/lignes
-- refusé (11), une seule série de numérotation par org/année (12).

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; r record;
BEGIN
  IF to_regclass('majordhome.invoice_sequences') IS NULL THEN RAISE EXCEPTION 'table invoice_sequences absente'; END IF;
  IF to_regclass('majordhome.invoices') IS NULL THEN RAISE EXCEPTION 'table invoices absente'; END IF;
  IF to_regclass('majordhome.invoice_lines') IS NULL THEN RAISE EXCEPTION 'table invoice_lines absente'; END IF;
  IF to_regclass('public.majordhome_invoices') IS NULL THEN RAISE EXCEPTION 'vue majordhome_invoices absente'; END IF;
  IF to_regclass('public.majordhome_invoice_lines') IS NULL THEN RAISE EXCEPTION 'vue majordhome_invoice_lines absente'; END IF;

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relname IN ('invoice_sequences', 'invoices', 'invoice_lines') AND c.relrowsecurity;
  IF n <> 3 THEN RAISE EXCEPTION 'RLS activée sur % table(s) au lieu de 3', n; END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'invoices';
  IF n <> 3 THEN RAISE EXCEPTION 'invoices : % policies au lieu de 3', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'invoice_lines';
  IF n <> 1 THEN RAISE EXCEPTION 'invoice_lines : % policies au lieu de 1', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'invoice_sequences';
  IF n <> 0 THEN RAISE EXCEPTION 'invoice_sequences : % policies au lieu de 0', n; END IF;

  FOR r IN SELECT v.table_name, v.is_updatable, c.reloptions
             FROM information_schema.views v JOIN pg_class c ON c.relname = v.table_name
             JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = v.table_schema
            WHERE v.table_schema = 'public' AND v.table_name IN ('majordhome_invoices', 'majordhome_invoice_lines') LOOP
    IF r.reloptions::text NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'vue % sans security_invoker', r.table_name; END IF;
    IF r.is_updatable <> 'YES' THEN RAISE EXCEPTION 'vue % non updatable', r.table_name; END IF;
  END LOOP;

  -- Privilèges
  IF NOT has_table_privilege('service_role', 'majordhome.invoices', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur invoices'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.invoice_lines', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur invoice_lines'; END IF;
  IF has_table_privilege('anon', 'majordhome.invoices', 'SELECT') THEN RAISE EXCEPTION 'anon lit invoices'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.invoices', 'INSERT') THEN RAISE EXCEPTION 'authenticated peut INSERT invoices (doit passer par la RPC)'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.invoice_lines', 'UPDATE') THEN RAISE EXCEPTION 'authenticated peut UPDATE invoice_lines'; END IF;
  IF has_function_privilege('anon', 'public.invoice_create_draft(jsonb, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_create_draft exécutable par anon'; END IF;
  IF has_function_privilege('anon', 'public.invoice_issue(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_issue exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.invoice_issue(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_issue non exécutable par authenticated'; END IF;

  RAISE NOTICE 'assert-invoices A (structure) : OK';
END $$;

-- ── B. Parcours fonctionnel (rollback à la fin) ────────────────────────────
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_membre uuid; v_etranger uuid; v_role text;
  v_id uuid; v_id2 uuid; v_id3 uuid; v_id4 uuid; v_id5 uuid; v_id6 uuid;
  v_res jsonb; v_res2 jsonb;
  v_year text := extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::text;
  v_inv record;
  n int; ok boolean;
BEGIN
  -- Fixture : un org_admin ou team_leader Mayer avec profil ; un membre d'une autre org
  SELECT om.user_id, om.role INTO v_membre, v_role FROM core.organization_members om
    JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role IN ('org_admin', 'team_leader') LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'fixture : aucun org_admin/team_leader Mayer avec profil'; END IF;
  SELECT om.user_id INTO v_etranger FROM core.organization_members om
    JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id <> v_mayer AND om.user_id IS NOT NULL
     AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;
  IF v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : aucun membre d''une autre org hors Mayer'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;

  -- (1) Brouillon avec 2 lignes
  v_id := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'context', 'contrat', 'subject', 'Entretien test',
      'customer', jsonb_build_object('name', 'REHEARSAL Client', 'address', '1 rue Test', 'postal_code', '81600', 'city', 'Gaillac'),
      'due_days', 30, 'total_ht', 81.82, 'total_tva', 8.18, 'total_ttc', 90.00,
      'vat_breakdown', '[{"rate":10,"base":81.82,"amount":8.18}]'::jsonb),
    jsonb_build_array(
      jsonb_build_object('position', 1, 'kind', 'contrat', 'label', 'Entretien poêle', 'quantity', 1,
        'unit_price_ht', 81.8182, 'vat_rate', 10, 'ht', 81.82, 'tva', 8.18, 'ttc', 90.00, 'ledger_account_number', '70601'),
      jsonb_build_object('position', 2, 'kind', 'piece', 'label', 'Joint', 'quantity', 2,
        'unit_price_ht', 0, 'vat_rate', 10, 'ht', 0, 'tva', 0, 'ttc', 0)
    ));
  IF v_id IS NULL THEN RAISE EXCEPTION '(1) brouillon non créé'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_invoice_lines WHERE invoice_id = v_id;
  IF n <> 2 THEN RAISE EXCEPTION '(1) % ligne(s) au lieu de 2', n; END IF;
  SELECT status, number INTO v_inv FROM public.majordhome_invoices WHERE id = v_id;
  IF v_inv.status <> 'draft' OR v_inv.number IS NOT NULL THEN RAISE EXCEPTION '(1) brouillon mal initialisé'; END IF;

  -- (2) Émission : numéro <prefix>-<année>-00001 (compteur vierge sur le cluster jetable)
  v_res := public.invoice_issue(v_id, 'F');
  IF v_res->>'number' <> 'F-' || v_year || '-00001' THEN RAISE EXCEPTION '(2) numéro % inattendu', v_res->>'number'; END IF;
  SELECT status, number, invoice_date, due_at, issued_at INTO v_inv FROM public.majordhome_invoices WHERE id = v_id;
  IF v_inv.status <> 'issued' OR v_inv.issued_at IS NULL THEN RAISE EXCEPTION '(2) facture non émise'; END IF;
  IF v_inv.due_at <> v_inv.invoice_date + 30 THEN RAISE EXCEPTION '(2) échéance % ≠ date + 30', v_inv.due_at; END IF;

  -- (3) Deuxième émission : 00002 (continuité)
  v_id2 := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'total_ht', 10, 'total_tva', 2, 'total_ttc', 12),
    jsonb_build_array(jsonb_build_object('label', 'Ligne', 'ht', 10, 'tva', 2, 'ttc', 12)));
  v_res2 := public.invoice_issue(v_id2, 'F');
  IF v_res2->>'number' <> 'F-' || v_year || '-00002' THEN RAISE EXCEPTION '(3) numéro % inattendu', v_res2->>'number'; END IF;

  -- (4) Ré-émettre une facture émise : refusé
  ok := false;
  BEGIN
    PERFORM public.invoice_issue(v_id, 'F');
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(4) double émission acceptée'; END IF;

  -- (5) Immuabilité : total figé, lignes figées ; pdf_path modifiable
  ok := false;
  BEGIN
    UPDATE public.majordhome_invoices SET total_ttc = 91, total_ht = 82.82 WHERE id = v_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(5) total d''une facture émise modifié'; END IF;
  UPDATE public.majordhome_invoices SET pdf_path = v_mayer || '/' || v_year || '/F-' || v_year || '-00001.pdf' WHERE id = v_id;
  SELECT pdf_path INTO v_inv FROM public.majordhome_invoices WHERE id = v_id;
  IF v_inv.pdf_path IS NULL THEN RAISE EXCEPTION '(5) pdf_path non posé'; END IF;
  ok := false;
  BEGIN
    DELETE FROM public.majordhome_invoices WHERE id = v_id;
    -- policy delete = brouillons seulement : 0 ligne, pas d'erreur
    GET DIAGNOSTICS n = ROW_COUNT;
    ok := (n = 0);
  END;
  IF NOT ok THEN RAISE EXCEPTION '(5) une facture émise a été supprimée'; END IF;

  -- (6) Brouillon sans ligne : refusé
  ok := false;
  BEGIN
    PERFORM public.invoice_create_draft(jsonb_build_object('org_id', v_mayer), '[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(6) brouillon vide accepté'; END IF;

  -- (7) Préfixe invalide : refusé
  v_id3 := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  ok := false;
  BEGIN
    PERFORM public.invoice_issue(v_id3, 'f-1');
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(7) préfixe invalide accepté'; END IF;
  -- brouillon supprimable par team_leader+
  DELETE FROM public.majordhome_invoices WHERE id = v_id3;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '(7) brouillon non supprimable'; END IF;
  RESET ROLE;

  -- (8) Isolation cross-org : un membre d'une autre org ne voit rien, ne peut pas émettre
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, false);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.majordhome_invoices WHERE org_id = v_mayer;
  IF n <> 0 THEN RAISE EXCEPTION '(8) % facture(s) Mayer visibles par une autre org', n; END IF;
  ok := false;
  BEGIN
    PERFORM public.invoice_create_draft(jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(8) brouillon Mayer créé par une autre org'; END IF;
  RESET ROLE;

  -- (9) Anonyme : refusé
  PERFORM set_config('request.jwt.claim.sub', '', false);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN
    PERFORM public.invoice_create_draft(jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(9) brouillon créé sans auth.uid()'; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;

  -- (10) Émission manuelle par UPDATE direct : refusée sur un brouillon frais ; un champ
  -- ordinaire (subject) reste éditable en dehors d'invoice_issue.
  v_id4 := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  ok := false;
  BEGIN
    UPDATE public.majordhome_invoices
       SET status = 'issued', number = 'F-' || v_year || '-99999', issued_at = now(), invoice_date = current_date
     WHERE id = v_id4;
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(10) émission manuelle par UPDATE acceptée'; END IF;
  UPDATE public.majordhome_invoices SET subject = 'Modifié via UPDATE' WHERE id = v_id4;
  SELECT subject INTO v_inv FROM public.majordhome_invoices WHERE id = v_id4;
  IF v_inv.subject <> 'Modifié via UPDATE' THEN RAISE EXCEPTION '(10) UPDATE de subject sur un brouillon refusé à tort'; END IF;

  -- (11) Écart en-tête / somme des lignes à la création : refusé
  ok := false;
  BEGIN
    PERFORM public.invoice_create_draft(
      jsonb_build_object('org_id', v_mayer, 'total_ht', 1000, 'total_tva', 0, 'total_ttc', 1000),
      jsonb_build_array(jsonb_build_object('label', 'Ligne', 'ht', 10, 'tva', 2, 'ttc', 12)));
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(11) écart en-tête/lignes accepté à la création'; END IF;

  -- (12) Une seule série de numérotation par (org, année) : un 2ᵉ préfixe la même année est
  -- refusé, le 1ᵉʳ préfixe continue sans trou (00003 après les 00001/00002 des tests 2-3).
  v_id5 := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  ok := false;
  BEGIN
    PERFORM public.invoice_issue(v_id5, 'AV');
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(12) préfixe concurrent AV accepté sur la série F'; END IF;

  v_id6 := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  v_res := public.invoice_issue(v_id6, 'F');
  IF v_res->>'number' <> 'F-' || v_year || '-00003' THEN RAISE EXCEPTION '(12) numéro % inattendu (attendu 00003)', v_res->>'number'; END IF;
  RESET ROLE;

  RAISE NOTICE 'assert-invoices B (fonctionnel) : OK';
END $$;
ROLLBACK;
