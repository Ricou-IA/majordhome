-- supabase/migrations/20260930_12_chantiers_rpc.sql
-- ============================================================================
-- Entité chantier — création automatique et gestes (spec 2026-09-30-chantier-entite-par-devis).
--   - trigger chantier_ensure_for_quote : un devis qui DEVIENT validé sans chantier en crée un
--     (règle « chaque devis accepté = 1 chantier »). AFTER → voit le statut final posé par
--     l'invariant BEFORE ; déclenché aussi sur is_winning_quote (lead_mark_won_with_quote ne
--     SET que cette colonne, l'invariant force accepted). Transition seulement : les vieux
--     devis facturés sans chantier (RENOU…) ne créent rien, comme ensure_winning_quotes.
--   - chantier_ensure_for_lead : gain sans devis Pennylane (appel front updateLeadStatus).
--   - chantier_group / chantier_detach / chantier_delete : gestes humains, role_can chantiers.edit.
-- Toutes SECURITY DEFINER, auth.uid() NULL refusé, gardes POSITIVES, REVOKE PUBLIC/anon.
-- Répétée sur scripts/migration-rehearsal/ (assert-chantiers.sql §B).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Trigger : un devis validé sans chantier → un chantier
-- ----------------------------------------------------------------------------
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
          CASE WHEN NEW.quote_status = 'invoiced' THEN 'facture' ELSE 'gagne' END,
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

DROP TRIGGER IF EXISTS trg_chantier_ensure_for_quote ON majordhome.lead_pennylane_quotes;
CREATE TRIGGER trg_chantier_ensure_for_quote
  AFTER INSERT OR UPDATE OF quote_status, ejected_at, is_winning_quote ON majordhome.lead_pennylane_quotes
  FOR EACH ROW EXECUTE FUNCTION majordhome.chantier_ensure_for_quote();

