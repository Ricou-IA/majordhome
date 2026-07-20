-- ============================================================================
-- migration_attach_autowin_accepted_quote.sql
-- ----------------------------------------------------------------------------
-- Auto-gain immédiat quand on rattache un devis Pennylane DÉJÀ validé.
--
-- Contexte : le rattachement manuel (lead_attach_quotes_and_send) stocke bien
-- quote_status='accepted', mais poussait seulement le lead en « Devis envoyé ».
-- Le passage en Gagné + chantier_status='gagne' était laissé au cron
-- pennylane-sync-quote-status (*/15) → jusqu'à 15 min de latence avant que le
-- chantier apparaisse (cas vécu : lead GALIBERT, 2026-07-19).
--
-- Fix : à la fin de l'attache, si un devis rattaché est déjà accepted/invoiced,
-- on appelle lead_mark_won_with_quote tout de suite. Le cron reste le filet
-- pour les validations POSTÉRIEURES au rattachement (envoyé → validé plus tard).
--
-- Sélection du gagnant : identique à pennylane_sync_ensure_winning_quotes
-- (accepted le plus récent, tie-break pennylane_quote_id DESC) → aucune
-- divergence possible entre le chemin attache et le chemin cron.
--
-- Fail-soft : un échec du gain n'annule pas l'attache (le cron rattrapera),
-- mais laisse un WARNING — pas d'échec muet.
--
-- Seules modifications vs la version précédente :
--   1. DECLARE : + v_winning_pl_id bigint
--   2. Nouveau bloc d'auto-gain avant le RETURN final
--   3. RETURN : + clé 'won_immediately' (observabilité, rétro-compatible)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_attach_quotes_and_send(
  p_org_id uuid,
  p_lead_id uuid,
  p_quotes jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public', 'core'
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_pennylane_enabled bool := false;
  v_target_client_id uuid;
  v_current_status_id uuid;
  v_current_display_order int;
  v_current_quote_sent_date date;
  v_devis_envoye_status_id uuid;
  v_status_changed bool := false;

  v_quote jsonb;
  v_quote_pl_id bigint;
  v_quote_customer_id bigint;
  v_quote_amount numeric;
  v_quote_label text;
  v_quote_date date;
  v_quote_status text;
  v_quote_pdf_url text;
  v_existing_id uuid;
  v_existing_lead_id uuid;
  v_new_id uuid;
  v_action text;
  v_attached_count int := 0;
  v_results jsonb := '[]'::jsonb;
  v_attached_labels text[] := ARRAY[]::text[];

  v_most_recent_date date;
  v_most_recent_amount numeric;

  -- Auto-gain à l'attache (cf. en-tête)
  v_winning_pl_id bigint;
BEGIN
  IF v_user IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.org_id = p_org_id AND om.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Acces refuse' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE((settings->'pennylane'->>'enabled')::bool, false)
    INTO v_pennylane_enabled
  FROM core.organizations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Org % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_pennylane_enabled THEN
    RAISE EXCEPTION 'Pennylane integration disabled for org %', p_org_id
      USING ERRCODE = '42501';
  END IF;

  IF p_quotes IS NULL OR jsonb_typeof(p_quotes) <> 'array' THEN
    RAISE EXCEPTION 'p_quotes must be a non-null JSONB array';
  END IF;

  IF jsonb_array_length(p_quotes) = 0 THEN
    RETURN jsonb_build_object(
      'attached', 0,
      'lead_status_changed', false,
      'new_status_id', NULL,
      'results', '[]'::jsonb
    );
  END IF;

  SELECT l.client_id, l.status_id, l.quote_sent_date, s.display_order
    INTO v_target_client_id, v_current_status_id, v_current_quote_sent_date, v_current_display_order
  FROM majordhome.leads l
  LEFT JOIN majordhome.statuses s ON s.id = l.status_id
  WHERE l.id = p_lead_id AND l.org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % not found in org %', p_lead_id, p_org_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    (q->>'date')::date,
    (q->>'amount_ht')::numeric
    INTO v_most_recent_date, v_most_recent_amount
  FROM jsonb_array_elements(p_quotes) q
  ORDER BY
    (q->>'date')::date DESC NULLS LAST,
    (q->>'amount_ht')::numeric DESC NULLS LAST
  LIMIT 1;

  FOR v_quote IN SELECT * FROM jsonb_array_elements(p_quotes)
  LOOP
    v_quote_pl_id := (v_quote->>'quote_pl_id')::bigint;
    IF v_quote_pl_id IS NULL THEN
      RAISE EXCEPTION 'Each quote must have a quote_pl_id (got %)', v_quote;
    END IF;

    v_quote_customer_id := (v_quote->>'customer_id')::bigint;
    v_quote_amount := (v_quote->>'amount_ht')::numeric;
    v_quote_label := v_quote->>'label';
    v_quote_date := (v_quote->>'date')::date;
    v_quote_status := v_quote->>'status';
    v_quote_pdf_url := NULLIF(v_quote->>'pdf_url', '');

    SELECT id, lead_id INTO v_existing_id, v_existing_lead_id
    FROM majordhome.lead_pennylane_quotes
    WHERE org_id = p_org_id
      AND pennylane_quote_id = v_quote_pl_id
      AND ejected_at IS NULL
    LIMIT 1;

    v_new_id := NULL;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_lead_id = p_lead_id THEN
        UPDATE majordhome.lead_pennylane_quotes SET
          pennylane_customer_id = COALESCE(v_quote_customer_id, pennylane_customer_id),
          pennylane_client_id = COALESCE(pennylane_client_id, v_target_client_id),
          quote_amount_ht = COALESCE(v_quote_amount, quote_amount_ht),
          quote_label = COALESCE(v_quote_label, quote_label),
          quote_date = COALESCE(v_quote_date, quote_date),
          quote_status = COALESCE(v_quote_status, quote_status),
          pdf_url = COALESCE(v_quote_pdf_url, pdf_url)
        WHERE id = v_existing_id;
        v_action := 'already_assigned';
      ELSE
        UPDATE majordhome.lead_pennylane_quotes SET
          lead_id = p_lead_id,
          pennylane_client_id = COALESCE(pennylane_client_id, v_target_client_id),
          assigned_at = now(),
          pennylane_customer_id = COALESCE(v_quote_customer_id, pennylane_customer_id),
          quote_amount_ht = COALESCE(v_quote_amount, quote_amount_ht),
          quote_label = COALESCE(v_quote_label, quote_label),
          quote_date = COALESCE(v_quote_date, quote_date),
          quote_status = COALESCE(v_quote_status, quote_status),
          pdf_url = COALESCE(v_quote_pdf_url, pdf_url)
        WHERE id = v_existing_id;
        v_action := 'moved';
      END IF;
    ELSE
      INSERT INTO majordhome.lead_pennylane_quotes (
        org_id, lead_id, pennylane_quote_id,
        pennylane_customer_id, pennylane_client_id,
        quote_amount_ht, quote_label, quote_date, quote_status, pdf_url
      ) VALUES (
        p_org_id, p_lead_id, v_quote_pl_id,
        v_quote_customer_id,
        v_target_client_id,
        v_quote_amount,
        v_quote_label,
        v_quote_date,
        v_quote_status,
        v_quote_pdf_url
      ) RETURNING id INTO v_new_id;
      v_action := 'inserted';
    END IF;

    v_attached_count := v_attached_count + 1;
    IF v_quote_label IS NOT NULL THEN
      v_attached_labels := array_append(v_attached_labels, v_quote_label);
    END IF;

    v_results := v_results || jsonb_build_object(
      'pennylane_quote_id', v_quote_pl_id,
      'action', v_action,
      'id', COALESCE(v_existing_id, v_new_id)
    );
  END LOOP;

  IF v_current_display_order IS NOT NULL AND v_current_display_order < 4 THEN
    SELECT id INTO v_devis_envoye_status_id
    FROM majordhome.statuses
    WHERE display_order = 4
    LIMIT 1;

    IF v_devis_envoye_status_id IS NOT NULL THEN
      UPDATE majordhome.leads SET
        status_id = v_devis_envoye_status_id,
        quote_sent_date = COALESCE(v_most_recent_date, v_current_quote_sent_date, CURRENT_DATE),
        order_amount_ht = COALESCE(v_most_recent_amount, order_amount_ht),
        updated_at = now()
      WHERE id = p_lead_id;

      INSERT INTO majordhome.lead_activities (
        lead_id, user_id, activity_type, description,
        old_status_id, new_status_id, metadata, org_id
      ) VALUES (
        p_lead_id,
        v_user,
        'status_changed',
        'Statut : ' ||
          COALESCE((SELECT label FROM majordhome.statuses WHERE id = v_current_status_id), '?') ||
          ' → Devis envoyé (' || v_attached_count || ' devis Pennylane lié' ||
          CASE WHEN v_attached_count > 1 THEN 's' ELSE '' END ||
          CASE
            WHEN array_length(v_attached_labels, 1) > 0
              THEN ' : ' || array_to_string(v_attached_labels, ', ')
            ELSE ''
          END || ')',
        v_current_status_id,
        v_devis_envoye_status_id,
        jsonb_build_object(
          'source', 'pennylane_link',
          'attached_count', v_attached_count,
          'attached_quote_pl_ids', (
            SELECT jsonb_agg((r->>'pennylane_quote_id')::bigint)
            FROM jsonb_array_elements(v_results) r
          ),
          'most_recent_quote_date', v_most_recent_date,
          'most_recent_quote_amount_ht', v_most_recent_amount
        ),
        p_org_id
      );

      v_status_changed := true;
    END IF;

  ELSIF v_current_display_order = 4 THEN
    UPDATE majordhome.leads SET
      quote_sent_date = GREATEST(
        COALESCE(v_most_recent_date, v_current_quote_sent_date, CURRENT_DATE),
        COALESCE(v_current_quote_sent_date, CURRENT_DATE - INTERVAL '100 years')
      ),
      order_amount_ht = COALESCE(v_most_recent_amount, order_amount_ht),
      updated_at = now()
    WHERE id = p_lead_id;
  END IF;

  -- --------------------------------------------------------------------------
  -- Auto-gain immédiat : si un devis rattaché est DÉJÀ validé (accepted /
  -- invoiced), on gagne le lead tout de suite plutôt que d'attendre le cron
  -- pennylane-sync-quote-status (jusqu'à 15 min). Le cron reste le filet pour
  -- les devis validés APRÈS le rattachement (envoyé → validé plus tard).
  --
  -- Même sélection que pennylane_sync_ensure_winning_quotes : accepted le plus
  -- récent (tie-break pennylane_quote_id DESC, cf. gotcha Pennylane CLAUDE.md).
  --
  -- Fail-soft : un échec du gain ne doit pas annuler l'attache (le cron
  -- rattrapera au prochain passage) — mais on laisse un WARNING, pas un
  -- échec muet.
  -- --------------------------------------------------------------------------
  -- Garde : on ne pose un gagnant QUE s'il n'y en a pas déjà un — sémantique
  -- identique à pennylane_sync_ensure_winning_quotes, qui EXCLUT les leads
  -- ayant déjà un gagnant. Sans cette garde, rattacher un devis accepté à un
  -- lead DÉJÀ gagné réaffecterait le devis gagnant (et donc le montant du
  -- chantier, cf. getChantierAmount) — divergence avec le cron.
  IF NOT EXISTS (
    SELECT 1 FROM majordhome.lead_pennylane_quotes
    WHERE lead_id = p_lead_id
      AND org_id = p_org_id
      AND ejected_at IS NULL
      AND is_winning_quote = true
  ) THEN
    SELECT pennylane_quote_id INTO v_winning_pl_id
    FROM majordhome.lead_pennylane_quotes
    WHERE lead_id = p_lead_id
      AND org_id = p_org_id
      AND ejected_at IS NULL
      AND quote_status IN ('accepted', 'invoiced')
    ORDER BY pennylane_quote_id DESC
    LIMIT 1;

    IF v_winning_pl_id IS NOT NULL THEN
      BEGIN
        PERFORM public.lead_mark_won_with_quote(p_org_id, p_lead_id, v_winning_pl_id);
        v_status_changed := true;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'lead_attach_quotes_and_send: auto-win lead % ignore (%): %',
          p_lead_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'attached', v_attached_count,
    'lead_status_changed', v_status_changed,
    'new_status_id', CASE WHEN v_status_changed THEN v_devis_envoye_status_id ELSE NULL END,
    'won_immediately', (v_winning_pl_id IS NOT NULL),
    'results', v_results
  );
END
$fn$;
