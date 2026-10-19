-- assert-webshop-tournees.sql — vérifie 20261013_2_webshop_tournees.sql.
-- A : structure / droits. B : gestes sur la vraie tournée Muret du 2/11 (WEB-2026-0011),
-- dans une transaction annulée, avec des bouchons pg_net / Vault (absents du cluster local).

DO $$
BEGIN
  -- Position fixe (19ᵉ, ajoutée en fin par 20261013_2) : 20261019_1 ajoute departed_at / delivered_at après.
  IF (SELECT ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_webshop_delivery_slots'
       AND column_name = 'route_sheet_requested_at') IS DISTINCT FROM 19 THEN
    RAISE EXCEPTION 'majordhome_webshop_delivery_slots : route_sheet_requested_at n''est plus la 19ᵉ colonne';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='majordhome_webshop_delivery_slots' AND 'security_invoker=true' = ANY(reloptions)) THEN
    RAISE EXCEPTION 'vue slots sans security_invoker';
  END IF;
  IF has_function_privilege('anon', 'public.webshop_slot_send_now(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'send_now exécutable par anon'; END IF;
  IF has_function_privilege('anon', 'public.webshop_order_move_slot(uuid, uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'move exécutable par anon'; END IF;
  IF has_function_privilege('anon', 'public.webshop_slot_cancel(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'cancel exécutable par anon'; END IF;
  IF has_function_privilege('anon', 'public.webshop_slot_set_status(uuid, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'set_status exécutable par anon'; END IF;
  IF has_function_privilege('anon', 'public.webshop_slot_send_result(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'send_result exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.webshop_slot_send_now(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'send_now non exécutable par authenticated'; END IF;
  IF has_function_privilege('authenticated', 'majordhome.webshop_slot_guard(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'guard exécutable par authenticated'; END IF;
  IF has_function_privilege('authenticated', 'majordhome.webshop_slot_recount(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'recount exécutable par authenticated'; END IF;
  RAISE NOTICE 'assert-webshop-tournees A (structure) : OK';
END $$;

BEGIN;
-- Bouchons pg_net / Vault (le cluster de répétition n'a ni l'un ni l'autre)
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (name text, decrypted_secret text);
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net._http_response (id bigint, status_code int, content text, timed_out boolean, error_msg text);
CREATE TABLE IF NOT EXISTS net.rehearsal_calls (id bigserial, url text, body jsonb, headers jsonb);
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int)
RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO net.rehearsal_calls (url, body, headers) VALUES (url, body, headers) RETURNING id;
$f$;

DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_tl uuid; v_member uuid; v_outsider uuid;
  v_order uuid; v_s1 uuid; v_s2 uuid; v_other_sector_slot uuid;
  v_res jsonb; v_row record; v_call record;
BEGIN
  SELECT o.id, o.delivery_slot_id INTO v_order, v_s1 FROM majordhome.webshop_orders o WHERE o.order_number = 'WEB-2026-0011';
  IF v_s1 IS NULL THEN RAISE EXCEPTION 'fixture : WEB-2026-0011 sans tournée'; END IF;
  -- leads n'est pas chargé dans le harnais (data: false) : la FK lead_id casserait la 2ᵉ écriture de la ligne
  UPDATE majordhome.webshop_orders SET lead_id = NULL WHERE id = v_order;
  SELECT s2.id INTO v_s2 FROM majordhome.webshop_delivery_slots s1 JOIN majordhome.webshop_delivery_slots s2
      ON s2.sector_id = s1.sector_id AND s2.id <> s1.id AND s2.status = 'open'
   WHERE s1.id = v_s1 ORDER BY s2.delivery_date LIMIT 1;
  IF v_s2 IS NULL THEN RAISE EXCEPTION 'fixture : pas d''autre tournée ouverte du même secteur'; END IF;
  SELECT s.id INTO v_other_sector_slot FROM majordhome.webshop_delivery_slots s, majordhome.webshop_delivery_slots s1
   WHERE s1.id = v_s1 AND s.sector_id <> s1.sector_id AND s.status = 'open' LIMIT 1;

  SELECT user_id INTO v_tl FROM core.organization_members WHERE org_id = v_mayer AND role IN ('org_admin','team_leader') AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_member FROM core.organization_members WHERE org_id = v_mayer AND role NOT IN ('org_admin','team_leader') AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_outsider FROM core.organization_members WHERE org_id <> v_mayer AND user_id IS NOT NULL
     AND user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;
  IF v_tl IS NULL THEN RAISE EXCEPTION 'fixture : aucun team_leader+ Mayer'; END IF;

  -- (1) Non authentifié, étranger, simple membre : refusés
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.webshop_slot_set_status(v_s1, 'closed', NULL); RAISE EXCEPTION 'KO: non authentifié accepté';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'unauthenticated' THEN RAISE EXCEPTION '(1a) attendu unauthenticated, reçu %', SQLERRM; END IF; END;
  IF v_outsider IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
    BEGIN PERFORM public.webshop_order_move_slot(v_order, v_s2); RAISE EXCEPTION 'KO: étranger accepté';
    EXCEPTION WHEN others THEN IF SQLERRM <> 'team_leader_required' THEN RAISE EXCEPTION '(1b) reçu %', SQLERRM; END IF; END;
  END IF;
  IF v_member IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
    BEGIN PERFORM public.webshop_slot_send_now(v_s1); RAISE EXCEPTION 'KO: simple membre accepté';
    EXCEPTION WHEN others THEN IF SQLERRM <> 'team_leader_required' THEN RAISE EXCEPTION '(1c) reçu %', SQLERRM; END IF; END;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_tl::text, true);

  -- (2) Déplacement S1 → S2 : compteurs recalculés des deux côtés
  v_res := public.webshop_order_move_slot(v_order, v_s2);
  RESET ROLE;
  SELECT used_slots, used_stops INTO v_row FROM majordhome.webshop_delivery_slots WHERE id = v_s1;
  IF v_row.used_slots <> 0 OR v_row.used_stops <> 0 THEN RAISE EXCEPTION '(2) S1 non vidée : %/%', v_row.used_slots, v_row.used_stops; END IF;
  SELECT used_slots, used_stops INTO v_row FROM majordhome.webshop_delivery_slots WHERE id = v_s2;
  IF v_row.used_slots <> 1 OR v_row.used_stops <> 1 THEN RAISE EXCEPTION '(2) S2 mal comptée : %/%', v_row.used_slots, v_row.used_stops; END IF;
  IF NOT (SELECT delivery_slot_changed AND NOT needs_manual_planning FROM majordhome.webshop_orders WHERE id = v_order) THEN
    RAISE EXCEPTION '(2) drapeaux commande incorrects';
  END IF;

  -- (3) Autre secteur refusé ; capacité refusée
  SET LOCAL ROLE authenticated;
  IF v_other_sector_slot IS NOT NULL THEN
    BEGIN PERFORM public.webshop_order_move_slot(v_order, v_other_sector_slot); RAISE EXCEPTION 'KO: autre secteur accepté';
    EXCEPTION WHEN others THEN IF SQLERRM <> 'sector_mismatch' THEN RAISE EXCEPTION '(3a) reçu %', SQLERRM; END IF; END;
  END IF;
  RESET ROLE;
  UPDATE majordhome.webshop_delivery_slots SET capacity_slots = 0 WHERE id = v_s1;
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.webshop_order_move_slot(v_order, v_s1); RAISE EXCEPTION 'KO: capacité dépassée acceptée';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'capacity_exceeded' THEN RAISE EXCEPTION '(3b) reçu %', SQLERRM; END IF; END;
  RESET ROLE;
  UPDATE majordhome.webshop_delivery_slots SET capacity_slots = 10 WHERE id = v_s1;

  -- (4) Fermer puis rouvrir S2
  SET LOCAL ROLE authenticated;
  PERFORM public.webshop_slot_set_status(v_s2, 'closed', 'Test');
  RESET ROLE;
  SELECT status, close_reason, status_note INTO v_row FROM majordhome.webshop_delivery_slots WHERE id = v_s2;
  IF v_row.status <> 'closed' OR v_row.close_reason <> 'manual' OR v_row.status_note <> 'Test' THEN RAISE EXCEPTION '(4) fermeture : %', row_to_json(v_row); END IF;
  SET LOCAL ROLE authenticated;
  PERFORM public.webshop_slot_set_status(v_s2, 'open', NULL);
  RESET ROLE;
  IF (SELECT status FROM majordhome.webshop_delivery_slots WHERE id = v_s2) <> 'open' THEN RAISE EXCEPTION '(4) réouverture ratée'; END IF;

  -- (5) Envoi : secret absent → refus ; tournée vide → refus ; puis envoi réel
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.webshop_slot_send_now(v_s2); RAISE EXCEPTION 'KO: envoi sans secret accepté';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'cron_secret_missing' THEN RAISE EXCEPTION '(5a) reçu %', SQLERRM; END IF; END;
  BEGIN PERFORM public.webshop_slot_send_now(v_s1); RAISE EXCEPTION 'KO: tournée vide envoyée';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'slot_empty' THEN RAISE EXCEPTION '(5b) reçu %', SQLERRM; END IF; END;
  RESET ROLE;
  INSERT INTO vault.decrypted_secrets VALUES ('webshop_cron_secret', 'rehearsal-secret');
  UPDATE majordhome.webshop_delivery_slots SET route_sheet_sent_at = now() - interval '1 day' WHERE id = v_s2;
  SET LOCAL ROLE authenticated;
  v_res := public.webshop_slot_send_now(v_s2);
  RESET ROLE;
  SELECT * INTO v_call FROM net.rehearsal_calls ORDER BY id DESC LIMIT 1;
  IF v_call.url <> 'https://www.mayer-energie.fr/api/boutique/cron/tournees' OR v_call.headers->>'Authorization' <> 'Bearer rehearsal-secret' THEN
    RAISE EXCEPTION '(5c) appel incorrect : % %', v_call.url, v_call.headers;
  END IF;
  SELECT status, route_sheet_sent_at, route_sheet_request_id INTO v_row FROM majordhome.webshop_delivery_slots WHERE id = v_s2;
  IF v_row.status <> 'closed' OR v_row.route_sheet_sent_at IS NOT NULL OR v_row.route_sheet_request_id <> (v_res->>'request_id')::bigint THEN
    RAISE EXCEPTION '(5c) tournée après envoi : %', row_to_json(v_row);
  END IF;

  -- (6) Résultat : en attente, puis envoyé
  SET LOCAL ROLE authenticated;
  IF public.webshop_slot_send_result(v_s2)->>'state' <> 'pending' THEN RAISE EXCEPTION '(6a) attendu pending'; END IF;
  RESET ROLE;
  INSERT INTO net._http_response VALUES ((v_res->>'request_id')::bigint, 200,
    jsonb_build_object('envoyees', 1, 'erreurs', jsonb_build_array('autre-id (2026-11-02) : x'))::text, false, NULL);
  UPDATE majordhome.webshop_delivery_slots SET route_sheet_sent_at = now() + interval '1 second' WHERE id = v_s2;
  SET LOCAL ROLE authenticated;
  v_res := public.webshop_slot_send_result(v_s2);
  IF v_res->>'state' <> 'sent' OR jsonb_array_length(v_res->'slot_errors') <> 0 THEN RAISE EXCEPTION '(6b) résultat : %', v_res; END IF;

  -- (7) Annulation : commande détachée → à planifier ; puis replanifiée sur S1
  BEGIN PERFORM public.webshop_slot_cancel(v_s2, ' '); RAISE EXCEPTION 'KO: annulation sans motif';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'note_required' THEN RAISE EXCEPTION '(7a) reçu %', SQLERRM; END IF; END;
  v_res := public.webshop_slot_cancel(v_s2, 'Jour férié');
  IF (v_res->>'detached_orders')::int <> 1 THEN RAISE EXCEPTION '(7b) %', v_res; END IF;
  RESET ROLE;
  SELECT status, used_slots, used_stops INTO v_row FROM majordhome.webshop_delivery_slots WHERE id = v_s2;
  IF v_row.status <> 'cancelled' OR v_row.used_slots <> 0 THEN RAISE EXCEPTION '(7b) tournée : %', row_to_json(v_row); END IF;
  IF NOT (SELECT needs_manual_planning AND delivery_slot_id IS NULL FROM majordhome.webshop_orders WHERE id = v_order) THEN
    RAISE EXCEPTION '(7b) commande non marquée à planifier';
  END IF;
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.webshop_order_move_slot(v_order, v_s2); RAISE EXCEPTION 'KO: tournée annulée acceptée';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'slot_not_available' THEN RAISE EXCEPTION '(7c) reçu %', SQLERRM; END IF; END;
  PERFORM public.webshop_order_move_slot(v_order, v_s1);
  RESET ROLE;
  IF (SELECT used_slots FROM majordhome.webshop_delivery_slots WHERE id = v_s1) <> 1 THEN RAISE EXCEPTION '(7d) S1 non recomptée'; END IF;
  IF (SELECT needs_manual_planning FROM majordhome.webshop_orders WHERE id = v_order) THEN RAISE EXCEPTION '(7d) toujours à planifier'; END IF;

  -- (8) Recount : pleine → fermée « capacity », puis rouverte quand la place revient
  UPDATE majordhome.webshop_delivery_slots SET capacity_slots = 1 WHERE id = v_s1;
  PERFORM majordhome.webshop_slot_recount(v_s1);
  IF (SELECT status || '/' || close_reason FROM majordhome.webshop_delivery_slots WHERE id = v_s1) <> 'closed/capacity' THEN RAISE EXCEPTION '(8a) non fermée'; END IF;
  UPDATE majordhome.webshop_delivery_slots SET capacity_slots = 10 WHERE id = v_s1;
  PERFORM majordhome.webshop_slot_recount(v_s1);
  IF (SELECT status FROM majordhome.webshop_delivery_slots WHERE id = v_s1) <> 'open' THEN RAISE EXCEPTION '(8b) non rouverte'; END IF;

  RAISE NOTICE 'assert-webshop-tournees B (gestes) : OK';
END $$;
ROLLBACK;
