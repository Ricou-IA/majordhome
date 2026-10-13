-- ============================================================================
-- 20261013_2_webshop_tournees.sql — pilotage des tournées de livraison palettes
-- depuis Majord'home (onglet Webshop → Tournées).
--
-- Le moteur (secteurs, créneaux, réservation au paiement, fermeture J-2, feuille de
-- route PDF) vit côté site (dépôt Landing Page - Mayer). Cette migration n'y touche
-- pas : elle ajoute les gestes d'Eric, en RPC SECURITY DEFINER (team_leader+ de l'org
-- de la tournée, garde positive, auth.uid() NULL refusé) :
--   - webshop_slot_set_status : fermer / rouvrir ;
--   - webshop_slot_cancel     : annuler (commandes détachées → « à planifier ») ;
--   - webshop_order_move_slot : déplacer / planifier une commande dans une tournée
--                               du même secteur, capacités respectées ;
--   - webshop_slot_send_now   : envoyer la feuille au transporteur maintenant. La route
--     du site envoie TOUTE tournée `closed` dont route_sheet_sent_at est NULL : on ferme,
--     on remet la date d'envoi à NULL (renvoi possible) et on appelle la route via pg_net
--     avec le secret Vault `webshop_cron_secret` — jamais exposé au front ;
--   - webshop_slot_send_result : lit la réponse HTTP de cet appel (échec visible).
-- Remplissage = recalcul depuis les commandes (majordhome.webshop_slot_recount), même
-- règle que webshop_apply_paid_order : commandes payées non annulées, un arrêt par
-- adresse normalisée.
-- ============================================================================

-- 1. Colonnes de suivi (en fin de table ; le site lit des listes de colonnes explicites)
ALTER TABLE majordhome.webshop_delivery_slots
  ADD COLUMN IF NOT EXISTS status_note text,
  ADD COLUMN IF NOT EXISTS route_sheet_request_id bigint,
  ADD COLUMN IF NOT EXISTS route_sheet_requested_at timestamptz;

COMMENT ON COLUMN majordhome.webshop_delivery_slots.status_note IS
  'Motif saisi dans Majord''home à la fermeture / annulation manuelle (jour férié, transporteur indisponible…).';
COMMENT ON COLUMN majordhome.webshop_delivery_slots.route_sheet_request_id IS
  'Id pg_net (net._http_response) du dernier envoi manuel de la feuille de route.';

-- Vue miroir : nouvelles colonnes en fin de liste (CREATE OR REPLACE n'autorise que l'ajout final)
CREATE OR REPLACE VIEW public.majordhome_webshop_delivery_slots WITH (security_invoker = true) AS
SELECT id, org_id, sector_id, delivery_date, status, capacity_slots, capacity_stops, used_slots, used_stops,
       closed_at, close_reason, route_sheet_sent_at, km_estimated, km_actual, created_at, updated_at,
       status_note, route_sheet_request_id, route_sheet_requested_at
  FROM majordhome.webshop_delivery_slots;

