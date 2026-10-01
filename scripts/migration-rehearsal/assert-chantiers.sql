-- assert-chantiers.sql — vérifie 20260930_16 (§A), 20260930_17 (§B), 20260930_18 (§C) sur le cluster
-- de répétition, après fixture-chantiers.sql. Un écart lève une exception → run.mjs sort en ECHEC.

-- ── §A Structure + reprise ────────────────────────────────────────────────────
DO $$
DECLARE n int; v_upd text; v_amount numeric; v_bool boolean; v_ch uuid; v_ch4 uuid; v_win boolean;
BEGIN
  IF to_regclass('majordhome.chantiers') IS NULL THEN RAISE EXCEPTION 'table chantiers absente'; END IF;

  -- Reprise : 1 chantier par lead à chantier_status (GOUIN seulement dans la fixture ; RENOU et SANS DEVIS : aucun)
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : 1 chantier attendu, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
  IF n <> 0 THEN RAISE EXCEPTION 'RENOU / SANS DEVIS : aucun chantier attendu, trouvé %', n; END IF;

  SELECT id INTO v_ch FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes WHERE chantier_id = v_ch;
  IF n <> 2 THEN RAISE EXCEPTION 'GOUIN : 2 devis validés rattachés attendus, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes WHERE id = 'aaaa0001-0000-0000-0000-000000000003' AND chantier_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : le devis refusé ne doit pas être rattaché'; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes WHERE id = 'aaaa0001-0000-0000-0000-000000000009' AND chantier_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : le devis en attente ne doit pas être rattaché'; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes WHERE id = 'aaaa0001-0000-0000-0000-000000000004' AND chantier_id IS NULL AND ejected_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : le devis validé éjecté ne doit pas être rattaché'; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments WHERE chantier_id = v_ch;
  IF n <> 4 THEN RAISE EXCEPTION 'GOUIN : 4 RDV rattachés attendus, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments WHERE id = 'bbbb0001-0000-0000-0000-000000000005' AND chantier_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : le RDV rdv_technical ne doit pas être rattaché'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantier_line_receptions WHERE chantier_id = v_ch;
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : réception de ligne non re-parentée'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111'
     AND chantier_status = 'planification' AND planned_team_size = 2 AND planned_days = 3 AND equipment_order_status = 'recu';
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : colonnes chantier non recopiées'; END IF;

  -- Lead gagné sans aucun devis : 1 chantier, tout à zéro
  SELECT id INTO v_ch4 FROM majordhome.chantiers WHERE lead_id = '44444444-4444-4444-4444-444444444444';
  IF v_ch4 IS NULL THEN RAISE EXCEPTION 'SANSQUOTE : 1 chantier attendu'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_chantiers WHERE id = v_ch4 AND validated_quotes_count = 0 AND quotes_count = 0
     AND linked_quotes_amount_ht = 0 AND NOT is_invoiced AND lead_chantiers_count = 1;
  IF n <> 1 THEN RAISE EXCEPTION 'SANSQUOTE : colonnes dérivées de la vue incorrectes'; END IF;

  -- chantier_quote_stats ne compte ni le devis en attente ni l'éjecté ni le refusé (non rattachés)
  SELECT count(*) INTO n FROM majordhome.chantier_quote_stats WHERE chantier_id = v_ch
     AND quotes_count = 2 AND validated_count = 2 AND invoiced_count = 1 AND pending_count = 0 AND validated_sum = 12800.76;
  IF n <> 1 THEN RAISE EXCEPTION 'chantier_quote_stats GOUIN incorrecte'; END IF;

  -- Vue majordhome_chantiers
  SELECT linked_quotes_amount_ht, is_invoiced INTO v_amount, v_bool FROM public.majordhome_chantiers WHERE id = v_ch;
  IF v_amount <> 12800.76 THEN RAISE EXCEPTION 'GOUIN : montant attendu 12800.76, trouvé %', v_amount; END IF;
  IF v_bool THEN RAISE EXCEPTION 'GOUIN : is_invoiced doit être faux (PAC acceptée non facturée)'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_chantiers WHERE id = v_ch AND validated_quotes_count = 2 AND quotes_count = 2
     AND lead_chantiers_count = 1 AND has_active_rdv AND next_rdv_date = DATE '2026-09-18';
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : colonnes dérivées de la vue incorrectes'; END IF;

  -- target_invoiced par chantier : rien de violet tant que la PAC n'est pas facturée
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_ch AND target_invoiced;
  IF n <> 0 THEN RAISE EXCEPTION 'target_invoiced : % RDV violets attendus 0', n; END IF;
  -- Branche positive : PAC facturée ⇒ les 4 RDV du chantier deviennent violets et is_invoiced vrai ; puis retour arrière
  SELECT is_winning_quote INTO v_win FROM majordhome.lead_pennylane_quotes WHERE id = 'aaaa0001-0000-0000-0000-000000000002';
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'invoiced' WHERE id = 'aaaa0001-0000-0000-0000-000000000002';
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_ch AND target_invoiced;
  IF n <> 4 THEN RAISE EXCEPTION 'target_invoiced : 4 RDV violets attendus quand tout est facturé, trouvé %', n; END IF;
  SELECT is_invoiced INTO v_bool FROM public.majordhome_chantiers WHERE id = v_ch;
  IF v_bool IS NOT TRUE THEN RAISE EXCEPTION 'GOUIN : is_invoiced doit être vrai quand tous les devis validés sont facturés'; END IF;
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'accepted', is_winning_quote = v_win WHERE id = 'aaaa0001-0000-0000-0000-000000000002';
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_ch AND target_invoiced;
  IF n <> 0 THEN RAISE EXCEPTION 'target_invoiced : retour arrière, % RDV violets attendus 0', n; END IF;
  SELECT is_invoiced INTO v_bool FROM public.majordhome_chantiers WHERE id = v_ch;
  IF v_bool THEN RAISE EXCEPTION 'GOUIN : is_invoiced doit redevenir faux'; END IF;

  -- Miroirs updatable
  SELECT is_updatable INTO v_upd FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_appointments';
  IF v_upd IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'majordhome_appointments non updatable'; END IF;
  SELECT is_updatable INTO v_upd FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers_write';
  IF v_upd IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'majordhome_chantiers_write non updatable'; END IF;

  -- chantier_id en FIN de liste des deux vues étendues
  SELECT count(*) INTO n FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name IN ('majordhome_appointments', 'majordhome_lead_pennylane_quotes')
     AND c.column_name = 'chantier_id'
     AND c.ordinal_position = (SELECT max(ordinal_position) FROM information_schema.columns c2 WHERE c2.table_schema = c.table_schema AND c2.table_name = c.table_name);
  IF n <> 2 THEN RAISE EXCEPTION 'chantier_id doit être la dernière colonne des deux vues'; END IF;

  -- security_invoker
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE (ns.nspname, c.relname) IN (('public', 'majordhome_chantiers'), ('public', 'majordhome_chantiers_write'),
            ('public', 'majordhome_appointments'), ('public', 'majordhome_lead_pennylane_quotes'), ('majordhome', 'chantier_quote_stats'))
     AND c.reloptions::text LIKE '%security_invoker=true%';
  IF n <> 5 THEN RAISE EXCEPTION 'security_invoker attendu sur 5 vues, trouvé %', n; END IF;

  -- RLS + ACL
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.chantiers'::regclass) THEN RAISE EXCEPTION 'RLS chantiers inactive'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'chantiers';
  IF n <> 2 THEN RAISE EXCEPTION 'policies chantiers attendues 2, trouvé %', n; END IF;
  IF has_table_privilege('anon', 'majordhome.chantiers', 'SELECT') THEN RAISE EXCEPTION 'anon lit chantiers'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.chantiers', 'INSERT') THEN RAISE EXCEPTION 'authenticated insère chantiers'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.chantiers', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur chantiers'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_chantiers_write', 'UPDATE') THEN RAISE EXCEPTION 'authenticated sans UPDATE sur la vue write'; END IF;

  -- UPDATE par colonne : pas de re-pointage de lead_id / org_id / client_id
  IF has_column_privilege('authenticated', 'majordhome.chantiers', 'lead_id', 'UPDATE') THEN RAISE EXCEPTION 'authenticated peut re-pointer lead_id'; END IF;
  IF has_column_privilege('authenticated', 'majordhome.chantiers', 'org_id', 'UPDATE') THEN RAISE EXCEPTION 'authenticated peut re-pointer org_id'; END IF;
  IF has_column_privilege('authenticated', 'majordhome.chantiers', 'client_id', 'UPDATE') THEN RAISE EXCEPTION 'authenticated peut re-pointer client_id'; END IF;
  IF NOT has_column_privilege('authenticated', 'majordhome.chantiers', 'chantier_status', 'UPDATE') THEN RAISE EXCEPTION 'authenticated sans UPDATE sur chantier_status'; END IF;

  -- anon : aucune lecture des vues chantiers
  IF has_table_privilege('anon', 'public.majordhome_chantiers', 'SELECT') THEN RAISE EXCEPTION 'anon lit majordhome_chantiers'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_chantiers_write', 'SELECT') THEN RAISE EXCEPTION 'anon lit majordhome_chantiers_write'; END IF;

  RAISE NOTICE 'assert-chantiers §A : OK';
