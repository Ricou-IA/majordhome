-- assert-chantiers.sql — vérifie 20260930_11 (§A), 20260930_12 (§B), 20260930_13 (§C) sur le cluster
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
