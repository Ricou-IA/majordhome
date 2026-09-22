-- supabase/migrations/20260923_2_invoices_unique_issued_per_intervention.sql
-- ============================================================================
-- Hub de facturation — durcissement post-revue (finding F1) : deux factures
-- ÉMISES sur la même intervention étaient possibles (l'idempotence n'était
-- portée que par l'UI — bouton « Facturer » masqué dès `invoice_id` posé,
-- cf. EntretienSAVCard.jsx). Un double clic concurrent, un retry réseau après
-- succès non reçu, ou un appel RPC direct pouvaient créer un 2ᵉ brouillon puis
-- l'émettre : la carte ne porte qu'un seul `invoice_id`, la 2ᵉ facture émise
-- devenait fantôme (numérotée, jamais rattachée).
--
--   - Index unique PARTIEL (status='issued', intervention_id NOT NULL) : la
--     dernière ligne de défense, au niveau DB, indépendante de l'UI.
--   - `invoice_issue` (CREATE OR REPLACE, corps copié de 20260923_1 + 1 garde) :
--     vérifie explicitement AVANT d'attribuer un numéro — message clair
--     (`intervention_already_invoiced`) plutôt qu'un 23505 nu remonté par
--     l'index si la fenêtre de course était gagnée par l'UPDATE final.
--   - Un entretien = une facture émise. Un avoir (phase 3, `kind='credit_note'`)
--     n'est PAS couvert par cet index (il porte son propre `intervention_id`
--     NULL en pratique — un avoir se rattache à la facture créditée via
--     `credited_invoice_id`, pas à l'intervention) ; cette règle sera reprise
--     à l'implémentation de l'avoir si un jour un avoir porte `intervention_id`.
-- Répétée sur scripts/migration-rehearsal/ (assert-invoices-unique.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Index unique : au plus une facture ÉMISE par intervention
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_issued_per_intervention
  ON majordhome.invoices (intervention_id)
  WHERE status = 'issued' AND intervention_id IS NOT NULL;

COMMENT ON INDEX majordhome.invoices_one_issued_per_intervention IS
  'Un entretien = une facture émise. Un avoir (phase 3) portera kind=''credit_note'' : cette règle sera revue alors si un avoir en vient à porter intervention_id.';

-- ----------------------------------------------------------------------------
-- 2. invoice_issue — corps identique à 20260923_1 + garde explicite juste après
--    la vérification `status <> 'draft'` (message clair avant que l'UPDATE
--    final ne percute l'index unique).
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
  IF v_inv.intervention_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM majordhome.invoices
     WHERE intervention_id = v_inv.intervention_id AND status = 'issued' AND id <> p_invoice_id
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