END $$;

-- ── §B Trigger + RPC (20260930_17) ─────────────────────────────────────────────
-- Helper de refus : exécute le SQL, exige l'échec ET le message exact (+ SQLSTATE). Une autre cause, ou
-- l'absence d'échec, lève une exception qui cite le message reçu : un refus ne « passe » jamais par hasard.
CREATE OR REPLACE FUNCTION pg_temp.expect_err(p_label text, p_sql text, p_msg text, p_state text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_ok boolean := false; v_got text; v_st text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_got = MESSAGE_TEXT, v_st = RETURNED_SQLSTATE;
  END;
  IF v_ok THEN RAISE EXCEPTION '% : devait échouer avec « % » mais a réussi', p_label, p_msg; END IF;
  IF v_got IS DISTINCT FROM p_msg OR v_st IS DISTINCT FROM p_state THEN
    RAISE EXCEPTION '% : attendu « % » (%), reçu « % » (%)', p_label, p_msg, p_state, v_got, v_st;
  END IF;
END $f$;

DO $$
DECLARE
  v_org    uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_gouin  uuid := '11111111-1111-1111-1111-111111111111';
  v_admin uuid; v_tech uuid; v_outsider uuid := gen_random_uuid();
  v_mh_org uuid;
  v_origin uuid; v_new uuid; v_ch2 uuid; v_ch10 uuid; v_ch11 uuid; v_ch4 uuid; v_lead2 uuid; v_res jsonb;
  n int; v_label text; v_status text; v_amount numeric; v_bool boolean; r record;
BEGIN
  SELECT id INTO v_mh_org FROM majordhome.organizations WHERE core_org_id = v_org;
  SELECT om.user_id INTO v_admin FROM core.organization_members om WHERE om.org_id = v_org AND om.role = 'org_admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'aucun org_admin Mayer dans le snapshot'; END IF;
  -- Membre SANS droit chantiers.edit : on le cherche dans le snapshot (technicien / commercial), role_can tranche.
  FOR r IN SELECT om.user_id FROM core.organization_members om WHERE om.org_id = v_org AND om.role <> 'org_admin' LOOP
    PERFORM set_config('request.jwt.claim.sub', r.user_id::text, true);
    IF majordhome.role_can(v_org, 'chantiers', 'edit') IS FALSE THEN v_tech := r.user_id; EXIT; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_tech IS NULL THEN RAISE EXCEPTION 'aucun membre sans droit chantiers.edit dans le snapshot'; END IF;

  SELECT id INTO v_origin FROM majordhome.chantiers WHERE lead_id = v_gouin;
  SELECT id INTO v_ch4 FROM majordhome.chantiers WHERE lead_id = '44444444-4444-4444-4444-444444444444';

  -- B0. order_status_min : commande l'emporte, sinon recu, sinon na ; NULL ignoré
  IF majordhome.order_status_min('na', 'commande') IS DISTINCT FROM 'commande'
     OR majordhome.order_status_min('commande', 'recu') IS DISTINCT FROM 'commande'
     OR majordhome.order_status_min('recu', 'na') IS DISTINCT FROM 'recu'
     OR majordhome.order_status_min('na', 'na') IS DISTINCT FROM 'na'
     OR majordhome.order_status_min(NULL, 'recu') IS DISTINCT FROM 'recu'
     OR majordhome.order_status_min('na', NULL) IS DISTINCT FROM 'na'
     OR majordhome.order_status_min(NULL, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'B0 : order_status_min incorrect';
  END IF;

  -- B1. Trigger : le devis en attente (…09, déjà dans la fixture) ne crée rien ; son passage en accepté crée un SECOND chantier
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 1 THEN RAISE EXCEPTION 'B1 : un devis en attente ne doit pas créer de chantier'; END IF;
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'accepted' WHERE id = 'aaaa0001-0000-0000-0000-000000000009';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 2 THEN RAISE EXCEPTION 'B1 : devis accepté → 2 chantiers attendus, trouvé %', n; END IF;
  SELECT c.id, c.label, c.chantier_status INTO v_ch2, v_label, v_status FROM majordhome.chantiers c
   JOIN majordhome.lead_pennylane_quotes q ON q.chantier_id = c.id WHERE q.id = 'aaaa0001-0000-0000-0000-000000000009';
  IF v_label <> 'Poêle à granulés' OR v_status <> 'gagne' THEN RAISE EXCEPTION 'B1 : label/statut du chantier créé (% / %)', v_label, v_status; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_activities WHERE lead_id = v_gouin AND activity_type = 'chantier_created';
  IF n <> 1 THEN RAISE EXCEPTION 'B1 : activité chantier_created attendue'; END IF;

  -- Garde « chantier_id déjà posé » : …09 est rattaché, le passage accepted → invoiced ne crée rien
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'invoiced' WHERE id = 'aaaa0001-0000-0000-0000-000000000009';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 2 THEN RAISE EXCEPTION 'B1 : devis déjà rattaché (chantier_id posé) ne doit rien créer'; END IF;
  -- Garde de TRANSITION : …09 validé, SANS chantier, repasse accepted (invoiced → accepted, validé → validé) → rien
  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = NULL WHERE id = 'aaaa0001-0000-0000-0000-000000000009';
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'accepted' WHERE id = 'aaaa0001-0000-0000-0000-000000000009';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 2 THEN RAISE EXCEPTION 'B1 : transition validé→validé sans chantier ne doit rien créer, trouvé % chantiers', n; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes WHERE id = 'aaaa0001-0000-0000-0000-000000000009' AND chantier_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'B1 : le trigger a rattaché un devis validé→validé'; END IF;
  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = v_ch2 WHERE id = 'aaaa0001-0000-0000-0000-000000000009';
  -- RENOU : vieux devis facturé, retouché par le cron, toujours aucun chantier
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'invoiced' WHERE id = 'aaaa0003-0000-0000-0000-000000000001';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '33333333-3333-3333-3333-333333333333';
  IF n <> 0 THEN RAISE EXCEPTION 'B1 : RENOU ne doit pas recevoir de chantier rétroactif'; END IF;
  -- Le devis validé ÉJECTÉ (…04), retouché, ne crée rien non plus
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'accepted' WHERE id = 'aaaa0001-0000-0000-0000-000000000004';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 2 THEN RAISE EXCEPTION 'B1 : un devis éjecté ne doit pas créer de chantier'; END IF;

  -- B1a. Déclenchement par is_winning_quote SEUL (lead_mark_won_with_quote) : l'invariant BEFORE force accepted
  INSERT INTO majordhome.lead_pennylane_quotes (id, org_id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, assigned_at)
  VALUES ('aaaa0001-0000-0000-0000-000000000010', v_org, v_gouin, 40000000000002, 1447384297472, 2000, 'D-2026-09998', DATE '2026-10-01', 'pending', false, now());
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 2 THEN RAISE EXCEPTION 'B1a : un devis pending ne crée rien, trouvé % chantiers', n; END IF;
  UPDATE majordhome.lead_pennylane_quotes SET is_winning_quote = true WHERE id = 'aaaa0001-0000-0000-0000-000000000010';
  SELECT q.quote_status, q.chantier_id INTO v_status, v_ch10 FROM majordhome.lead_pennylane_quotes q WHERE q.id = 'aaaa0001-0000-0000-0000-000000000010';
  IF v_status <> 'accepted' THEN RAISE EXCEPTION 'B1a : l''invariant devait forcer accepted, trouvé %', v_status; END IF;
  IF v_ch10 IS NULL THEN RAISE EXCEPTION 'B1a : is_winning_quote seul devait créer un chantier'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 3 THEN RAISE EXCEPTION 'B1a : 3 chantiers attendus, trouvé %', n; END IF;

  -- B1b. INSERT directement validé : chantier créé sur-le-champ, chantier_id posé sur la ligne
  INSERT INTO majordhome.lead_pennylane_quotes (id, org_id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, assigned_at)
  VALUES ('aaaa0001-0000-0000-0000-000000000011', v_org, v_gouin, 40000000000003, 1447384297472, 3000, 'D-2026-09997', DATE '2026-10-01', 'accepted', false, now());
  SELECT q.chantier_id INTO v_ch11 FROM majordhome.lead_pennylane_quotes q WHERE q.id = 'aaaa0001-0000-0000-0000-000000000011';
  IF v_ch11 IS NULL THEN RAISE EXCEPTION 'B1b : INSERT d''un devis accepté devait créer un chantier et le rattacher'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 4 THEN RAISE EXCEPTION 'B1b : 4 chantiers attendus, trouvé %', n; END IF;

  -- B2. Gardes des 4 RPC : non authentifié (auth.uid() NULL), puis non-membre, puis membre sans droit chantiers.edit
  PERFORM pg_temp.expect_err('B2 group sans uid', format('SELECT public.chantier_group(%L, ARRAY[%L]::uuid[])', v_origin, v_ch2), 'unauthenticated', '42501');
  PERFORM pg_temp.expect_err('B2 detach sans uid', format('SELECT public.chantier_detach(%L, ARRAY[%L]::uuid[], NULL, false, NULL)', v_origin, 'aaaa0001-0000-0000-0000-000000000002'), 'unauthenticated', '42501');
  PERFORM pg_temp.expect_err('B2 delete sans uid', format('SELECT public.chantier_delete(%L)', v_ch10), 'unauthenticated', '42501');
  PERFORM pg_temp.expect_err('B2 ensure sans uid', 'SELECT public.chantier_ensure_for_lead(''22222222-2222-2222-2222-222222222222'')', 'unauthenticated', '42501');
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM pg_temp.expect_err('B2 group non-membre', format('SELECT public.chantier_group(%L, ARRAY[%L]::uuid[])', v_origin, v_ch2), 'not_authorized', '42501');
  PERFORM pg_temp.expect_err('B2 detach non-membre', format('SELECT public.chantier_detach(%L, ARRAY[%L]::uuid[], NULL, false, NULL)', v_origin, 'aaaa0001-0000-0000-0000-000000000002'), 'not_authorized', '42501');
  PERFORM pg_temp.expect_err('B2 delete non-membre', format('SELECT public.chantier_delete(%L)', v_ch10), 'not_authorized', '42501');
  PERFORM pg_temp.expect_err('B2 ensure non-membre', 'SELECT public.chantier_ensure_for_lead(''22222222-2222-2222-2222-222222222222'')', 'not_authorized', '42501');
  -- Membre de l'org mais sans chantiers.edit (technicien / commercial du snapshot)
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, true);
  PERFORM pg_temp.expect_err('B2 group sans droit edit', format('SELECT public.chantier_group(%L, ARRAY[%L]::uuid[])', v_origin, v_ch2), 'not_authorized', '42501');
  PERFORM pg_temp.expect_err('B2 detach sans droit edit', format('SELECT public.chantier_detach(%L, ARRAY[%L]::uuid[], NULL, false, NULL)', v_origin, 'aaaa0001-0000-0000-0000-000000000002'), 'not_authorized', '42501');
  PERFORM pg_temp.expect_err('B2 delete sans droit edit', format('SELECT public.chantier_delete(%L)', v_ch10), 'not_authorized', '42501');
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 4 THEN RAISE EXCEPTION 'B2 : un refus ne doit rien modifier, % chantiers', n; END IF;

  -- B3. Refus de chantier_delete : RDV actif, PV, puis suppression autorisée (chantier …10 = devis éjecté + RDV + PV)
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  INSERT INTO majordhome.appointments (id, org_id, lead_id, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, client_name)
  VALUES ('bbbb0001-0000-0000-0000-000000000006', v_mh_org, v_gouin, 'installation', DATE '2026-12-01', TIME '08:00', TIME '17:00', 540, 'scheduled', 'GOUIN');
  UPDATE majordhome.appointments SET chantier_id = v_ch10 WHERE id = 'bbbb0001-0000-0000-0000-000000000006';
  PERFORM pg_temp.expect_err('B3 delete avec devis validé', format('SELECT public.chantier_delete(%L)', v_ch10), 'has_validated_quotes', '22023');
  UPDATE majordhome.lead_pennylane_quotes SET ejected_at = now(), ejected_reason = 'manual_ui' WHERE id = 'aaaa0001-0000-0000-0000-000000000010';
  PERFORM pg_temp.expect_err('B3 delete avec RDV actif', format('SELECT public.chantier_delete(%L)', v_ch10), 'has_appointments', '22023');
  UPDATE majordhome.appointments SET status = 'cancelled' WHERE id = 'bbbb0001-0000-0000-0000-000000000006';
  UPDATE majordhome.chantiers SET pv_reception_path = 'org/pv-test.pdf' WHERE id = v_ch10;
  PERFORM pg_temp.expect_err('B3 delete avec PV', format('SELECT public.chantier_delete(%L)', v_ch10), 'has_pv', '22023');
  UPDATE majordhome.chantiers SET pv_reception_path = NULL WHERE id = v_ch10;
  v_res := public.chantier_delete(v_ch10);
  IF (v_res->>'quotes_released')::int <> 1 THEN RAISE EXCEPTION 'B3 : 1 devis (éjecté) libéré attendu, %', v_res; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_ch10;
  IF n <> 0 THEN RAISE EXCEPTION 'B3 : chantier_delete n''a pas supprimé'; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments WHERE id = 'bbbb0001-0000-0000-0000-000000000006' AND chantier_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'B3 : le RDV annulé doit être détaché du chantier supprimé'; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_activities WHERE lead_id = v_gouin AND activity_type = 'chantier_deleted';
  IF n <> 1 THEN RAISE EXCEPTION 'B3 : activité chantier_deleted attendue'; END IF;
  PERFORM pg_temp.expect_err('B3 delete introuvable', format('SELECT public.chantier_delete(%L)', v_ch10), 'chantier_not_found', 'P0002');
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 3 THEN RAISE EXCEPTION 'B3 : 3 chantiers attendus après suppression, trouvé %', n; END IF;

  -- B4. Détacher : refus nommés, puis la PAC + 3 RDV de novembre + commande
  PERFORM pg_temp.expect_err('B4 sélection vide', format('SELECT public.chantier_detach(%L, ARRAY[]::uuid[], NULL, false, NULL)', v_origin), 'invalid_selection', '22023');
  PERFORM pg_temp.expect_err('B4 chantier introuvable', format('SELECT public.chantier_detach(%L, ARRAY[%L]::uuid[], NULL, false, NULL)', gen_random_uuid(), 'aaaa0001-0000-0000-0000-000000000002'), 'chantier_not_found', 'P0002');
  -- devis non rattaché à ce chantier (le refusé …03 n'appartient à aucun chantier)
  PERFORM pg_temp.expect_err('B4 devis étranger', format('SELECT public.chantier_detach(%L, ARRAY[%L]::uuid[], NULL, false, NULL)', v_origin, 'aaaa0001-0000-0000-0000-000000000003'), 'invalid_quotes', '22023');
  -- refusé seul : rattaché au chantier pour atteindre la vraie règle « aucun devis validé sélectionné »
  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = v_origin WHERE id = 'aaaa0001-0000-0000-0000-000000000003';
  PERFORM pg_temp.expect_err('B4 refusé seul', format('SELECT public.chantier_detach(%L, ARRAY[%L]::uuid[], NULL, false, NULL)', v_origin, 'aaaa0001-0000-0000-0000-000000000003'), 'no_validated_quote_selected', '22023');
  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = NULL WHERE id = 'aaaa0001-0000-0000-0000-000000000003';
  PERFORM pg_temp.expect_err('B4 vider l''origine', format('SELECT public.chantier_detach(%L, ARRAY[%L, %L]::uuid[], NULL, false, NULL)', v_origin, 'aaaa0001-0000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000002'), 'origin_would_be_empty', '22023');
  -- RDV non installation / non rattaché à l'origine
  PERFORM pg_temp.expect_err('B4 RDV invalide', format('SELECT public.chantier_detach(%L, ARRAY[%L]::uuid[], ARRAY[%L]::uuid[], false, NULL)', v_origin, 'aaaa0001-0000-0000-0000-000000000002', 'bbbb0001-0000-0000-0000-000000000005'), 'invalid_appointments', '22023');
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 3 THEN RAISE EXCEPTION 'B4 : les refus ne doivent rien créer, % chantiers', n; END IF;

  v_res := public.chantier_detach(v_origin, ARRAY['aaaa0001-0000-0000-0000-000000000002'::uuid],
             ARRAY['bbbb0001-0000-0000-0000-000000000002'::uuid, 'bbbb0001-0000-0000-0000-000000000003'::uuid, 'bbbb0001-0000-0000-0000-000000000004'::uuid],
             true, NULL);
  v_new := (v_res->>'new_chantier_id')::uuid;
  IF (v_res->'counts'->>'quotes')::int <> 1 OR (v_res->'counts'->>'appointments')::int <> 3 OR (v_res->'counts'->>'line_receptions')::int <> 1 THEN
    RAISE EXCEPTION 'B4 : compteurs de détachement %', v_res;
  END IF;
  SELECT linked_quotes_amount_ht, is_invoiced INTO v_amount, v_bool FROM public.majordhome_chantiers WHERE id = v_origin;
  IF v_amount <> 1260.76 OR NOT v_bool THEN RAISE EXCEPTION 'B4 : origine attendue 1260.76 facturée, trouvé % / %', v_amount, v_bool; END IF;
  SELECT linked_quotes_amount_ht, is_invoiced INTO v_amount, v_bool FROM public.majordhome_chantiers WHERE id = v_new;
  IF v_amount <> 11540 OR v_bool THEN RAISE EXCEPTION 'B4 : nouveau attendu 11540 non facturé, trouvé % / %', v_amount, v_bool; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_new AND chantier_status = 'planification'
     AND planned_team_size = 2 AND planned_days = 3 AND label = 'Installation d''une pompe à chaleur DAIKIN' AND won_date = DATE '2026-09-30';
  IF n <> 1 THEN RAISE EXCEPTION 'B4 : nouveau chantier (statut / commande / libellé / won_date) incorrect'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_origin AND planned_team_size IS NULL AND planned_days IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'B4 : la commande devait quitter l''origine'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_origin AND target_invoiced;
  IF n <> 1 THEN RAISE EXCEPTION 'B4 : le RDV de la borne doit être violet'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_new AND target_invoiced;
  IF n <> 0 THEN RAISE EXCEPTION 'B4 : les RDV de la PAC ne doivent pas être violets'; END IF;
  SELECT lead_chantiers_count INTO n FROM public.majordhome_chantiers WHERE id = v_new;
  IF n <> 4 THEN RAISE EXCEPTION 'B4 : lead_chantiers_count attendu 4, trouvé %', n; END IF;

  -- B5. Grouper : refus nommés, puis tout regrouper (avec un doublon dans la sélection)
  PERFORM pg_temp.expect_err('B5 cible = source', format('SELECT public.chantier_group(%L, ARRAY[%L]::uuid[])', v_origin, v_origin), 'invalid_selection', '22023');
  PERFORM pg_temp.expect_err('B5 sélection vide', format('SELECT public.chantier_group(%L, ARRAY[]::uuid[])', v_origin), 'invalid_selection', '22023');
  PERFORM pg_temp.expect_err('B5 cible introuvable', format('SELECT public.chantier_group(%L, ARRAY[%L]::uuid[])', gen_random_uuid(), v_ch2), 'chantier_not_found', 'P0002');
  PERFORM pg_temp.expect_err('B5 source introuvable', format('SELECT public.chantier_group(%L, ARRAY[%L]::uuid[])', v_origin, gen_random_uuid()), 'chantier_not_found', 'P0002');
  PERFORM pg_temp.expect_err('B5 autre lead', format('SELECT public.chantier_group(%L, ARRAY[%L]::uuid[])', v_origin, v_ch4), 'different_lead', '22023');
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 4 THEN RAISE EXCEPTION 'B5 : les refus ne doivent rien supprimer, % chantiers', n; END IF;
  v_res := public.chantier_group(v_origin, ARRAY[v_new, v_ch2, v_new, v_ch11]);
  IF (v_res->'counts'->>'quotes')::int <> 3 OR (v_res->'counts'->>'appointments')::int <> 3 OR (v_res->'counts'->>'line_receptions')::int <> 1 THEN
    RAISE EXCEPTION 'B5 : compteurs de groupement %', v_res;
  END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = v_gouin;
  IF n <> 1 THEN RAISE EXCEPTION 'B5 : après groupement 1 chantier attendu, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments WHERE chantier_id = v_origin;
  IF n <> 4 THEN RAISE EXCEPTION 'B5 : 4 RDV attendus sur la cible, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_origin AND planned_team_size = 2 AND planned_days = 3 AND chantier_status = 'planification';
  IF n <> 1 THEN RAISE EXCEPTION 'B5 : la cible doit reprendre commande et statut le plus avancé'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_chantiers WHERE id = v_origin AND validated_quotes_count = 4 AND linked_quotes_amount_ht = 20300.76;
  IF n <> 1 THEN RAISE EXCEPTION 'B5 : 4 devis validés / 20300.76 attendus sur la cible'; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_activities WHERE lead_id = v_gouin AND activity_type = 'chantier_grouped';
  IF n <> 1 THEN RAISE EXCEPTION 'B5 : activité chantier_grouped attendue'; END IF;

  -- B5b. Plafond : une source forcée en « facture » ne rend PAS la cible facturée tant que tous ses devis validés ne le sont pas
  v_res := public.chantier_detach(v_origin, ARRAY['aaaa0001-0000-0000-0000-000000000002'::uuid], NULL, false, NULL);
  v_new := (v_res->>'new_chantier_id')::uuid;
  UPDATE majordhome.chantiers SET chantier_status = 'facture' WHERE id = v_new;
  PERFORM public.chantier_group(v_origin, ARRAY[v_new]);
  SELECT chantier_status INTO v_status FROM majordhome.chantiers WHERE id = v_origin;
  IF v_status IS DISTINCT FROM 'realise' THEN RAISE EXCEPTION 'B5b : groupe non intégralement facturé, statut plafonné à realise attendu, trouvé %', v_status; END IF;

  -- B6. Gain sans devis : ensure_for_lead crée puis renvoie le même id ; lead introuvable / supprimé refusés
  v_lead2 := public.chantier_ensure_for_lead('22222222-2222-2222-2222-222222222222');
  IF v_lead2 <> public.chantier_ensure_for_lead('22222222-2222-2222-2222-222222222222') THEN RAISE EXCEPTION 'B6 : ensure_for_lead non idempotent'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '22222222-2222-2222-2222-222222222222' AND chantier_status = 'gagne';
  IF n <> 1 THEN RAISE EXCEPTION 'B6 : chantier sans devis attendu'; END IF;
  PERFORM pg_temp.expect_err('B6 lead introuvable', format('SELECT public.chantier_ensure_for_lead(%L)', gen_random_uuid()), 'lead_not_found', 'P0002');
  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, is_deleted)
  VALUES ('55555555-5555-5555-5555-555555555555', v_org, 'LEAD', 'SUPPRIME', true);
  PERFORM pg_temp.expect_err('B6 lead supprimé', 'SELECT public.chantier_ensure_for_lead(''55555555-5555-5555-5555-555555555555'')', 'lead_deleted', '22023');
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '55555555-5555-5555-5555-555555555555';
  IF n <> 0 THEN RAISE EXCEPTION 'B6 : un lead supprimé ne doit pas recevoir de chantier'; END IF;
  -- vide → supprimable
  v_res := public.chantier_delete(v_lead2);
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '22222222-2222-2222-2222-222222222222';
  IF n <> 0 THEN RAISE EXCEPTION 'B6 : chantier_delete n''a pas supprimé'; END IF;

  -- B7. ACL des RPC : fermées à anon (PUBLIC compris), ouvertes à authenticated
  IF has_function_privilege('anon', 'public.chantier_ensure_for_lead(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chantier_group(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chantier_detach(uuid, uuid[], uuid[], boolean, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chantier_delete(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B7 : une RPC chantier est exécutable par anon';
  END IF;
  IF NOT (has_function_privilege('authenticated', 'public.chantier_ensure_for_lead(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.chantier_group(uuid, uuid[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.chantier_detach(uuid, uuid[], uuid[], boolean, text)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.chantier_delete(uuid)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'B7 : une RPC chantier n''est pas exécutable par authenticated';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-chantiers §B : OK';
END $$;

-- ── §C lead_merge (20260930_18) ────────────────────────────────────────────────
-- lead_merge est recréée sans ses tables satellites (le harnais n'en photographie pas 16) : on vérifie donc le
-- TEXTE de la fonction et ses droits, sans l'appeler.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.lead_merge(uuid, uuid)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%UPDATE majordhome.chantiers%SET lead_id = p_survivor_id%' THEN
    RAISE EXCEPTION 'lead_merge ne re-parente pas majordhome.chantiers';
  END IF;
  IF v_def LIKE '%chantier_line_receptions SET chantier_id = p_survivor_id%' THEN
    RAISE EXCEPTION 'lead_merge re-parente encore chantier_line_receptions par lead';
  END IF;
  IF has_function_privilege('anon', 'public.lead_merge(uuid, uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'lead_merge exécutable par anon'; END IF;
  RAISE NOTICE 'assert-chantiers §C : OK';
END $$;
