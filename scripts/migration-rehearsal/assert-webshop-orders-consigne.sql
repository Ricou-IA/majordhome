-- assert-webshop-orders-consigne.sql — vérifie 20261013_3_webshop_orders_consigne_suppression.sql.
DO $$
BEGIN
  IF (SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_webshop_orders'
       ORDER BY ordinal_position DESC LIMIT 1) <> 'delivery_instructions' THEN RAISE EXCEPTION 'vue orders : delivery_instructions pas en fin'; END IF;
  IF (SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_webshop_orders_write'
       ORDER BY ordinal_position DESC LIMIT 1) <> 'delivery_instructions' THEN RAISE EXCEPTION 'vue orders_write : delivery_instructions pas en fin'; END IF;
  IF (SELECT is_updatable FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_webshop_orders_write') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_webshop_orders_write non updatable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='webshop_orders_recount_slots' AND tgrelid='majordhome.webshop_orders'::regclass) THEN
    RAISE EXCEPTION 'trigger webshop_orders_recount_slots absent';
  END IF;
  IF has_function_privilege('anon', 'public.webshop_order_hard_delete(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'hard_delete exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.webshop_order_hard_delete(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'hard_delete fermé à authenticated'; END IF;
  RAISE NOTICE 'assert-webshop-orders-consigne A (structure) : OK';
END $$;

BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_admin uuid; v_tl uuid; v_order uuid; v_slot uuid; v_res jsonb;
BEGIN
  SELECT id, delivery_slot_id INTO v_order, v_slot FROM majordhome.webshop_orders WHERE order_number = 'WEB-2026-0011';
  IF v_slot IS NULL THEN RAISE EXCEPTION 'fixture : WEB-2026-0011 sans tournée'; END IF;
  UPDATE majordhome.webshop_orders SET lead_id = NULL WHERE id = v_order; -- leads non chargé dans le harnais
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_mayer AND role = 'org_admin' AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_tl FROM core.organization_members WHERE org_id = v_mayer AND role = 'team_leader' AND user_id IS NOT NULL LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SET LOCAL ROLE authenticated;
  -- (1) Consigne écrite par la vue d'écriture, relue par la vue de lecture
  UPDATE public.majordhome_webshop_orders_write SET delivery_instructions = 'Appeler 30 min avant' WHERE id = v_order AND org_id = v_mayer;
  IF (SELECT delivery_instructions FROM public.majordhome_webshop_orders WHERE id = v_order) IS DISTINCT FROM 'Appeler 30 min avant' THEN
    RAISE EXCEPTION '(1) consigne non relue';
  END IF;
  -- (2) Annuler la commande depuis Commandes libère la tournée (trigger), la réactiver la reprend
  UPDATE public.majordhome_webshop_orders_write SET status = 'annulee' WHERE id = v_order AND org_id = v_mayer;
  RESET ROLE;
  IF (SELECT used_slots FROM majordhome.webshop_delivery_slots WHERE id = v_slot) <> 0 THEN RAISE EXCEPTION '(2) tournée non libérée'; END IF;
  SET LOCAL ROLE authenticated;
  UPDATE public.majordhome_webshop_orders_write SET status = 'nouvelle' WHERE id = v_order AND org_id = v_mayer;
  RESET ROLE;
  IF (SELECT used_slots FROM majordhome.webshop_delivery_slots WHERE id = v_slot) <> 1 THEN RAISE EXCEPTION '(2) tournée non reprise'; END IF;

  -- (3) Suppression : refusée à un team_leader, acceptée pour l'org_admin, tournée recomptée, lignes en cascade
  SET LOCAL ROLE authenticated;
  IF v_tl IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_tl::text, true);
    BEGIN PERFORM public.webshop_order_hard_delete(v_order); RAISE EXCEPTION 'KO: team_leader a supprimé';
    EXCEPTION WHEN others THEN IF SQLERRM <> 'org_admin_required' THEN RAISE EXCEPTION '(3a) reçu %', SQLERRM; END IF; END;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN PERFORM public.webshop_order_hard_delete(v_order); RAISE EXCEPTION 'KO: anonyme a supprimé';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'unauthenticated' THEN RAISE EXCEPTION '(3b) reçu %', SQLERRM; END IF; END;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.webshop_order_hard_delete(v_order);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM majordhome.webshop_orders WHERE id = v_order) THEN RAISE EXCEPTION '(3c) commande toujours là'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.webshop_order_items WHERE order_id = v_order) THEN RAISE EXCEPTION '(3c) lignes orphelines'; END IF;
  IF (v_res->>'items_deleted')::int < 1 THEN RAISE EXCEPTION '(3c) compteur lignes : %', v_res; END IF;
  IF (SELECT used_slots + used_stops FROM majordhome.webshop_delivery_slots WHERE id = v_slot) <> 0 THEN RAISE EXCEPTION '(3c) tournée non recomptée'; END IF;

  RAISE NOTICE 'assert-webshop-orders-consigne B (gestes) : OK';
END $$;
ROLLBACK;
