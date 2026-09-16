-- ============================================================================
-- 20260916_2 — RPC public.lead_merge(p_survivor_id, p_absorbed_id)
-- ============================================================================
--
-- Fusion ADDITIVE de deux leads du même org (org_admin only, god-mode, même
-- posture que lead_hard_delete). Décision Eric 2026-09-16 : « fusionner les
-- leads identiques — attention pas de régression : addition des infos ».
--
-- Règles :
--   1. Tout ce qui pointe sur l'absorbé est RE-PARENTÉ sur le survivant
--      (RDV, interventions, devis PL + révisions, activités, interactions,
--      mailings, appels, VT, dossiers PV, simulations, devis MDH, études
--      thermiques, mémos vocaux, commandes webshop, réceptions chantier).
--   2. Le survivant garde ses valeurs ; ses champs VIDES sont complétés depuis
--      l'absorbé. Notes concaténées avec marqueur [fusion]. Compteurs additionnés.
--   3. Statut : Gagné l'emporte ; sinon un statut actif l'emporte sur un
--      terminal ; sinon le plus avancé des deux actifs ; sinon celui du survivant.
--      Le placement Kanban reste piloté par la vue majordhome_kanban_cards
--      (devis PL), on ne ré-évalue rien ici.
--   4. L'absorbé passe en soft delete (is_deleted=true) : réversible, aucune
--      cascade. Instantané complet dans une activité `lead_merged` du survivant.
--
-- Sécurité : SECURITY DEFINER, auth.uid() NULL refusé en première ligne, garde
-- POSITIVE org_admin, REVOKE PUBLIC/anon, GRANT authenticated (appel front).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lead_merge(p_survivor_id uuid, p_absorbed_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_s majordhome.leads%ROWTYPE;
  v_a majordhome.leads%ROWTYPE;
  v_s_order int; v_s_final boolean; v_s_won boolean;
  v_a_order int; v_a_final boolean; v_a_won boolean;
  v_new_status uuid;
  v_counts jsonb;
  v_absorbed_label text;
  v_new_phone_secondary text;
  v_new_external_data jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_survivor_id IS NULL OR p_absorbed_id IS NULL OR p_survivor_id = p_absorbed_id THEN
    RAISE EXCEPTION 'invalid_pair' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_s FROM majordhome.leads WHERE id = p_survivor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_a FROM majordhome.leads WHERE id = p_absorbed_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;

  IF v_s.org_id <> v_a.org_id THEN
    RAISE EXCEPTION 'cross_org' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_s.is_deleted, false) OR COALESCE(v_a.is_deleted, false) THEN
    RAISE EXCEPTION 'lead_deleted' USING ERRCODE = 'P0002';
  END IF;

  -- Garde POSITIVE org_admin (jamais « IF NOT … » : NULL ouvrirait la porte)
  SELECT role INTO v_role
  FROM core.organization_members
  WHERE org_id = v_s.org_id AND user_id = v_user
  LIMIT 1;
  IF (v_role = 'org_admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;

  -- ============== Décomptes (avant re-parentage) ==============
  v_counts := jsonb_build_object(
    'appointments',       (SELECT count(*) FROM majordhome.appointments          WHERE lead_id = p_absorbed_id),
    'interventions',      (SELECT count(*) FROM majordhome.interventions         WHERE lead_id = p_absorbed_id),
    'pennylane_quotes',   (SELECT count(*) FROM majordhome.lead_pennylane_quotes WHERE lead_id = p_absorbed_id AND ejected_at IS NULL),
    'quote_revisions',    (SELECT count(*) FROM majordhome.lead_quote_revisions  WHERE lead_id = p_absorbed_id),
    'activities',         (SELECT count(*) FROM majordhome.lead_activities       WHERE lead_id = p_absorbed_id),
    'interactions',       (SELECT count(*) FROM majordhome.lead_interactions     WHERE lead_id = p_absorbed_id),
    'mailing_logs',       (SELECT count(*) FROM majordhome.mailing_logs          WHERE lead_id = p_absorbed_id),
    'call_attempts',      (SELECT count(*) FROM majordhome.call_attempts         WHERE lead_id = p_absorbed_id),
    'technical_visits',   (SELECT count(*) FROM majordhome.technical_visits      WHERE lead_id = p_absorbed_id),
    'pv_dossiers',        (SELECT count(*) FROM majordhome.pv_dossiers           WHERE lead_id = p_absorbed_id),
    'pv_simulations',     (SELECT count(*) FROM majordhome.pv_simulations        WHERE lead_id = p_absorbed_id),
    'quotes_mdh',         (SELECT count(*) FROM majordhome.quotes                WHERE lead_id = p_absorbed_id),
    'thermal_studies',    (SELECT count(*) FROM majordhome.thermal_studies       WHERE lead_id = p_absorbed_id),
    'voice_memos',        (SELECT count(*) FROM majordhome.voice_memos           WHERE lead_id = p_absorbed_id),
    'webshop_orders',     (SELECT count(*) FROM majordhome.webshop_orders        WHERE lead_id = p_absorbed_id),
    'line_receptions',    (SELECT count(*) FROM majordhome.chantier_line_receptions WHERE chantier_id = p_absorbed_id)
  );

  -- ============== Statut résultant ==============
  SELECT s.display_order, COALESCE(s.is_final, false), COALESCE(s.is_won, false)
    INTO v_s_order, v_s_final, v_s_won
  FROM majordhome.statuses s WHERE s.id = v_s.status_id;
  SELECT s.display_order, COALESCE(s.is_final, false), COALESCE(s.is_won, false)
    INTO v_a_order, v_a_final, v_a_won
  FROM majordhome.statuses s WHERE s.id = v_a.status_id;

  v_new_status := v_s.status_id;
  IF v_a.status_id IS NOT NULL THEN
    IF v_s.status_id IS NULL THEN
      v_new_status := v_a.status_id;
    ELSIF COALESCE(v_a_won, false) THEN
      v_new_status := v_a.status_id;                       -- Gagné l'emporte
    ELSIF COALESCE(v_s_won, false) THEN
      v_new_status := v_s.status_id;
    ELSIF COALESCE(v_s_final, false) AND NOT COALESCE(v_a_final, false) THEN
      v_new_status := v_a.status_id;                       -- un projet vivant l'emporte sur un Perdu
    ELSIF NOT COALESCE(v_s_final, false) AND NOT COALESCE(v_a_final, false)
          AND COALESCE(v_a_order, 0) > COALESCE(v_s_order, 0) THEN
      v_new_status := v_a.status_id;                       -- le plus avancé des deux actifs
    END IF;
  END IF;

  -- ============== Re-parentage (tout ce qui pointe sur l'absorbé) ==============
  UPDATE majordhome.appointments          SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.interventions         SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  -- Unicité (org, devis) parmi les non-éjectés : un devis n'est attaché qu'à UN
  -- lead, donc aucun conflit possible au re-parentage.
  UPDATE majordhome.lead_pennylane_quotes SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.lead_quote_revisions  SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.lead_activities       SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.lead_interactions     SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.mailing_logs          SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.call_attempts         SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.technical_visits      SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.pv_dossiers           SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.pv_simulations        SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.quotes                SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.thermal_studies       SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.voice_memos           SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.webshop_orders        SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
  UPDATE majordhome.chantier_line_receptions SET chantier_id = p_survivor_id WHERE chantier_id = p_absorbed_id;

  -- ============== Complément additif du survivant ==============
  -- phone_secondary : le téléphone de l'absorbé s'il diffère du principal retenu
  v_new_phone_secondary := COALESCE(NULLIF(TRIM(v_s.phone_secondary), ''),
    CASE
      WHEN NULLIF(TRIM(v_a.phone), '') IS NOT NULL
       AND regexp_replace(v_a.phone, '[^0-9]', '', 'g')
           <> regexp_replace(COALESCE(NULLIF(TRIM(v_s.phone), ''), v_a.phone, ''), '[^0-9]', '', 'g')
      THEN v_a.phone
      ELSE NULLIF(TRIM(v_a.phone_secondary), '')
    END);

  -- external_data : union, le survivant l'emporte sur les clés communes
  v_new_external_data := CASE
    WHEN v_s.external_data IS NULL AND v_a.external_data IS NULL THEN NULL
    ELSE COALESCE(v_a.external_data, '{}'::jsonb) || COALESCE(v_s.external_data, '{}'::jsonb)
  END;

  UPDATE majordhome.leads SET
    first_name         = COALESCE(NULLIF(TRIM(first_name), ''), NULLIF(TRIM(v_a.first_name), '')),
    last_name          = COALESCE(NULLIF(TRIM(last_name), ''),  NULLIF(TRIM(v_a.last_name), '')),
    company_name       = COALESCE(NULLIF(TRIM(company_name), ''), NULLIF(TRIM(v_a.company_name), '')),
    email              = COALESCE(NULLIF(TRIM(email), ''), NULLIF(TRIM(v_a.email), '')),
    phone              = COALESCE(NULLIF(TRIM(phone), ''), NULLIF(TRIM(v_a.phone), '')),
    phone_secondary    = v_new_phone_secondary,
    address            = COALESCE(NULLIF(TRIM(address), ''), NULLIF(TRIM(v_a.address), '')),
    address_complement = COALESCE(NULLIF(TRIM(address_complement), ''), NULLIF(TRIM(v_a.address_complement), '')),
    postal_code        = COALESCE(NULLIF(TRIM(postal_code), ''), NULLIF(TRIM(v_a.postal_code), '')),
    city               = COALESCE(NULLIF(TRIM(city), ''), NULLIF(TRIM(v_a.city), '')),
    source_id          = COALESCE(source_id, v_a.source_id),
    status_id          = v_new_status,
    status_changed_at  = CASE WHEN v_new_status IS DISTINCT FROM v_s.status_id THEN now() ELSE status_changed_at END,
    assigned_user_id   = COALESCE(assigned_user_id, v_a.assigned_user_id),
    project_id         = COALESCE(project_id, v_a.project_id),
    client_id          = COALESCE(client_id, v_a.client_id),
    appointment_id     = COALESCE(appointment_id, v_a.appointment_id),
    equipment_type_id  = COALESCE(equipment_type_id, v_a.equipment_type_id),
    order_amount_ht    = COALESCE(order_amount_ht, v_a.order_amount_ht),
    estimated_revenue  = COALESCE(estimated_revenue, v_a.estimated_revenue),
    probability        = COALESCE(probability, v_a.probability),
    notes = CASE
      WHEN NULLIF(TRIM(v_s.notes), '') IS NULL THEN v_a.notes
      WHEN NULLIF(TRIM(v_a.notes), '') IS NULL THEN v_s.notes
      WHEN v_s.notes = v_a.notes THEN v_s.notes
      ELSE v_s.notes || E'\n\n[fusion ' || to_char(now(), 'DD/MM/YYYY') || ']\n' || v_a.notes
    END,
    chantier_notes = CASE
      WHEN NULLIF(TRIM(v_s.chantier_notes), '') IS NULL THEN v_a.chantier_notes
      WHEN NULLIF(TRIM(v_a.chantier_notes), '') IS NULL THEN v_s.chantier_notes
      WHEN v_s.chantier_notes = v_a.chantier_notes THEN v_s.chantier_notes
      ELSE v_s.chantier_notes || E'\n\n[fusion ' || to_char(now(), 'DD/MM/YYYY') || ']\n' || v_a.chantier_notes
    END,
    long_term_notes = CASE
      WHEN NULLIF(TRIM(v_s.long_term_notes), '') IS NULL THEN v_a.long_term_notes
      WHEN NULLIF(TRIM(v_a.long_term_notes), '') IS NULL THEN v_s.long_term_notes
      WHEN v_s.long_term_notes = v_a.long_term_notes THEN v_s.long_term_notes
      ELSE v_s.long_term_notes || E'\n\n[fusion ' || to_char(now(), 'DD/MM/YYYY') || ']\n' || v_a.long_term_notes
    END,
    next_action        = COALESCE(NULLIF(TRIM(next_action), ''), NULLIF(TRIM(v_a.next_action), '')),
    next_action_date   = COALESCE(next_action_date, v_a.next_action_date),
    created_date       = LEAST(COALESCE(created_date, v_a.created_date), COALESCE(v_a.created_date, created_date)),
    converted_date     = COALESCE(converted_date, v_a.converted_date),
    appointment_date   = COALESCE(appointment_date, v_a.appointment_date),
    quote_sent_date    = LEAST(COALESCE(quote_sent_date, v_a.quote_sent_date), COALESCE(v_a.quote_sent_date, quote_sent_date)),
    won_date           = COALESCE(won_date, v_a.won_date),
    estimated_date     = COALESCE(estimated_date, v_a.estimated_date),
    lost_reason        = COALESCE(NULLIF(TRIM(lost_reason), ''), NULLIF(TRIM(v_a.lost_reason), '')),
    external_id        = COALESCE(external_id, v_a.external_id),
    external_source    = COALESCE(external_source, v_a.external_source),
    external_data      = v_new_external_data,
    chantier_status         = COALESCE(chantier_status, v_a.chantier_status),
    equipment_order_status  = COALESCE(equipment_order_status, v_a.equipment_order_status),
    materials_order_status  = COALESCE(materials_order_status, v_a.materials_order_status),
    planification_date      = COALESCE(planification_date, v_a.planification_date),
    pv_reception_path       = COALESCE(pv_reception_path, v_a.pv_reception_path),
    call_count         = COALESCE(call_count, 0) + COALESCE(v_a.call_count, 0),
    last_call_date     = GREATEST(COALESCE(last_call_date, v_a.last_call_date), COALESCE(v_a.last_call_date, last_call_date)),
    last_call_result   = COALESCE(last_call_result, v_a.last_call_result),
    followup_count     = COALESCE(followup_count, 0) + COALESCE(v_a.followup_count, 0),
    last_followup_date = GREATEST(COALESCE(last_followup_date, v_a.last_followup_date), COALESCE(v_a.last_followup_date, last_followup_date)),
    email_sent         = COALESCE(email_sent, false) OR COALESCE(v_a.email_sent, false),
    email_unsubscribed_at    = COALESCE(email_unsubscribed_at, v_a.email_unsubscribed_at),
    email_unsubscribe_reason = COALESCE(email_unsubscribe_reason, v_a.email_unsubscribe_reason),
    is_long_term_project  = COALESCE(is_long_term_project, false) OR COALESCE(v_a.is_long_term_project, false),
    long_term_started_at  = COALESCE(long_term_started_at, v_a.long_term_started_at),
    latitude           = COALESCE(latitude, v_a.latitude),
    longitude          = COALESCE(longitude, v_a.longitude),
    geocoded_at        = COALESCE(geocoded_at, v_a.geocoded_at),
    zone               = COALESCE(zone, v_a.zone),
    pennylane_quote_id = COALESCE(pennylane_quote_id, v_a.pennylane_quote_id),
    updated_at         = now()
  WHERE id = p_survivor_id;

  -- ============== Absorbé : soft delete, trace lisible ==============
  UPDATE majordhome.leads SET
    is_deleted = true,
    notes = COALESCE(notes, '') || E'\n\n[fusionné dans le lead ' || p_survivor_id::text || ' le ' || to_char(now(), 'DD/MM/YYYY') || ']',
    updated_at = now()
  WHERE id = p_absorbed_id;

  -- ============== Activité + instantané complet (réversibilité) ==============
  v_absorbed_label := NULLIF(TRIM(COALESCE(v_a.last_name, '') || ' ' || COALESCE(v_a.first_name, '')), '');
  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (
    p_survivor_id, v_user, 'lead_merged',
    'Fusion : lead « ' || COALESCE(v_absorbed_label, p_absorbed_id::text) || ' » absorbé ('
      || (v_counts->>'pennylane_quotes') || ' devis, '
      || (v_counts->>'appointments') || ' RDV, '
      || (v_counts->>'activities') || ' activités transférés)',
    jsonb_build_object(
      'absorbed_lead_id', p_absorbed_id,
      'absorbed_snapshot', to_jsonb(v_a),
      'survivor_before', to_jsonb(v_s),
      'counts', v_counts
    ),
    v_s.org_id
  );

  RETURN jsonb_build_object(
    'survivor_id', p_survivor_id,
    'absorbed_id', p_absorbed_id,
    'status_id', v_new_status,
    'counts', v_counts
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.lead_merge(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_merge(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.lead_merge(uuid, uuid) IS
  'Fusion additive de deux leads (org_admin) : re-parente tout ce qui pointe sur l''absorbé, complète les champs vides du survivant, soft delete l''absorbé avec instantané dans une activité lead_merged (2026-09-16).';
