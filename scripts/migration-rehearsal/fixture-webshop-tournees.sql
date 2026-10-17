-- fixture-webshop-tournees.sql — données de répétition pour assert-webshop-tournees.sql (jouée via
-- --migration AVANT les migrations). La commande WEB-2026-0011 sur laquelle l'assert a été écrite
-- (2026-10-13) n'existe plus en prod : on la reconstruit à partir de WEB-2026-0010 (même client,
-- même secteur), payée et rattachée à la tournée qu'elle demandait.
DO $$
DECLARE
  v_src majordhome.webshop_orders;
BEGIN
  IF EXISTS (SELECT 1 FROM majordhome.webshop_orders WHERE order_number = 'WEB-2026-0011') THEN RETURN; END IF;
  SELECT * INTO v_src FROM majordhome.webshop_orders WHERE order_number = 'WEB-2026-0010';
  IF v_src.id IS NULL OR v_src.requested_slot_id IS NULL THEN
    RAISE EXCEPTION 'fixture : WEB-2026-0010 (modèle) absente ou sans tournée demandée';
  END IF;
  INSERT INTO majordhome.webshop_orders
  SELECT (jsonb_populate_record(v_src, jsonb_build_object(
            'id', gen_random_uuid(), 'order_number', 'WEB-2026-0011', 'status', 'nouvelle', 'paid_at', now(),
            'cancel_reason', NULL, 'stripe_checkout_session_id', NULL, 'lead_id', NULL,
            'delivery_slot_id', v_src.requested_slot_id))).*;
  PERFORM majordhome.webshop_slot_recount(v_src.requested_slot_id);
END $$;
