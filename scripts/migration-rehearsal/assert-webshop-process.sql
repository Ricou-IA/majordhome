-- assert-webshop-process.sql — vérifie 20261019_1_webshop_process.sql.
-- Prérequis du run : fixture-webshop-tournees, 20261013_2, 20261017_1, 20261017_2, 20261018_1
-- puis 20261019_1.
-- A : structure / droits. B : journal des actions (service_role). C : événements de tournée.
-- B et C tournent dans une transaction annulée.

-- ── A. Structure ─────────────────────────────────────────────────────────────
DO $$
DECLARE f text; r text;
BEGIN
  IF to_regclass('majordhome.webshop_order_actions') IS NULL THEN RAISE EXCEPTION 'table webshop_order_actions absente'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.webshop_order_actions'::regclass) THEN
    RAISE EXCEPTION 'RLS désactivée sur webshop_order_actions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'webshop_order_actions' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'policy d''écriture sur webshop_order_actions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'webshop_order_actions'
                  AND cmd = 'SELECT' AND roles = '{authenticated}') THEN
    RAISE EXCEPTION 'policy SELECT membres absente';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'majordhome.webshop_order_actions', 'INSERT') OR has_table_privilege(r, 'majordhome.webshop_order_actions', 'UPDATE')
       OR has_table_privilege(r, 'majordhome.webshop_order_actions', 'DELETE') THEN
      RAISE EXCEPTION '% peut écrire dans webshop_order_actions', r;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'majordhome.webshop_order_actions', 'SELECT') THEN RAISE EXCEPTION 'anon lit webshop_order_actions'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.webshop_order_actions', 'SELECT') THEN RAISE EXCEPTION 'GRANT SELECT service_role manquant'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_webshop_order_actions', 'SELECT') THEN RAISE EXCEPTION 'vue journal non lisible par authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.majordhome_webshop_order_actions'::regclass AND 'security_invoker=true' = ANY(reloptions)) THEN
    RAISE EXCEPTION 'vue journal sans security_invoker';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'majordhome' AND tablename = 'webshop_order_actions'
                  AND indexdef LIKE 'CREATE UNIQUE INDEX%(order_id, envoi, evenement, action)%WHERE (status = ''sent''::text)%') THEN
    RAISE EXCEPTION 'index unique partiel « sent » absent';
  END IF;

  -- Vue des tournées : 2 colonnes en fin, toujours un miroir simple (insérable) en security_invoker
  IF (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM (
        SELECT column_name, ordinal_position FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'majordhome_webshop_delivery_slots'
         ORDER BY ordinal_position DESC LIMIT 3) t) <> 'route_sheet_requested_at,departed_at,delivered_at' THEN
    RAISE EXCEPTION 'majordhome_webshop_delivery_slots : departed_at / delivered_at pas en fin de liste';
  END IF;
  IF (SELECT is_insertable_into FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'majordhome_webshop_delivery_slots') <> 'YES' THEN
    RAISE EXCEPTION 'majordhome_webshop_delivery_slots n''est plus un miroir simple';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.majordhome_webshop_delivery_slots'::regclass AND 'security_invoker=true' = ANY(reloptions)) THEN
    RAISE EXCEPTION 'vue slots sans security_invoker';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'webshop_delivery_slots_status_check'))
     NOT LIKE '%open%closed%shipped%cancelled%' THEN
    RAISE EXCEPTION 'CHECK de statut des tournées modifiée';
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'public.webshop_order_action_record(uuid, uuid, text, text, text, text, text, text, text, text, uuid)',
    'public.webshop_order_action_already_sent(uuid, text, text, text)',
    'public.webshop_slot_mark_event(uuid, text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par anon', f; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.webshop_order_action_record(uuid, uuid, text, text, text, text, text, text, text, text, uuid)',
    'public.webshop_order_action_already_sent(uuid, text, text, text)'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN RAISE EXCEPTION '% exécutable par authenticated', f; END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION '% non exécutable par service_role', f; END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.webshop_slot_mark_event(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'mark_event non exécutable par authenticated';
  END IF;

  IF majordhome.webshop_reglages_defaut() #>> '{process,tournee,partie,email_client}' IS DISTINCT FROM 'webshop_expedition_palette' THEN
    RAISE EXCEPTION 'défauts SQL non régénérés (process absent)';
  END IF;
  RAISE NOTICE 'assert-webshop-process A (structure) : OK';
END $$;

BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_other_org uuid;
  v_tl uuid; v_member uuid; v_outsider uuid;
  v_order uuid; v_slot uuid; v_open_slot uuid;
  v_id1 uuid; v_id2 uuid; v_id3 uuid; v_n int; v_b boolean; v_res jsonb; v_row record;
BEGIN
  SELECT id INTO v_order FROM majordhome.webshop_orders WHERE org_id = v_mayer ORDER BY order_number LIMIT 1;
  SELECT id INTO v_other_org FROM core.organizations WHERE id <> v_mayer LIMIT 1;
  SELECT user_id INTO v_tl FROM core.organization_members WHERE org_id = v_mayer AND role IN ('org_admin','team_leader') AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_member FROM core.organization_members WHERE org_id = v_mayer AND role NOT IN ('org_admin','team_leader') AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_outsider FROM core.organization_members WHERE org_id <> v_mayer AND user_id IS NOT NULL
     AND user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;
  SELECT id INTO v_slot FROM majordhome.webshop_delivery_slots WHERE org_id = v_mayer AND status = 'open' ORDER BY delivery_date LIMIT 1;
  SELECT id INTO v_open_slot FROM majordhome.webshop_delivery_slots WHERE org_id = v_mayer AND status = 'open' AND id <> v_slot ORDER BY delivery_date LIMIT 1;
  IF v_order IS NULL OR v_other_org IS NULL OR v_tl IS NULL OR v_member IS NULL OR v_slot IS NULL OR v_open_slot IS NULL THEN
    RAISE EXCEPTION 'fixture incomplète (commande %, autre org %, tl %, membre %, tournées % / %)', v_order, v_other_org, v_tl, v_member, v_slot, v_open_slot;
  END IF;

  -- ── B. Journal des actions ──────────────────────────────────────────────────
  -- (1) authenticated (même team_leader) ne peut pas écrire dans le journal
  PERFORM set_config('request.jwt.claim.sub', v_tl::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.webshop_order_action_record(v_mayer, v_order, 'colis', 'expediee', 'email_client', 'webshop_expedition_colis', 'sent', NULL, NULL, 'x@y.fr', NULL);
    RAISE EXCEPTION 'KO: record accepté pour authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.webshop_order_action_already_sent(v_order, 'colis', 'expediee', 'email_client');
    RAISE EXCEPTION 'KO: already_sent accepté pour authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  SET LOCAL ROLE service_role;
  -- (2) mauvaise org → org_mismatch ; commande inconnue → order_not_found
  BEGIN
    PERFORM public.webshop_order_action_record(v_other_org, v_order, 'colis', 'expediee', 'email_client', 'webshop_expedition_colis', 'sent', NULL, NULL, 'x@y.fr', NULL);
    RAISE EXCEPTION 'KO: mauvaise org acceptée';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'org_mismatch' THEN RAISE EXCEPTION '(2a) attendu org_mismatch, reçu %', SQLERRM; END IF; END;
  BEGIN
    PERFORM public.webshop_order_action_record(v_mayer, gen_random_uuid(), 'colis', 'expediee', 'email_client', NULL, 'sent', NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'KO: commande inconnue acceptée';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'order_not_found' THEN RAISE EXCEPTION '(2b) attendu order_not_found, reçu %', SQLERRM; END IF; END;

  -- (3) failed puis rejeu sent = UNE seule ligne, mise à jour
  v_id1 := public.webshop_order_action_record(v_mayer, v_order, 'colis', 'expediee', 'email_client', 'webshop_expedition_colis', 'failed', 'template_missing', 'Gabarit absent', 'x@y.fr', NULL);
  IF public.webshop_order_action_already_sent(v_order, 'colis', 'expediee', 'email_client') THEN RAISE EXCEPTION '(3) already_sent vrai après un failed'; END IF;
  v_id2 := public.webshop_order_action_record(v_mayer, v_order, 'colis', 'expediee', 'email_client', 'webshop_expedition_colis', 'sent', NULL, NULL, 'x@y.fr', NULL);
  IF v_id2 <> v_id1 THEN RAISE EXCEPTION '(3) le rejeu a inséré une nouvelle ligne'; END IF;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM majordhome.webshop_order_actions WHERE order_id = v_order;
  IF v_n <> 1 THEN RAISE EXCEPTION '(3) % ligne(s) au lieu de 1', v_n; END IF;
  SELECT status, error_code, error_message INTO v_row FROM majordhome.webshop_order_actions WHERE id = v_id1;
  IF v_row.status <> 'sent' OR v_row.error_code IS NOT NULL OR v_row.error_message IS NOT NULL THEN
    RAISE EXCEPTION '(3) ligne rejouée incorrecte : %', row_to_json(v_row);
  END IF;
  SET LOCAL ROLE service_role;
  IF NOT public.webshop_order_action_already_sent(v_order, 'colis', 'expediee', 'email_client') THEN RAISE EXCEPTION '(3) already_sent faux après un sent'; END IF;

  -- (4) un 2ᵉ sent (ou un failed) sur la même clé → already_sent
  BEGIN
    PERFORM public.webshop_order_action_record(v_mayer, v_order, 'colis', 'expediee', 'email_client', 'webshop_expedition_colis', 'sent', NULL, NULL, 'x@y.fr', NULL);
    RAISE EXCEPTION 'KO: 2ᵉ sent accepté';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'already_sent' THEN RAISE EXCEPTION '(4a) attendu already_sent, reçu %', SQLERRM; END IF; END;
  BEGIN
    PERFORM public.webshop_order_action_record(v_mayer, v_order, 'colis', 'expediee', 'email_client', 'webshop_expedition_colis', 'failed', 'x', NULL, 'x@y.fr', NULL);
    RAISE EXCEPTION 'KO: failed après sent accepté';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'already_sent' THEN RAISE EXCEPTION '(4b) attendu already_sent, reçu %', SQLERRM; END IF; END;

  -- (5) autre clé (envoi, événement ou action) = nouvelle ligne ; skipped puis skipped = même ligne
  v_id3 := public.webshop_order_action_record(v_mayer, v_order, 'palette', 'tournee_partie', 'email_client', 'webshop_expedition_palette', 'skipped', 'no_email', NULL, NULL, v_slot);
  IF v_id3 = v_id1 THEN RAISE EXCEPTION '(5) clé distincte confondue'; END IF;
  IF public.webshop_order_action_record(v_mayer, v_order, 'palette', 'tournee_partie', 'email_client', 'webshop_expedition_palette', 'skipped', 'no_email', NULL, NULL, v_slot) <> v_id3 THEN
    RAISE EXCEPTION '(5) skipped rejoué a inséré une ligne';
  END IF;
  PERFORM public.webshop_order_action_record(v_mayer, v_order, 'colis', 'expediee', 'ordre_colis', NULL, 'failed', 'prestataire_missing', NULL, NULL, NULL);
  -- (6) valeurs hors liste refusées par les CHECK
  BEGIN
    PERFORM public.webshop_order_action_record(v_mayer, v_order, 'colis', 'annulee', 'email_client', NULL, 'sent', NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'KO: événement hors liste accepté';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM majordhome.webshop_order_actions WHERE order_id = v_order;
  IF v_n <> 3 THEN RAISE EXCEPTION '(5) % ligne(s) au lieu de 3', v_n; END IF;

  -- (7) lecture par la vue : membre de l'org oui, étranger non
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.majordhome_webshop_order_actions WHERE order_id = v_order;
  IF v_n <> 3 THEN RAISE EXCEPTION '(7) membre voit % ligne(s) au lieu de 3', v_n; END IF;
  BEGIN
    INSERT INTO public.majordhome_webshop_order_actions (org_id, order_id, envoi, evenement, action, status)
    VALUES (v_mayer, v_order, 'colis', 'livree', 'email_client', 'sent');
    RAISE EXCEPTION 'KO: écriture directe par la vue acceptée';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  IF v_outsider IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.majordhome_webshop_order_actions WHERE order_id = v_order;
    RESET ROLE;
    IF v_n <> 0 THEN RAISE EXCEPTION '(7) étranger voit % ligne(s)', v_n; END IF;
  END IF;
  RAISE NOTICE 'assert-webshop-process B (journal) : OK';

  -- ── C. Événements de tournée ────────────────────────────────────────────────
  -- (8) non authentifié, simple membre : refusés
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.webshop_slot_mark_event(v_slot, 'partie'); RAISE EXCEPTION 'KO: non authentifié accepté';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'unauthenticated' THEN RAISE EXCEPTION '(8a) reçu %', SQLERRM; END IF; END;
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  BEGIN PERFORM public.webshop_slot_mark_event(v_slot, 'partie'); RAISE EXCEPTION 'KO: simple membre accepté';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'team_leader_required' THEN RAISE EXCEPTION '(8b) reçu %', SQLERRM; END IF; END;

  PERFORM set_config('request.jwt.claim.sub', v_tl::text, true);
  -- (9) partie sur une tournée ouverte → slot_not_closed ; événement inconnu → invalid_event
  BEGIN PERFORM public.webshop_slot_mark_event(v_slot, 'partie'); RAISE EXCEPTION 'KO: partie sur tournée ouverte';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'slot_not_closed' THEN RAISE EXCEPTION '(9a) reçu %', SQLERRM; END IF; END;
  BEGIN PERFORM public.webshop_slot_mark_event(v_slot, 'arrivee'); RAISE EXCEPTION 'KO: événement inconnu accepté';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'invalid_event' THEN RAISE EXCEPTION '(9b) reçu %', SQLERRM; END IF; END;
  RESET ROLE;

  UPDATE majordhome.webshop_delivery_slots SET status = 'closed', closed_at = now(), close_reason = 'manual' WHERE id = v_slot;

  SET LOCAL ROLE authenticated;
  -- (10) livrée avant partie → slot_not_departed
  BEGIN PERFORM public.webshop_slot_mark_event(v_slot, 'livree'); RAISE EXCEPTION 'KO: livrée avant partie';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'slot_not_departed' THEN RAISE EXCEPTION '(10) reçu %', SQLERRM; END IF; END;

  -- (11) partie ×2 : first_time vrai puis faux, departed_at posé une fois
  v_res := public.webshop_slot_mark_event(v_slot, 'partie');
  IF v_res <> jsonb_build_object('slot_id', v_slot, 'event', 'partie', 'first_time', true) THEN RAISE EXCEPTION '(11) 1ʳᵉ partie : %', v_res; END IF;
  v_res := public.webshop_slot_mark_event(v_slot, 'partie');
  IF (v_res ->> 'first_time')::boolean IS NOT FALSE THEN RAISE EXCEPTION '(11) 2ᵉ partie : %', v_res; END IF;
  RESET ROLE;
  SELECT status, departed_at, delivered_at INTO v_row FROM majordhome.webshop_delivery_slots WHERE id = v_slot;
  IF v_row.status <> 'closed' OR v_row.departed_at IS NULL OR v_row.delivered_at IS NOT NULL THEN RAISE EXCEPTION '(11) tournée : %', row_to_json(v_row); END IF;

  -- (12) livrée ×2 : shipped + delivered_at, puis first_time faux ; partie rejouée après livraison = faux
  SET LOCAL ROLE authenticated;
  v_res := public.webshop_slot_mark_event(v_slot, 'livree');
  IF (v_res ->> 'first_time')::boolean IS NOT TRUE THEN RAISE EXCEPTION '(12) 1ʳᵉ livrée : %', v_res; END IF;
  v_res := public.webshop_slot_mark_event(v_slot, 'livree');
  IF (v_res ->> 'first_time')::boolean IS NOT FALSE THEN RAISE EXCEPTION '(12) 2ᵉ livrée : %', v_res; END IF;
  v_res := public.webshop_slot_mark_event(v_slot, 'partie');
  IF (v_res ->> 'first_time')::boolean IS NOT FALSE THEN RAISE EXCEPTION '(12) partie après livrée : %', v_res; END IF;
  RESET ROLE;
  SELECT status, departed_at, delivered_at INTO v_row FROM majordhome.webshop_delivery_slots WHERE id = v_slot;
  IF v_row.status <> 'shipped' OR v_row.delivered_at IS NULL OR v_row.departed_at IS NULL THEN RAISE EXCEPTION '(12) tournée : %', row_to_json(v_row); END IF;

  -- (13) tournée annulée : ni partie ni livrée
  UPDATE majordhome.webshop_delivery_slots SET status = 'cancelled' WHERE id = v_open_slot;
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.webshop_slot_mark_event(v_open_slot, 'partie'); RAISE EXCEPTION 'KO: partie sur tournée annulée';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'slot_not_closed' THEN RAISE EXCEPTION '(13) reçu %', SQLERRM; END IF; END;
  RESET ROLE;
  RAISE NOTICE 'assert-webshop-process C (événements de tournée) : OK';
END $$;
ROLLBACK;