-- ----------------------------------------------------------------------------
-- 2. Gain sans devis : un chantier pour le lead s'il n'en a aucun
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chantier_ensure_for_lead(p_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_lead majordhome.leads%ROWTYPE;
  v_id   uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_lead FROM majordhome.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;
  IF (EXISTS (SELECT 1 FROM core.organization_members om WHERE om.org_id = v_lead.org_id AND om.user_id = v_user)) IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_lead.is_deleted, false) THEN RAISE EXCEPTION 'lead_deleted' USING ERRCODE = '22023'; END IF;

  -- Deux appels concurrents (double clic, 2 onglets) ne doivent pas créer 2 chantiers pour le même lead.
  PERFORM pg_advisory_xact_lock(hashtext(p_lead_id::text));
  SELECT id INTO v_id FROM majordhome.chantiers WHERE lead_id = p_lead_id ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO majordhome.chantiers (org_id, lead_id, client_id, chantier_status, won_date, equipment_type_id)
  VALUES (v_lead.org_id, p_lead_id, v_lead.client_id, 'gagne', COALESCE(v_lead.won_date, current_date), v_lead.equipment_type_id)
  RETURNING id INTO v_id;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (p_lead_id, v_user, 'chantier_created', 'Chantier créé (gain sans devis Pennylane)',
          jsonb_build_object('chantier_id', v_id), v_lead.org_id);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chantier_ensure_for_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chantier_ensure_for_lead(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Helpers privés : rang de statut, état d'approvisionnement le moins avancé
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.chantier_status_rank(p_status text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
  SELECT CASE p_status
    WHEN 'gagne' THEN 1 WHEN 'commande_a_faire' THEN 2 WHEN 'commande_recue' THEN 3
    WHEN 'planification' THEN 4 WHEN 'realise' THEN 5 WHEN 'facture' THEN 6 ELSE 0 END;
$function$;

CREATE OR REPLACE FUNCTION majordhome.order_status_min(p_a text, p_b text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
  -- 'na' = non applicable (rien à commander), compté comme reçu par l'auto-transition du front.
  -- 'commande' (en attente) l'emporte sur tout ; sinon 'recu' s'il y en a un ; sinon 'na' ; NULL ignoré.
  SELECT CASE
    WHEN p_a IS NULL THEN p_b
    WHEN p_b IS NULL THEN p_a
    WHEN 'commande' IN (p_a, p_b) THEN 'commande'
    WHEN 'recu' IN (p_a, p_b) THEN 'recu'
    ELSE 'na' END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Grouper : les sources rejoignent la cible (même lead), puis disparaissent
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chantier_group(p_target_id uuid, p_source_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_t    majordhome.chantiers%ROWTYPE;
  v_s    majordhome.chantiers%ROWTYPE;
  v_sid  uuid;
  v_sources uuid[];
  v_validated bigint; v_invoiced bigint;
  n int; n_q int := 0; n_a int := 0; n_r int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_target_id IS NULL OR p_source_ids IS NULL OR cardinality(p_source_ids) = 0 OR p_target_id = ANY (p_source_ids) THEN
    RAISE EXCEPTION 'invalid_selection' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM majordhome.chantiers WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'chantier_not_found' USING ERRCODE = 'P0002'; END IF;
  IF majordhome.role_can(v_t.org_id, 'chantiers', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Doublons dans la sélection : un 2ᵉ tour trouverait la source déjà supprimée (faux chantier_not_found).
  SELECT array_agg(DISTINCT x) INTO v_sources FROM unnest(p_source_ids) AS x;

  FOREACH v_sid IN ARRAY v_sources LOOP
    SELECT * INTO v_s FROM majordhome.chantiers WHERE id = v_sid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'chantier_not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_s.lead_id <> v_t.lead_id OR v_s.org_id <> v_t.org_id THEN
      RAISE EXCEPTION 'different_lead' USING ERRCODE = '22023';
    END IF;

    UPDATE majordhome.lead_pennylane_quotes SET chantier_id = p_target_id WHERE chantier_id = v_sid;
    GET DIAGNOSTICS n = ROW_COUNT; n_q := n_q + n;
    UPDATE majordhome.appointments SET chantier_id = p_target_id WHERE chantier_id = v_sid;
    GET DIAGNOSTICS n = ROW_COUNT; n_a := n_a + n;
    UPDATE majordhome.chantier_line_receptions SET chantier_id = p_target_id WHERE chantier_id = v_sid;
    GET DIAGNOSTICS n = ROW_COUNT; n_r := n_r + n;

    -- Complément additif : la cible garde ses valeurs, ses vides sont repris de la source.
    v_t.label              := COALESCE(NULLIF(v_t.label, ''), NULLIF(v_s.label, ''));
    v_t.planned_team_size  := COALESCE(v_t.planned_team_size, v_s.planned_team_size);
    v_t.planned_days       := COALESCE(v_t.planned_days, v_s.planned_days);
    v_t.estimated_date     := COALESCE(v_t.estimated_date, v_s.estimated_date);
    v_t.equipment_type_id  := COALESCE(v_t.equipment_type_id, v_s.equipment_type_id);
    v_t.pv_reception_path  := COALESCE(v_t.pv_reception_path, v_s.pv_reception_path);
    v_t.planification_date := LEAST(v_t.planification_date, v_s.planification_date);
    v_t.won_date           := LEAST(v_t.won_date, v_s.won_date);
    v_t.equipment_order_status := majordhome.order_status_min(v_t.equipment_order_status, v_s.equipment_order_status);
    v_t.materials_order_status := majordhome.order_status_min(v_t.materials_order_status, v_s.materials_order_status);
    IF majordhome.chantier_status_rank(v_s.chantier_status) > majordhome.chantier_status_rank(v_t.chantier_status) THEN
      v_t.chantier_status := v_s.chantier_status;
    END IF;
    IF NULLIF(v_s.chantier_notes, '') IS NOT NULL THEN
      v_t.chantier_notes := concat_ws(E'\n', NULLIF(v_t.chantier_notes, ''),
        '— groupé depuis ' || COALESCE(NULLIF(v_s.label, ''), v_sid::text) || ' —', v_s.chantier_notes);
    END IF;

    DELETE FROM majordhome.chantiers WHERE id = v_sid;
  END LOOP;

  -- facture = tous les devis validés du groupe facturés ; sinon plafond realise (revue finale 2026-10-01).
  -- Les devis ont déjà été déplacés sur la cible : chantier_quote_stats reflète le groupe entier.
  IF v_t.chantier_status = 'facture' THEN
    SELECT validated_count, invoiced_count INTO v_validated, v_invoiced
      FROM majordhome.chantier_quote_stats WHERE chantier_id = p_target_id;
    IF COALESCE(v_validated, 0) = 0 OR COALESCE(v_invoiced, 0) < v_validated THEN
      v_t.chantier_status := 'realise';
    END IF;
  END IF;

  UPDATE majordhome.chantiers SET
    label = v_t.label, planned_team_size = v_t.planned_team_size, planned_days = v_t.planned_days,
    estimated_date = v_t.estimated_date, equipment_type_id = v_t.equipment_type_id,
    pv_reception_path = v_t.pv_reception_path, planification_date = v_t.planification_date,
    won_date = v_t.won_date, equipment_order_status = v_t.equipment_order_status,
    materials_order_status = v_t.materials_order_status, chantier_status = v_t.chantier_status,
    chantier_notes = v_t.chantier_notes
  WHERE id = p_target_id;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (v_t.lead_id, v_user, 'chantier_grouped',
          'Chantiers groupés : ' || cardinality(v_sources) || ' carte(s) réunie(s) (' || n_q || ' devis, ' || n_a || ' RDV)',
          jsonb_build_object('target_id', p_target_id, 'source_ids', to_jsonb(v_sources),
                             'counts', jsonb_build_object('quotes', n_q, 'appointments', n_a, 'line_receptions', n_r)),
          v_t.org_id);

  RETURN jsonb_build_object('target_id', p_target_id,
    'counts', jsonb_build_object('quotes', n_q, 'appointments', n_a, 'line_receptions', n_r));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chantier_group(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chantier_group(uuid, uuid[]) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Détacher : des devis (+ RDV, + commande) partent dans un nouveau chantier
-- ----------------------------------------------------------------------------
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
  v_status := CASE WHEN v_all_invoiced THEN 'facture'
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
REVOKE EXECUTE ON FUNCTION public.chantier_detach(uuid, uuid[], uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chantier_detach(uuid, uuid[], uuid[], boolean, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Supprimer un chantier vide (aucun devis validé, aucun RDV actif, pas de PV)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chantier_delete(p_chantier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_c    majordhome.chantiers%ROWTYPE;
  n_q int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_c FROM majordhome.chantiers WHERE id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'chantier_not_found' USING ERRCODE = 'P0002'; END IF;
  IF majordhome.role_can(v_c.org_id, 'chantiers', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.lead_pennylane_quotes WHERE chantier_id = p_chantier_id AND ejected_at IS NULL
              AND majordhome.quote_status_bucket(quote_status) = 'validated') THEN
    RAISE EXCEPTION 'has_validated_quotes' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.appointments WHERE chantier_id = p_chantier_id
              AND COALESCE(status, '') <> ALL (ARRAY['cancelled', 'no_show'])) THEN
    RAISE EXCEPTION 'has_appointments' USING ERRCODE = '22023';
  END IF;
  IF v_c.pv_reception_path IS NOT NULL THEN RAISE EXCEPTION 'has_pv' USING ERRCODE = '22023'; END IF;

  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = NULL WHERE chantier_id = p_chantier_id;
  GET DIAGNOSTICS n_q = ROW_COUNT;
  DELETE FROM majordhome.chantiers WHERE id = p_chantier_id;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (v_c.lead_id, v_user, 'chantier_deleted',
          'Chantier supprimé « ' || COALESCE(v_c.label, v_c.id::text) || ' » (' || n_q || ' devis non validés libérés)',
          jsonb_build_object('chantier_id', p_chantier_id, 'snapshot', to_jsonb(v_c)), v_c.org_id);

  RETURN jsonb_build_object('deleted_id', p_chantier_id, 'quotes_released', n_q);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chantier_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chantier_delete(uuid) TO authenticated;
