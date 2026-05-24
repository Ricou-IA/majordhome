-- supabase/migrations/20260524_lead_attach_quotes_round_and_tiebreak.sql
-- Patch RPC lead_attach_quotes_and_send (PR 2)
-- ============================================================================
-- 2 fixes suite test rattachement Laure Gauthier :
--
-- 1. order_amount_ht arrondi à l'entier (ROUND) — le commercial avait saisi
--    4800 € en estimation, le devis le plus récent vaut 5094.07 €. Affichage
--    carte Kanban veut un entier (sans décimale).
--
-- 2. Tie-break du "devis le plus récent" sur pennylane_quote_id DESC au lieu
--    de amount_ht DESC. Pour des devis créés le même jour (cas Laure :
--    D-2026-04129 et D-2026-04130 datés 2026-04-23 tous les 2), c'est l'ID
--    interne Pennylane qui dicte la chronologie réelle (strictement incrémental).
--    Avant le fix : amount DESC choisissait 04129 (4174€) au lieu de 04130 (5094€).

CREATE OR REPLACE FUNCTION public.lead_attach_quotes_and_send(
  p_org_id uuid,
  p_lead_id uuid,
  p_quotes jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
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
  v_existing_id uuid;
  v_existing_lead_id uuid;
  v_new_id uuid;
  v_action text;
  v_attached_count int := 0;
  v_results jsonb := '[]'::jsonb;
  v_attached_labels text[] := ARRAY[]::text[];

  v_most_recent_date date;
  v_most_recent_amount numeric;
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
      'attached', 0, 'lead_status_changed', false,
      'new_status_id', NULL, 'results', '[]'::jsonb
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

  -- FIX 2 : Tri date DESC + tiebreak quote_pl_id DESC (ID interne PL = ordre
  -- de création strictement incrémental, plus fiable qu'assigned_at ou amount)
  SELECT
    (q->>'date')::date,
    (q->>'amount_ht')::numeric
    INTO v_most_recent_date, v_most_recent_amount
  FROM jsonb_array_elements(p_quotes) q
  ORDER BY
    (q->>'date')::date DESC NULLS LAST,
    (q->>'quote_pl_id')::bigint DESC NULLS LAST
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
          quote_status = COALESCE(v_quote_status, quote_status)
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
          quote_status = COALESCE(v_quote_status, quote_status)
        WHERE id = v_existing_id;
        v_action := 'moved';
      END IF;
    ELSE
      INSERT INTO majordhome.lead_pennylane_quotes (
        org_id, lead_id, pennylane_quote_id,
        pennylane_customer_id, pennylane_client_id,
        quote_amount_ht, quote_label, quote_date, quote_status
      ) VALUES (
        p_org_id, p_lead_id, v_quote_pl_id,
        v_quote_customer_id, v_target_client_id,
        v_quote_amount, v_quote_label, v_quote_date, v_quote_status
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
    FROM majordhome.statuses WHERE display_order = 4 LIMIT 1;

    IF v_devis_envoye_status_id IS NOT NULL THEN
      -- FIX 1 : ROUND order_amount_ht pour cohérence affichage carte Kanban
      UPDATE majordhome.leads SET
        status_id = v_devis_envoye_status_id,
        quote_sent_date = COALESCE(v_most_recent_date, v_current_quote_sent_date, CURRENT_DATE),
        order_amount_ht = COALESCE(ROUND(v_most_recent_amount)::numeric, order_amount_ht),
        updated_at = now()
      WHERE id = p_lead_id;

      INSERT INTO majordhome.lead_activities (
        lead_id, user_id, activity_type, description,
        old_status_id, new_status_id, metadata, org_id
      ) VALUES (
        p_lead_id, v_user, 'status_changed',
        'Statut : ' ||
          COALESCE((SELECT label FROM majordhome.statuses WHERE id = v_current_status_id), '?') ||
          ' → Devis envoyé (' || v_attached_count || ' devis Pennylane lié' ||
          CASE WHEN v_attached_count > 1 THEN 's' ELSE '' END ||
          CASE WHEN array_length(v_attached_labels, 1) > 0
            THEN ' : ' || array_to_string(v_attached_labels, ', ')
            ELSE '' END || ')',
        v_current_status_id, v_devis_envoye_status_id,
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
    -- FIX 1 : ROUND order_amount_ht (cas lead déjà en Devis envoyé)
    UPDATE majordhome.leads SET
      quote_sent_date = GREATEST(
        COALESCE(v_most_recent_date, v_current_quote_sent_date, CURRENT_DATE),
        COALESCE(v_current_quote_sent_date, CURRENT_DATE - INTERVAL '100 years')
      ),
      order_amount_ht = COALESCE(ROUND(v_most_recent_amount)::numeric, order_amount_ht),
      updated_at = now()
    WHERE id = p_lead_id;
  END IF;

  RETURN jsonb_build_object(
    'attached', v_attached_count,
    'lead_status_changed', v_status_changed,
    'new_status_id', CASE WHEN v_status_changed THEN v_devis_envoye_status_id ELSE NULL END,
    'results', v_results
  );
END
$function$;