-- ============================================================================
-- 2. Garde commune : team_leader+ de l'org de la tournée. Renvoie la tournée verrouillée.
-- ============================================================================
CREATE OR REPLACE FUNCTION majordhome.webshop_slot_guard(p_slot_id uuid)
RETURNS majordhome.webshop_delivery_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_slot majordhome.webshop_delivery_slots;
  v_role text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_slot FROM majordhome.webshop_delivery_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'slot_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT role INTO v_role FROM core.organization_members
   WHERE org_id = v_slot.org_id AND user_id = v_user;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_leader_required' USING ERRCODE = '42501';
  END IF;
  RETURN v_slot;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_slot_guard(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. Recalcul du remplissage + fermeture / réouverture automatique « capacité »
--    (miroir de webshop_apply_paid_order). Une fermeture manuelle ou J-2 n'est jamais
--    rouverte ici.
-- ============================================================================
CREATE OR REPLACE FUNCTION majordhome.webshop_slot_recount(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  UPDATE majordhome.webshop_delivery_slots s
     SET used_slots = x.sl, used_stops = x.st, updated_at = now()
    FROM (
      SELECT COALESCE(sum(o.pallet_slots), 0)::int AS sl,
             count(DISTINCT COALESCE(o.normalized_address, lower(o.address), o.id::text))::int AS st
        FROM majordhome.webshop_orders o
       WHERE o.delivery_slot_id = p_slot_id AND o.paid_at IS NOT NULL AND o.status <> 'annulee'
    ) x
   WHERE s.id = p_slot_id;

  -- Pleine → fermée (comme au paiement)
  UPDATE majordhome.webshop_delivery_slots
     SET status = 'closed', closed_at = now(), updated_at = now(),
         close_reason = CASE WHEN used_slots >= capacity_slots THEN 'capacity' ELSE 'stops' END
   WHERE id = p_slot_id AND status = 'open'
     AND (used_slots >= capacity_slots OR used_stops >= capacity_stops);

  -- Fermée pour capacité et de nouveau de la place, feuille pas encore partie → rouverte
  UPDATE majordhome.webshop_delivery_slots
     SET status = 'open', closed_at = NULL, close_reason = NULL, updated_at = now()
   WHERE id = p_slot_id AND status = 'closed' AND close_reason IN ('capacity', 'stops')
     AND route_sheet_sent_at IS NULL
     AND delivery_date >= v_today + 2
     AND used_slots < capacity_slots AND used_stops < capacity_stops;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_slot_recount(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 4. Fermer / rouvrir
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_slot_set_status(p_slot_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_slot majordhome.webshop_delivery_slots;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  v_slot := majordhome.webshop_slot_guard(p_slot_id);

  IF p_status = 'closed' THEN
    IF v_slot.status <> 'open' THEN RAISE EXCEPTION 'slot_not_open' USING ERRCODE = '22023', DETAIL = v_slot.status; END IF;
    UPDATE majordhome.webshop_delivery_slots
       SET status = 'closed', closed_at = now(), close_reason = 'manual',
           status_note = NULLIF(btrim(p_note), ''), updated_at = now()
     WHERE id = p_slot_id;
  ELSIF p_status = 'open' THEN
    IF v_slot.status NOT IN ('closed', 'cancelled') THEN RAISE EXCEPTION 'slot_not_reopenable' USING ERRCODE = '22023', DETAIL = v_slot.status; END IF;
    IF v_slot.delivery_date < v_today + 2 THEN RAISE EXCEPTION 'slot_too_late' USING ERRCODE = '22023', DETAIL = v_slot.delivery_date::text; END IF;
    IF v_slot.used_slots >= v_slot.capacity_slots OR v_slot.used_stops >= v_slot.capacity_stops THEN
      RAISE EXCEPTION 'slot_full' USING ERRCODE = '22023';
    END IF;
    UPDATE majordhome.webshop_delivery_slots
       SET status = 'open', closed_at = NULL, close_reason = NULL, status_note = NULL,
           route_sheet_sent_at = NULL, updated_at = now()
     WHERE id = p_slot_id;
  ELSE
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023', DETAIL = p_status;
  END IF;

  RETURN jsonb_build_object('slot_id', p_slot_id, 'status', p_status);
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_slot_set_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_slot_set_status(uuid, text, text) TO authenticated;

-- ============================================================================
-- 5. Annuler une tournée : commandes détachées et marquées « à planifier »
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_slot_cancel(p_slot_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_slot majordhome.webshop_delivery_slots;
  v_detached int;
BEGIN
  v_slot := majordhome.webshop_slot_guard(p_slot_id);
  IF v_slot.status IN ('cancelled', 'shipped') THEN
    RAISE EXCEPTION 'slot_not_cancellable' USING ERRCODE = '22023', DETAIL = v_slot.status;
  END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'note_required' USING ERRCODE = '22023'; END IF;

  UPDATE majordhome.webshop_orders
     SET delivery_slot_id = NULL, needs_manual_planning = true, delivery_slot_changed = true, updated_at = now()
   WHERE delivery_slot_id = p_slot_id AND org_id = v_slot.org_id;
  GET DIAGNOSTICS v_detached = ROW_COUNT;

  UPDATE majordhome.webshop_delivery_slots
     SET status = 'cancelled', closed_at = now(), close_reason = 'manual',
         status_note = btrim(p_note), updated_at = now()
   WHERE id = p_slot_id;
  PERFORM majordhome.webshop_slot_recount(p_slot_id);

  RETURN jsonb_build_object('slot_id', p_slot_id, 'detached_orders', v_detached);
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_slot_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_slot_cancel(uuid, text) TO authenticated;

-- ============================================================================
-- 6. Déplacer (ou planifier) une commande vers une tournée du même secteur
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_order_move_slot(p_order_id uuid, p_target_slot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_target majordhome.webshop_delivery_slots;
  v_order record;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_key text;
  v_new_stop boolean;
  v_source uuid;
BEGIN
  v_target := majordhome.webshop_slot_guard(p_target_slot_id);

  SELECT id, org_id, sector_id, delivery_slot_id, paid_at, status, pallet_delivery_mode, pallet_slots,
         COALESCE(normalized_address, lower(address), id::text) AS stop_key
    INTO v_order
    FROM majordhome.webshop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.org_id <> v_target.org_id THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_order.paid_at IS NULL OR v_order.status = 'annulee' THEN
    RAISE EXCEPTION 'order_not_plannable' USING ERRCODE = '22023', DETAIL = v_order.status;
  END IF;
  IF v_order.pallet_delivery_mode IS DISTINCT FROM 'delivery' OR COALESCE(v_order.pallet_slots, 0) <= 0 THEN
    RAISE EXCEPTION 'order_not_pallet_delivery' USING ERRCODE = '22023';
  END IF;
  IF v_order.sector_id IS DISTINCT FROM v_target.sector_id THEN RAISE EXCEPTION 'sector_mismatch' USING ERRCODE = '22023'; END IF;
  IF v_order.delivery_slot_id = p_target_slot_id THEN RAISE EXCEPTION 'same_slot' USING ERRCODE = '22023'; END IF;
  IF v_target.status NOT IN ('open', 'closed') THEN RAISE EXCEPTION 'slot_not_available' USING ERRCODE = '22023', DETAIL = v_target.status; END IF;
  IF v_target.delivery_date < v_today THEN RAISE EXCEPTION 'slot_past' USING ERRCODE = '22023'; END IF;

  v_key := v_order.stop_key;
  v_new_stop := NOT EXISTS (
    SELECT 1 FROM majordhome.webshop_orders o
     WHERE o.delivery_slot_id = p_target_slot_id AND o.id <> p_order_id
       AND o.paid_at IS NOT NULL AND o.status <> 'annulee'
       AND COALESCE(o.normalized_address, lower(o.address), o.id::text) = v_key);
  IF v_target.used_slots + v_order.pallet_slots > v_target.capacity_slots THEN
    RAISE EXCEPTION 'capacity_exceeded' USING ERRCODE = '22023',
      DETAIL = format('%s + %s > %s emplacements', v_target.used_slots, v_order.pallet_slots, v_target.capacity_slots);
  END IF;
  IF v_new_stop AND v_target.used_stops + 1 > v_target.capacity_stops THEN
    RAISE EXCEPTION 'stops_exceeded' USING ERRCODE = '22023',
      DETAIL = format('%s + 1 > %s arrêts', v_target.used_stops, v_target.capacity_stops);
  END IF;

  v_source := v_order.delivery_slot_id;
  IF v_source IS NOT NULL THEN
    PERFORM 1 FROM majordhome.webshop_delivery_slots WHERE id = v_source FOR UPDATE;
  END IF;

  UPDATE majordhome.webshop_orders
     SET delivery_slot_id = p_target_slot_id, needs_manual_planning = false,
         delivery_slot_changed = true, updated_at = now()
   WHERE id = p_order_id;

  PERFORM majordhome.webshop_slot_recount(p_target_slot_id);
  IF v_source IS NOT NULL THEN PERFORM majordhome.webshop_slot_recount(v_source); END IF;

  RETURN jsonb_build_object('order_id', p_order_id, 'from_slot_id', v_source, 'to_slot_id', p_target_slot_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_order_move_slot(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_order_move_slot(uuid, uuid) TO authenticated;

-- ============================================================================
-- 7. Envoyer la feuille de route au transporteur maintenant
--    ⚠️ La route du site traite toutes les tournées fermées non envoyées : les autres
--    tournées dans ce cas partent avec (elles seraient parties au cron de 17 h).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_slot_send_now(p_slot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_slot majordhome.webshop_delivery_slots;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_secret text;
  v_request bigint;
  v_others int;
BEGIN
  v_slot := majordhome.webshop_slot_guard(p_slot_id);
  IF v_slot.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'slot_not_sendable' USING ERRCODE = '22023', DETAIL = v_slot.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.webshop_orders
                  WHERE delivery_slot_id = p_slot_id AND paid_at IS NOT NULL AND status <> 'annulee') THEN
    RAISE EXCEPTION 'slot_empty' USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'webshop_cron_secret' LIMIT 1;
  IF v_secret IS NULL OR v_secret = '' THEN RAISE EXCEPTION 'cron_secret_missing' USING ERRCODE = '55000'; END IF;

  SELECT count(*) INTO v_others FROM majordhome.webshop_delivery_slots
   WHERE org_id = v_slot.org_id AND id <> p_slot_id AND status = 'closed' AND route_sheet_sent_at IS NULL;

  UPDATE majordhome.webshop_delivery_slots
     SET status = 'closed',
         closed_at = COALESCE(closed_at, now()),
         close_reason = COALESCE(close_reason, 'manual'),
         route_sheet_sent_at = NULL, updated_at = now()
   WHERE id = p_slot_id;

  -- Même URL et même secret que public.webshop_run_daily_tours (job webshop-tours-daily)
  SELECT net.http_post(
    url := 'https://www.mayer-energie.fr/api/boutique/cron/tournees',
    body := jsonb_build_object('source', 'majordhome', 'today', v_today::text, 'slot_id', p_slot_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 90000)
  INTO v_request;

  UPDATE majordhome.webshop_delivery_slots
     SET route_sheet_request_id = v_request, route_sheet_requested_at = now()
   WHERE id = p_slot_id;

  RETURN jsonb_build_object('slot_id', p_slot_id, 'request_id', v_request, 'other_pending_slots', v_others);
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_slot_send_now(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_slot_send_now(uuid) TO authenticated;

-- ============================================================================
-- 8. Résultat de l'envoi : réponse HTTP de la route du site (pg_net)
--    pending = pas encore de réponse ; on ne renvoie que les erreurs qui citent CETTE tournée.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_slot_send_result(p_slot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_slot majordhome.webshop_delivery_slots;
  v_resp record;
  v_body jsonb;
  v_errors jsonb;
BEGIN
  v_slot := majordhome.webshop_slot_guard(p_slot_id);
  IF v_slot.route_sheet_request_id IS NULL THEN
    RETURN jsonb_build_object('state', 'none', 'route_sheet_sent_at', v_slot.route_sheet_sent_at);
  END IF;

  SELECT status_code, content, timed_out, error_msg INTO v_resp
    FROM net._http_response WHERE id = v_slot.route_sheet_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'pending', 'requested_at', v_slot.route_sheet_requested_at,
                              'route_sheet_sent_at', v_slot.route_sheet_sent_at);
  END IF;

  BEGIN v_body := v_resp.content::jsonb; EXCEPTION WHEN others THEN v_body := NULL; END;
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_errors
    FROM jsonb_array_elements_text(COALESCE(v_body->'erreurs', '[]'::jsonb)) e
   WHERE e LIKE p_slot_id::text || '%';

  RETURN jsonb_build_object(
    'state', CASE WHEN v_slot.route_sheet_sent_at IS NOT NULL AND v_slot.route_sheet_sent_at >= v_slot.route_sheet_requested_at
                   THEN 'sent' ELSE 'failed' END,
    'status_code', v_resp.status_code,
    'timed_out', COALESCE(v_resp.timed_out, false),
    'error', CASE WHEN v_resp.error_msg IS NOT NULL THEN left(v_resp.error_msg, 300)
                  WHEN v_body IS NULL AND v_resp.content IS NOT NULL THEN left(v_resp.content, 300) END,
    'slot_errors', v_errors,
    'envoyees', v_body->'envoyees',
    'requested_at', v_slot.route_sheet_requested_at,
    'route_sheet_sent_at', v_slot.route_sheet_sent_at);
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_slot_send_result(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_slot_send_result(uuid) TO authenticated;
