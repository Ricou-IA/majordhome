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

-- ── §B Trigger + RPC (20260930_12) ─────────────────────────────────────────────
DO $$
DECLARE
  v_admin uuid; v_origin uuid; v_new uuid; v_ch2 uuid; v_lead2 uuid; v_res jsonb; n int; v_label text; v_status text;
  v_amount numeric; v_bool boolean;
BEGIN
  SELECT om.user_id INTO v_admin FROM core.organization_members om
   WHERE om.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1' AND om.role = 'org_admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'aucun org_admin Mayer dans le snapshot'; END IF;
  SELECT id INTO v_origin FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';

  -- B1. Trigger : le devis en attente (…09, déjà dans la fixture) ne crée rien ; son passage en accepté crée un SECOND chantier
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 1 THEN RAISE EXCEPTION 'B1 : un devis en attente ne doit pas créer de chantier'; END IF;
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'accepted' WHERE id = 'aaaa0001-0000-0000-0000-000000000009';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 2 THEN RAISE EXCEPTION 'B1 : devis accepté → 2 chantiers attendus, trouvé %', n; END IF;
  SELECT c.id, c.label, c.chantier_status INTO v_ch2, v_label, v_status FROM majordhome.chantiers c
   JOIN majordhome.lead_pennylane_quotes q ON q.chantier_id = c.id WHERE q.id = 'aaaa0001-0000-0000-0000-000000000009';
  IF v_label <> 'Poêle à granulés' OR v_status <> 'gagne' THEN RAISE EXCEPTION 'B1 : label/statut du chantier créé (% / %)', v_label, v_status; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_activities WHERE lead_id = '11111111-1111-1111-1111-111111111111' AND activity_type = 'chantier_created';
  IF n <> 1 THEN RAISE EXCEPTION 'B1 : activité chantier_created attendue'; END IF;
  -- Un UPDATE qui laisse le devis validé ne crée rien de plus (cron accepted → invoiced)
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'invoiced' WHERE id = 'aaaa0001-0000-0000-0000-000000000009';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 2 THEN RAISE EXCEPTION 'B1 : transition validé→validé ne doit rien créer'; END IF;
  -- RENOU : vieux devis facturé, retouché par le cron, toujours aucun chantier
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'invoiced' WHERE id = 'aaaa0003-0000-0000-0000-000000000001';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '33333333-3333-3333-3333-333333333333';
  IF n <> 0 THEN RAISE EXCEPTION 'B1 : RENOU ne doit pas recevoir de chantier rétroactif'; END IF;
  -- Le devis éjecté (…04) ne crée rien non plus, même retouché
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'accepted' WHERE id = 'aaaa0001-0000-0000-0000-000000000004';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 2 THEN RAISE EXCEPTION 'B1 : un devis éjecté ne doit pas créer de chantier'; END IF;

  -- B2. Gardes : non authentifié, puis membre inconnu
  BEGIN
    PERFORM public.chantier_group(v_origin, ARRAY[v_ch2]);
    RAISE EXCEPTION 'B2 : chantier_group sans auth.uid() devait échouer';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN
    PERFORM public.chantier_group(v_origin, ARRAY[v_ch2]);
    RAISE EXCEPTION 'B2 : chantier_group par un non-membre devait échouer';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;

  -- B3. org_admin : détacher la PAC + 3 RDV de novembre + commande
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.chantier_detach(v_origin, ARRAY['aaaa0001-0000-0000-0000-000000000003'::uuid], '{}'::uuid[], false, NULL);
    RAISE EXCEPTION 'B3 : détacher un devis refusé seul devait échouer';
  EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN
    PERFORM public.chantier_detach(v_origin, ARRAY['aaaa0001-0000-0000-0000-000000000001'::uuid, 'aaaa0001-0000-0000-0000-000000000002'::uuid], '{}'::uuid[], false, NULL);
    RAISE EXCEPTION 'B3 : vider l''origine devait échouer';
  EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  v_res := public.chantier_detach(v_origin, ARRAY['aaaa0001-0000-0000-0000-000000000002'::uuid],
             ARRAY['bbbb0001-0000-0000-0000-000000000002'::uuid, 'bbbb0001-0000-0000-0000-000000000003'::uuid, 'bbbb0001-0000-0000-0000-000000000004'::uuid],
             true, NULL);
  v_new := (v_res->>'new_chantier_id')::uuid;
  IF (v_res->'counts'->>'quotes')::int <> 1 OR (v_res->'counts'->>'appointments')::int <> 3 OR (v_res->'counts'->>'line_receptions')::int <> 1 THEN
    RAISE EXCEPTION 'B3 : compteurs de détachement %', v_res;
  END IF;
  SELECT linked_quotes_amount_ht, is_invoiced INTO v_amount, v_bool FROM public.majordhome_chantiers WHERE id = v_origin;
  IF v_amount <> 1260.76 OR NOT v_bool THEN RAISE EXCEPTION 'B3 : origine attendue 1260.76 facturée, trouvé % / %', v_amount, v_bool; END IF;
  SELECT linked_quotes_amount_ht, is_invoiced INTO v_amount, v_bool FROM public.majordhome_chantiers WHERE id = v_new;
  IF v_amount <> 11540 OR v_bool THEN RAISE EXCEPTION 'B3 : nouveau attendu 11540 non facturé, trouvé % / %', v_amount, v_bool; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_new AND chantier_status = 'planification'
     AND planned_team_size = 2 AND planned_days = 3 AND label = 'Installation d''une pompe à chaleur DAIKIN' AND won_date = DATE '2026-09-30';
  IF n <> 1 THEN RAISE EXCEPTION 'B3 : nouveau chantier (statut / commande / libellé / won_date) incorrect'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_origin AND planned_team_size IS NULL AND planned_days IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'B3 : la commande devait quitter l''origine'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_origin AND target_invoiced;
  IF n <> 1 THEN RAISE EXCEPTION 'B3 : le RDV de la borne doit être violet'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_new AND target_invoiced;
  IF n <> 0 THEN RAISE EXCEPTION 'B3 : les RDV de la PAC ne doivent pas être violets'; END IF;
  SELECT lead_chantiers_count INTO n FROM public.majordhome_chantiers WHERE id = v_new;
  IF n <> 3 THEN RAISE EXCEPTION 'B3 : lead_chantiers_count attendu 3, trouvé %', n; END IF;

  -- B4. Supprimer refusé (RDV / devis validé), puis grouper le tout → 1 chantier, commande revenue
  BEGIN
    PERFORM public.chantier_delete(v_new);
    RAISE EXCEPTION 'B4 : chantier_delete avec devis validé devait échouer';
  EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  v_res := public.chantier_group(v_origin, ARRAY[v_new, v_ch2]);
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 1 THEN RAISE EXCEPTION 'B4 : après groupement 1 chantier attendu, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments WHERE chantier_id = v_origin;
  IF n <> 4 THEN RAISE EXCEPTION 'B4 : 4 RDV attendus sur la cible, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_origin AND planned_team_size = 2 AND planned_days = 3 AND chantier_status = 'planification';
  IF n <> 1 THEN RAISE EXCEPTION 'B4 : la cible doit reprendre commande et statut le plus avancé'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_chantiers WHERE id = v_origin AND validated_quotes_count = 3 AND linked_quotes_amount_ht = 17300.76;
  IF n <> 1 THEN RAISE EXCEPTION 'B4 : 3 devis validés / 17300.76 attendus sur la cible'; END IF;

  -- B5. Gain sans devis : ensure_for_lead crée, puis renvoie le même id
  v_lead2 := public.chantier_ensure_for_lead('22222222-2222-2222-2222-222222222222');
  IF v_lead2 <> public.chantier_ensure_for_lead('22222222-2222-2222-2222-222222222222') THEN RAISE EXCEPTION 'B5 : ensure_for_lead non idempotent'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '22222222-2222-2222-2222-222222222222' AND chantier_status = 'gagne';
  IF n <> 1 THEN RAISE EXCEPTION 'B5 : chantier sans devis attendu'; END IF;
  -- vide → supprimable
  v_res := public.chantier_delete(v_lead2);
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '22222222-2222-2222-2222-222222222222';
  IF n <> 0 THEN RAISE EXCEPTION 'B5 : chantier_delete n''a pas supprimé'; END IF;

  -- B6. ACL des RPC
  IF has_function_privilege('anon', 'public.chantier_ensure_for_lead(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chantier_group(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chantier_detach(uuid, uuid[], uuid[], boolean, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chantier_delete(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B6 : une RPC chantier est exécutable par anon';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-chantiers §B : OK';
END $$;
