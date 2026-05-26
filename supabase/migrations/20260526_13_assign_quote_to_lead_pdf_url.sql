-- supabase/migrations/20260526_13_assign_quote_to_lead_pdf_url.sql
-- Étend assign_pennylane_quote_to_lead (single-attach utilisé par
-- LinkPennylaneQuoteModal chantier) pour persister pdf_url.
-- Symétrie avec lead_attach_quotes_and_send (multi-attach pipeline,
-- cf 20260526_11). COALESCE strict — un attach sans pdf_url ne vide pas
-- une valeur existante.
--
-- Diff vs version précédente : ajout de v_quote_pdf_url + pdf_url dans
-- INSERT et les 2 UPDATE (already_assigned + moved).

CREATE OR REPLACE FUNCTION public.assign_pennylane_quote_to_lead(
  p_org_id uuid,
  p_quote_pl_id bigint,
  p_target_lead_id uuid,
  p_quote_data jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_existing_id uuid;
  v_existing_lead_id uuid;
  v_target_client_id uuid;
  v_new_id uuid;
  v_action text;

  v_current_status_id uuid;
  v_current_display_order int;
  v_current_quote_sent_date date;

  v_devis_envoye_status_id uuid;
  v_quote_date date;
  v_quote_amount numeric;
  v_quote_pdf_url text;
  v_status_changed bool := false;

  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.org_id = p_org_id AND om.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Acces refuse';
  END IF;

  SELECT l.client_id, l.status_id, l.quote_sent_date, s.display_order
    INTO v_target_client_id, v_current_status_id, v_current_quote_sent_date, v_current_display_order
  FROM majordhome.leads l
  LEFT JOIN majordhome.statuses s ON s.id = l.status_id
  WHERE l.id = p_target_lead_id AND l.org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % not found in org %', p_target_lead_id, p_org_id;
  END IF;

  v_quote_date := (p_quote_data->>'date')::date;
  v_quote_amount := (p_quote_data->>'amount_ht')::numeric;
  v_quote_pdf_url := NULLIF(p_quote_data->>'pdf_url', '');

  SELECT id, lead_id INTO v_existing_id, v_existing_lead_id
  FROM majordhome.lead_pennylane_quotes
  WHERE org_id = p_org_id
    AND pennylane_quote_id = p_quote_pl_id
    AND ejected_at IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_lead_id = p_target_lead_id THEN
      IF p_quote_data IS NOT NULL THEN
        UPDATE majordhome.lead_pennylane_quotes SET
          pennylane_customer_id = COALESCE((p_quote_data->>'customer_id')::bigint, pennylane_customer_id),
          pennylane_client_id = COALESCE(pennylane_client_id, v_target_client_id),
          quote_amount_ht = COALESCE(v_quote_amount, quote_amount_ht),
          quote_label = COALESCE(p_quote_data->>'label', quote_label),
          quote_date = COALESCE(v_quote_date, quote_date),
          quote_status = COALESCE(p_quote_data->>'status', quote_status),
          pdf_url = COALESCE(v_quote_pdf_url, pdf_url)
        WHERE id = v_existing_id;
      END IF;
      v_action := 'already_assigned';
    ELSE
      UPDATE majordhome.lead_pennylane_quotes SET
        lead_id = p_target_lead_id,
        pennylane_client_id = COALESCE(pennylane_client_id, v_target_client_id),
        assigned_at = now(),
        pennylane_customer_id = COALESCE((p_quote_data->>'customer_id')::bigint, pennylane_customer_id),
        quote_amount_ht = COALESCE(v_quote_amount, quote_amount_ht),
        quote_label = COALESCE(p_quote_data->>'label', quote_label),
        quote_date = COALESCE(v_quote_date, quote_date),
        quote_status = COALESCE(p_quote_data->>'status', quote_status),
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
      p_org_id, p_target_lead_id, p_quote_pl_id,
      (p_quote_data->>'customer_id')::bigint,
      v_target_client_id,
      v_quote_amount,
      p_quote_data->>'label',
      v_quote_date,
      p_quote_data->>'status',
      v_quote_pdf_url
    ) RETURNING id INTO v_new_id;
    v_action := 'inserted';
  END IF;

  IF v_current_display_order IS NOT NULL AND v_current_display_order < 4 THEN
    SELECT id INTO v_devis_envoye_status_id
    FROM majordhome.statuses
    WHERE display_order = 4
    LIMIT 1;

    IF v_devis_envoye_status_id IS NOT NULL THEN
      UPDATE majordhome.leads SET
        status_id = v_devis_envoye_status_id,
        quote_sent_date = COALESCE(v_quote_date, v_current_quote_sent_date, CURRENT_DATE),
        order_amount_ht = COALESCE(v_quote_amount, order_amount_ht),
        updated_at = now()
      WHERE id = p_target_lead_id;

      INSERT INTO majordhome.lead_activities (
        lead_id, user_id, activity_type, description,
        old_status_id, new_status_id, metadata, org_id
      ) VALUES (
        p_target_lead_id,
        v_user,
        'status_changed',
        'Statut : ' ||
          COALESCE((SELECT label FROM majordhome.statuses WHERE id = v_current_status_id), '?') ||
          ' → Devis envoyé (devis Pennylane lié)',
        v_current_status_id,
        v_devis_envoye_status_id,
        jsonb_build_object(
          'source', 'pennylane_link',
          'pennylane_quote_id', p_quote_pl_id,
          'quote_amount_ht', v_quote_amount,
          'quote_date', v_quote_date
        ),
        p_org_id
      );

      v_status_changed := true;
    END IF;

  ELSIF v_current_display_order = 4 THEN
    UPDATE majordhome.leads SET
      quote_sent_date = GREATEST(
        COALESCE(v_quote_date, v_current_quote_sent_date, CURRENT_DATE),
        COALESCE(v_current_quote_sent_date, CURRENT_DATE - INTERVAL '100 years')
      ),
      order_amount_ht = COALESCE(v_quote_amount, order_amount_ht),
      updated_at = now()
    WHERE id = p_target_lead_id;
  END IF;

  RETURN jsonb_build_object(
    'action', v_action,
    'id', COALESCE(v_existing_id, v_new_id),
    'lead_id', p_target_lead_id,
    'lead_status_changed', v_status_changed,
    'new_status_id', CASE WHEN v_status_changed THEN v_devis_envoye_status_id ELSE NULL END,
    'previous_lead_id', CASE WHEN v_action = 'moved' THEN v_existing_lead_id ELSE NULL END
  );
END
$function$;
