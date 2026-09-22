-- supabase/migrations/20260923_4_invoices_credit_note.sql
-- ============================================================================
-- Hub de facturation — phase 3 : avoir = annulation TOTALE d'une facture émise
-- (spec 2026-09-22 : « toute correction = avoir, facture négative référençant
-- l'originale »). Une seule annulation par facture, pas d'avoir partiel.
--   - L'index « un entretien = une facture émise » ne compte plus que les
--     factures kind='invoice' : un entretien annulé par avoir est refacturable.
--   - invoice_issue : même restriction sur sa garde explicite.
--   - invoice_cancel_with_credit_note : copie NÉGATIVE de l'en-tête et des lignes,
--     émission via invoice_issue (même série), original → cancelled. Tout ou rien.
--   - majordhome_invoices expose credited_number (PDF « Avoir sur la facture N »).
-- Répétée sur scripts/migration-rehearsal/ (assert-invoices-credit-note.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Index unique : au plus une FACTURE émise par intervention (les avoirs et
--    les factures annulées ne comptent pas)
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS majordhome.invoices_one_issued_per_intervention;
CREATE UNIQUE INDEX invoices_one_issued_per_intervention
  ON majordhome.invoices (intervention_id)
  WHERE status = 'issued' AND kind = 'invoice' AND intervention_id IS NOT NULL;
COMMENT ON INDEX majordhome.invoices_one_issued_per_intervention IS
  'Un entretien = une FACTURE émise (kind=invoice). Un avoir (kind=credit_note) et une facture annulée (status=cancelled) ne comptent pas : après un avoir, l''entretien est refacturable.';

-- ----------------------------------------------------------------------------
-- 1bis. Index unique : au plus un AVOIR émis par facture créditée (l'annulation
--       reste unique — RPC déjà gardée par `already_credited`, filet DB en plus)
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_credit_note_per_invoice
  ON majordhome.invoices (credited_invoice_id)
  WHERE kind = 'credit_note' AND status = 'issued' AND credited_invoice_id IS NOT NULL;
COMMENT ON INDEX majordhome.invoices_one_credit_note_per_invoice IS
  'Une facture émise n''est créditée qu''une fois : au plus un avoir (kind=credit_note, status=issued) par credited_invoice_id.';

-- ----------------------------------------------------------------------------
-- 2. invoice_issue — corps identique à 20260923_2 ; la garde explicite ne vise
--    que les FACTURES (l'émission d'un avoir ne doit ni être bloquée, ni bloquer)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_issue(p_invoice_id uuid, p_number_prefix text DEFAULT 'F')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_inv majordhome.invoices%ROWTYPE;
  v_role text;
  v_prefix text := upper(coalesce(nullif(trim(p_number_prefix), ''), 'F'));
  v_date date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_year int;
  v_n int;
  v_number text;
  v_lines int;
  v_sum_ht numeric(12,2);
  v_sum_tva numeric(12,2);
  v_sum_ttc numeric(12,2);
  v_existing_prefix text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_prefix !~ '^[A-Z][A-Z0-9]{0,5}$' THEN
    RAISE EXCEPTION 'invalid_prefix' USING ERRCODE = '22023', DETAIL = 'Préfixe : 1 à 6 caractères A-Z / 0-9, commence par une lettre.';
  END IF;

  SELECT * INTO v_inv FROM majordhome.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT role INTO v_role FROM core.organization_members
   WHERE org_id = v_inv.org_id AND user_id = v_user LIMIT 1;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_leader_required' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'invoice_already_issued' USING ERRCODE = '42501', DETAIL = v_inv.number;
  END IF;
  -- Finding F1 (2ᵉ facture émise sur la même intervention) : vérifié ici, avant
  -- d'attribuer un numéro — l'index unique reste le filet si cette garde était
  -- contournée (appel RPC direct hors de ce chemin, ce qui n'existe pas).
  -- Phase 3 (avoir) : ne vise que les FACTURES — l'émission d'un avoir ne doit
  -- ni être bloquée par une facture émise existante, ni bloquer une future
  -- facture (l'avoir n'a pas vocation à occuper la place de l'intervention).
  IF v_inv.kind = 'invoice' AND v_inv.intervention_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM majordhome.invoices
     WHERE intervention_id = v_inv.intervention_id AND status = 'issued' AND kind = 'invoice' AND id <> p_invoice_id
  ) THEN
    RAISE EXCEPTION 'intervention_already_invoiced' USING ERRCODE = '23505',
      DETAIL = 'Cette intervention a déjà une facture émise.';
  END IF;
  SELECT count(*) INTO v_lines FROM majordhome.invoice_lines WHERE invoice_id = p_invoice_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'lines_required' USING ERRCODE = '22023';
  END IF;

  -- Re-vérifié ici : rien n'empêche un UPDATE direct des totaux d'en-tête entre la création
  -- du brouillon et son émission (seules status/number/year/issued_at/invoice_date/due_at
  -- sont gelées sur un brouillon) — on n'émet jamais sur un écart en-tête/lignes.
  SELECT sum(ht), sum(tva), sum(ttc) INTO v_sum_ht, v_sum_tva, v_sum_ttc
    FROM majordhome.invoice_lines WHERE invoice_id = p_invoice_id;
  IF v_sum_ht IS DISTINCT FROM v_inv.total_ht
     OR v_sum_tva IS DISTINCT FROM v_inv.total_tva
     OR v_sum_ttc IS DISTINCT FROM v_inv.total_ttc
  THEN
    RAISE EXCEPTION 'totals_mismatch' USING ERRCODE = '22023',
      DETAIL = format('en-tête (ht=%s, tva=%s, ttc=%s) ≠ somme des lignes (ht=%s, tva=%s, ttc=%s)',
        v_inv.total_ht, v_inv.total_tva, v_inv.total_ttc, v_sum_ht, v_sum_tva, v_sum_ttc);
  END IF;

  v_year := extract(year FROM v_date)::int;
  -- Une seule série par (org, année) : le préfixe se fixe au premier numéro émis, puis se
  -- vérifie — sinon une 2ᵉ série percerait des trous dans la 1ʳᵉ (même compteur, préfixes
  -- différents). La ligne (org, année) est verrouillée avant le préfixe pour sérialiser deux
  -- émissions concurrentes de la même année.
  INSERT INTO majordhome.invoice_sequences (org_id, year, last_number, prefix)
  VALUES (v_inv.org_id, v_year, 0, NULL)
  ON CONFLICT (org_id, year) DO NOTHING;

  SELECT prefix INTO v_existing_prefix
    FROM majordhome.invoice_sequences
   WHERE org_id = v_inv.org_id AND year = v_year
   FOR UPDATE;

  IF v_existing_prefix IS NOT NULL AND v_existing_prefix <> v_prefix THEN
    RAISE EXCEPTION 'prefix_mismatch' USING ERRCODE = '22023',
      DETAIL = format('série %s déjà amorcée avec le préfixe %s, reçu %s', v_year, v_existing_prefix, v_prefix);
  END IF;

  UPDATE majordhome.invoice_sequences
     SET last_number = last_number + 1,
         prefix = COALESCE(prefix, v_prefix)
   WHERE org_id = v_inv.org_id AND year = v_year
   RETURNING last_number INTO v_n;
  v_number := format('%s-%s-%s', v_prefix, v_year, lpad(v_n::text, 5, '0'));

  -- Repère de transaction lu par invoices_guard_immutable : seule cette UPDATE peut poser
  -- status/number/year/issued_at/invoice_date/due_at sur un brouillon.
  PERFORM set_config('majordhome.invoice_issue_id', p_invoice_id::text, true);
  UPDATE majordhome.invoices
     SET status = 'issued', number = v_number, year = v_year, invoice_date = v_date,
         due_at = v_date + (due_days || ' days')::interval, issued_at = now()
   WHERE id = p_invoice_id;
  PERFORM set_config('majordhome.invoice_issue_id', '', true);

  RETURN jsonb_build_object(
    'id', p_invoice_id, 'number', v_number, 'year', v_year,
    'invoice_date', v_date, 'due_at', (v_date + (v_inv.due_days || ' days')::interval)::date,
    'issued_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_issue(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_issue(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC — annulation par avoir (tout ou rien)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_cancel_with_credit_note(
  p_invoice_id uuid,
  p_number_prefix text DEFAULT 'F',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_src majordhome.invoices%ROWTYPE;
  v_credit_id uuid;
  v_issued jsonb;
  v_subject text;
  v_vat jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_src FROM majordhome.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT role INTO v_role FROM core.organization_members
   WHERE org_id = v_src.org_id AND user_id = v_user LIMIT 1;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_leader_required' USING ERRCODE = '42501';
  END IF;
  IF v_src.status <> 'issued' OR v_src.kind <> 'invoice' THEN
    RAISE EXCEPTION 'credit_note_source_invalid' USING ERRCODE = '22023',
      DETAIL = format('status=%s kind=%s', v_src.status, v_src.kind);
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.invoices WHERE credited_invoice_id = p_invoice_id AND kind = 'credit_note' AND status = 'issued') THEN
    RAISE EXCEPTION 'already_credited' USING ERRCODE = '23505', DETAIL = v_src.number;
  END IF;

  v_subject := format('Avoir sur la facture %s', v_src.number)
    || CASE WHEN nullif(trim(p_reason), '') IS NOT NULL THEN ' — ' || left(trim(p_reason), 200) ELSE '' END;

  IF jsonb_typeof(COALESCE(v_src.vat_breakdown, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'credit_note_source_invalid' USING ERRCODE = '22023', DETAIL = 'vat_breakdown non tabulaire';
  END IF;

  -- Ventilation TVA négative (base et montant × -1, taux inchangé)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'rate', (e->>'rate')::numeric,
           'base', -((e->>'base')::numeric),
           'amount', -((e->>'amount')::numeric))), '[]'::jsonb)
    INTO v_vat
    FROM jsonb_array_elements(COALESCE(v_src.vat_breakdown, '[]'::jsonb)) e;

  INSERT INTO majordhome.invoices (
    org_id, kind, credited_invoice_id, context, client_id, contract_id, intervention_id, customer,
    subject, currency, due_days, total_ht, total_tva, total_ttc, vat_breakdown, discount, created_by
  ) VALUES (
    v_src.org_id, 'credit_note', v_src.id, v_src.context, v_src.client_id, v_src.contract_id, v_src.intervention_id, v_src.customer,
    v_subject, v_src.currency, 0, -v_src.total_ht, -v_src.total_tva, -v_src.total_ttc, v_vat, NULL, v_user
  ) RETURNING id INTO v_credit_id;

  INSERT INTO majordhome.invoice_lines (
    invoice_id, org_id, position, kind, label, description, quantity, unit_price_ht, vat_rate,
    discount_percent, ht, tva, ttc, ledger_account_number, ledger_account_pl_id, metier_key,
    equipment_id, category_id, vat_code
  )
  SELECT v_credit_id, l.org_id, l.position, l.kind, l.label, l.description, l.quantity, -l.unit_price_ht, l.vat_rate,
         l.discount_percent, -l.ht, -l.tva, -l.ttc, l.ledger_account_number, l.ledger_account_pl_id, l.metier_key,
         l.equipment_id, l.category_id, l.vat_code
    FROM majordhome.invoice_lines l
   WHERE l.invoice_id = v_src.id
   ORDER BY l.position;

  -- Même série de numérotation, mêmes contrôles (totaux = lignes, préfixe figé)
  v_issued := public.invoice_issue(v_credit_id, p_number_prefix);

  -- L'original ne bouge que par cette transition (trigger invoices_guard_immutable)
  UPDATE majordhome.invoices SET status = 'cancelled' WHERE id = v_src.id;

  RETURN jsonb_build_object(
    'credit_note_id', v_credit_id,
    'number', v_issued->>'number',
    'credited_invoice_id', v_src.id,
    'credited_number', v_src.number,
    'total_ttc', -v_src.total_ttc
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_cancel_with_credit_note(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_cancel_with_credit_note(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Vue majordhome_invoices + credited_number (dernière colonne ; sous-requête
--    scalaire : la vue reste updatable sur les colonnes de base)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.majordhome_invoices;
CREATE VIEW public.majordhome_invoices WITH (security_invoker = true) AS
  SELECT i.*,
         (SELECT o.number FROM majordhome.invoices o WHERE o.id = i.credited_invoice_id) AS credited_number
    FROM majordhome.invoices i;

REVOKE ALL ON public.majordhome_invoices FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.majordhome_invoices TO authenticated;
GRANT SELECT ON public.majordhome_invoices TO service_role;
COMMENT ON VIEW public.majordhome_invoices IS
  'Miroir auto-updatable de majordhome.invoices (security_invoker, RLS org) + credited_number (numéro de la facture créditée par un avoir). Brouillon : UPDATE libre sauf colonnes d''émission ; émise : colonnes de suivi seulement ; INSERT via invoice_create_draft / invoice_cancel_with_credit_note.';
