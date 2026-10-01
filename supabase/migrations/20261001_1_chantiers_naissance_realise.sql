-- supabase/migrations/20261001_1_chantiers_naissance_realise.sql
-- ============================================================================
-- Décision Eric 2026-10-01 : un chantier né d'un devis DÉJÀ facturé (trigger chantier_ensure_for_quote)
-- ou détaché avec uniquement des devis facturés (chantier_detach) naît en « Réceptionné » (realise),
-- plus en « Facturé » : la colonne Facturé est masquée du kanban, les deux cartes VEOLIA détachées
-- le 2026-10-01 étaient invisibles. Le passage en Facturé reste un geste humain depuis la modale.
-- Corps des deux fonctions identiques à 20260930_17 hors cette ligne. Les deux cartes VEOLIA
-- déjà nées en facture sont réalignées. Répétée sur scripts/migration-rehearsal/ (assert-chantiers §B).
-- ============================================================================

CREATE OR REPLACE FUNCTION majordhome.chantier_ensure_for_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_lead  majordhome.leads%ROWTYPE;
  v_label text;
  v_id    uuid;
BEGIN
  IF NEW.ejected_at IS NOT NULL OR NEW.chantier_id IS NOT NULL THEN RETURN NULL; END IF;
  IF majordhome.quote_status_bucket(NEW.quote_status) <> 'validated' THEN RETURN NULL; END IF;
  -- Transition réelle uniquement (un UPDATE qui laisse le devis validé ne crée rien).
  IF TG_OP = 'UPDATE' AND OLD.ejected_at IS NULL
     AND majordhome.quote_status_bucket(OLD.quote_status) = 'validated' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_lead FROM majordhome.leads WHERE id = NEW.lead_id;
  IF NOT FOUND OR COALESCE(v_lead.is_deleted, false) THEN RETURN NULL; END IF;

  SELECT NULLIF(trim(pq.pdf_invoice_subject), '') INTO v_label
    FROM majordhome.pennylane_quotes pq
   WHERE pq.org_id = NEW.org_id AND pq.pennylane_quote_id = NEW.pennylane_quote_id;

  INSERT INTO majordhome.chantiers (org_id, lead_id, client_id, label, chantier_status, won_date, equipment_type_id)
  VALUES (NEW.org_id, NEW.lead_id, v_lead.client_id, v_label,
          CASE WHEN NEW.quote_status = 'invoiced' THEN 'realise' ELSE 'gagne' END,
          COALESCE(NEW.quote_date, current_date), v_lead.equipment_type_id)
  RETURNING id INTO v_id;

  -- chantier_id n'est pas dans la liste UPDATE OF du trigger : pas de récursion.
  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = v_id WHERE id = NEW.id;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (NEW.lead_id, auth.uid(), 'chantier_created',
          'Chantier créé pour le devis ' || COALESCE(NEW.quote_label, NEW.pennylane_quote_id::text),
          jsonb_build_object('chantier_id', v_id, 'lead_quote_id', NEW.id, 'pennylane_quote_id', NEW.pennylane_quote_id),
          NEW.org_id);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chantier_detach(
  p_chantier_id uuid, p_quote_ids uuid[], p_appointment_ids uuid[], p_move_planned_order boolean, p_label text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user   uuid := auth.uid();
  v_c      majordhome.chantiers%ROWTYPE;
  v_appts  uuid[] := COALESCE(p_appointment_ids, '{}'::uuid[]);
  v_quotes uuid[];
  v_new    uuid;
  v_label  text;
  v_won    date;
  v_all_invoiced boolean;
  v_status text;
  n int; n_q int; n_a int; n_r int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_chantier_id IS NULL OR p_quote_ids IS NULL THEN
    RAISE EXCEPTION 'invalid_selection' USING ERRCODE = '22023';
  END IF;
  -- Doublons dans la sélection : le compte de validation serait faux (invalid_quotes à tort).
  SELECT array_agg(DISTINCT x) INTO v_quotes FROM unnest(p_quote_ids) AS x;
  IF v_quotes IS NULL OR cardinality(v_quotes) = 0 THEN
    RAISE EXCEPTION 'invalid_selection' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_c FROM majordhome.chantiers WHERE id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'chantier_not_found' USING ERRCODE = 'P0002'; END IF;
  IF majordhome.role_can(v_c.org_id, 'chantiers', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Validations
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes
   WHERE id = ANY (v_quotes) AND chantier_id = p_chantier_id AND ejected_at IS NULL;
  IF n <> cardinality(v_quotes) THEN RAISE EXCEPTION 'invalid_quotes' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes
   WHERE id = ANY (v_quotes) AND majordhome.quote_status_bucket(quote_status) = 'validated';
  IF n = 0 THEN RAISE EXCEPTION 'no_validated_quote_selected' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes
   WHERE chantier_id = p_chantier_id AND ejected_at IS NULL AND id <> ALL (v_quotes)
     AND majordhome.quote_status_bucket(quote_status) = 'validated';
  IF n = 0 THEN RAISE EXCEPTION 'origin_would_be_empty' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments
   WHERE id = ANY (v_appts) AND chantier_id = p_chantier_id AND appointment_type = 'installation'
     AND COALESCE(status, '') <> ALL (ARRAY['cancelled', 'no_show']);
  IF n <> cardinality(v_appts) THEN RAISE EXCEPTION 'invalid_appointments' USING ERRCODE = '22023'; END IF;

  -- Libellé, date de gain, statut du nouveau chantier
  SELECT NULLIF(trim(pq.pdf_invoice_subject), ''), q.quote_date INTO v_label, v_won
    FROM majordhome.lead_pennylane_quotes q
    LEFT JOIN majordhome.pennylane_quotes pq ON pq.org_id = q.org_id AND pq.pennylane_quote_id = q.pennylane_quote_id
   WHERE q.id = ANY (v_quotes) AND majordhome.quote_status_bucket(q.quote_status) = 'validated'
   ORDER BY q.pennylane_quote_id DESC LIMIT 1;
  v_label := COALESCE(NULLIF(trim(p_label), ''), v_label);
  SELECT bool_and(quote_status = 'invoiced') INTO v_all_invoiced
    FROM majordhome.lead_pennylane_quotes
   WHERE id = ANY (v_quotes) AND majordhome.quote_status_bucket(quote_status) = 'validated';
  v_status := CASE WHEN v_all_invoiced THEN 'realise'
                   WHEN cardinality(v_appts) > 0 THEN 'planification'
                   ELSE 'gagne' END;

  INSERT INTO majordhome.chantiers (org_id, lead_id, client_id, label, chantier_status, planification_date, won_date,
                                    equipment_type_id, planned_team_size, planned_days)
  VALUES (v_c.org_id, v_c.lead_id, v_c.client_id, v_label, v_status,
          CASE WHEN v_status = 'planification' THEN current_date END,
          COALESCE(v_won, current_date), v_c.equipment_type_id,
          CASE WHEN p_move_planned_order THEN v_c.planned_team_size END,
          CASE WHEN p_move_planned_order THEN v_c.planned_days END)
  RETURNING id INTO v_new;

  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = v_new WHERE id = ANY (v_quotes);
  GET DIAGNOSTICS n_q = ROW_COUNT;
  UPDATE majordhome.chantier_line_receptions SET chantier_id = v_new
   WHERE chantier_id = p_chantier_id
     AND pennylane_quote_id IN (SELECT pennylane_quote_id FROM majordhome.lead_pennylane_quotes WHERE id = ANY (v_quotes));
  GET DIAGNOSTICS n_r = ROW_COUNT;
  UPDATE majordhome.appointments SET chantier_id = v_new WHERE id = ANY (v_appts);
  GET DIAGNOSTICS n_a = ROW_COUNT;
  IF p_move_planned_order THEN
    UPDATE majordhome.chantiers SET planned_team_size = NULL, planned_days = NULL WHERE id = p_chantier_id;
  END IF;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (v_c.lead_id, v_user, 'chantier_detached',
          'Chantier détaché : ' || n_q || ' devis, ' || n_a || ' RDV vers « ' || COALESCE(v_label, 'nouveau chantier') || ' »',
          jsonb_build_object('origin_chantier_id', p_chantier_id, 'new_chantier_id', v_new,
                             'quote_ids', to_jsonb(v_quotes), 'appointment_ids', to_jsonb(v_appts),
                             'moved_planned_order', p_move_planned_order),
          v_c.org_id);

  RETURN jsonb_build_object('new_chantier_id', v_new, 'origin_chantier_id', p_chantier_id,
    'counts', jsonb_build_object('quotes', n_q, 'appointments', n_a, 'line_receptions', n_r));
END;
$function$;

-- Les deux chantiers détachés le 2026-10-01 avant ce changement (VEOLIA ENERGIE / VEOLIA ENVIRONNEMENT).
UPDATE majordhome.chantiers SET chantier_status = 'realise'
 WHERE chantier_status = 'facture' AND id IN ('df7350dd-ef07-46f4-871f-29d20c4635a2', '3927f0b1-8541-4e6d-b97e-243fac35d9b4');
