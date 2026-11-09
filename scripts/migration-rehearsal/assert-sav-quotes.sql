-- assert-sav-quotes.sql — vérifie 20261109_2_sav_quotes.sql sur le cluster de répétition.
-- Un écart lève une exception → run.mjs sort en ECHEC.

-- ── A. Structure ────────────────────────────────────────────────────────────
DO $$
DECLARE
  n int;
  v_upd text;
  v_last text;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'majordhome' AND table_name = 'quotes' AND column_name = 'intervention_id' AND data_type = 'uuid';
  IF n <> 1 THEN RAISE EXCEPTION 'colonne quotes.intervention_id absente'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'majordhome.quotes'::regclass AND contype = 'f'
                    AND confrelid = 'majordhome.interventions'::regclass AND confdeltype = 'n') THEN
    RAISE EXCEPTION 'FK quotes.intervention_id → interventions ON DELETE SET NULL absente';
  END IF;
  IF to_regclass('majordhome.quotes_intervention_id_idx') IS NULL THEN RAISE EXCEPTION 'index quotes_intervention_id_idx absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'majordhome.quotes'::regclass AND tgname = 'trg_quotes_check_intervention_org') THEN
    RAISE EXCEPTION 'trigger trg_quotes_check_intervention_org absent';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'majordhome.quotes_check_intervention_org()'::regprocedure) THEN
    RAISE EXCEPTION 'quotes_check_intervention_org doit rester SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'majordhome.quotes_check_intervention_org()', 'EXECUTE') THEN
    RAISE EXCEPTION 'quotes_check_intervention_org exécutable par anon';
  END IF;

  -- Vues : colonne en DERNIÈRE position
  SELECT c.column_name INTO v_last FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'majordhome_quotes' ORDER BY c.ordinal_position DESC LIMIT 1;
  IF v_last <> 'intervention_id' THEN RAISE EXCEPTION 'majordhome_quotes : dernière colonne %, attendu intervention_id', v_last; END IF;
  SELECT c.column_name INTO v_last FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'majordhome_quotes_write' ORDER BY c.ordinal_position DESC LIMIT 1;
  IF v_last <> 'intervention_id' THEN RAISE EXCEPTION 'majordhome_quotes_write : dernière colonne %, attendu intervention_id', v_last; END IF;
  SELECT c.column_name INTO v_last FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'majordhome_entretien_sav' ORDER BY c.ordinal_position DESC LIMIT 1;
  IF v_last <> 'sav_quotes' THEN RAISE EXCEPTION 'majordhome_entretien_sav : dernière colonne %, attendu sav_quotes', v_last; END IF;

  -- Le canal d'écriture des devis reste updatable
  SELECT is_updatable INTO v_upd FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_quotes_write';
  IF v_upd IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'majordhome_quotes_write non updatable (%)', v_upd; END IF;

  SELECT count(*) INTO n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('majordhome_quotes', 'majordhome_quotes_write', 'majordhome_entretien_sav')
     AND c.reloptions::text LIKE '%security_invoker=true%';
  IF n <> 3 THEN RAISE EXCEPTION 'security_invoker attendu sur 3 vues, trouvé %', n; END IF;

  -- Les colonnes déjà exposées par le kanban n'ont pas bougé
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_entretien_sav'
     AND column_name IN ('sav_urgency', 'anomalies', 'invoice_import_status', 'effective_contract_id', 'next_rdv_date', 'parts_detail');
  IF n <> 6 THEN RAISE EXCEPTION 'colonnes historiques de majordhome_entretien_sav attendues 6, trouvé %', n; END IF;

  -- La fonction de rattachement garde ses droits (service_role seul) et cite la nouvelle clause
  IF has_function_privilege('anon', 'public.pennylane_sync_auto_attach_pending(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pennylane_sync_auto_attach_pending(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'pennylane_sync_auto_attach_pending ouverte à anon / authenticated';
  END IF;
  IF pg_get_functiondef('public.pennylane_sync_auto_attach_pending(uuid, boolean)'::regprocedure) NOT LIKE '%nq.intervention_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'pennylane_sync_auto_attach_pending n''exclut pas les devis fléchés SAV';
  END IF;
END $$;

-- ── B. Comportement : devis fléché SAV ──────────────────────────────────────
DO $$
DECLARE
  v_org uuid;            -- org CORE d'un client réel du snapshot (celle de son projet)
  v_autre_org uuid := gen_random_uuid();
  v_client record;
  v_rdv uuid;
  v_sav uuid; v_lead uuid; v_quote uuid; v_quote2 uuid;
  v_res jsonb; v_card record; v_refuse boolean := false;
BEGIN
  SELECT id INTO v_rdv FROM majordhome.statuses WHERE label = 'RDV planifié' LIMIT 1;
  IF v_rdv IS NULL THEN RAISE EXCEPTION 'statut « RDV planifié » absent du snapshot'; END IF;

  -- Un client réel dont le projet résout une org, sans lead : il portera la carte SAV et une carte pipeline active.
  SELECT c.id, c.project_id, majordhome.project_org_id(c.project_id) AS org INTO v_client
    FROM majordhome.clients c
   WHERE c.project_id IS NOT NULL AND majordhome.project_org_id(c.project_id) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM majordhome.leads l WHERE l.client_id = c.id)
   ORDER BY c.created_at LIMIT 1;
  IF v_client.id IS NULL THEN RAISE EXCEPTION 'aucun client utilisable dans le snapshot'; END IF;
  v_org := v_client.org;
  INSERT INTO core.organizations (id, name, settings) VALUES (v_autre_org, 'Autre org (test SAV)', '{}'::jsonb);

  -- Carte SAV du client
  INSERT INTO majordhome.interventions (project_id, client_id, intervention_type, workflow_status, status, sav_description)
  VALUES (v_client.project_id, v_client.id, 'sav', 'demande', 'scheduled', 'panne (test)') RETURNING id INTO v_sav;

  -- 1. Garde d'organisation : un devis d'une AUTRE org ne peut pas viser cette carte
  BEGIN
    INSERT INTO majordhome.quotes (org_id, quote_number, client_id, intervention_id, total_ht) VALUES (v_autre_org, 'T-SAV-0', v_client.id, v_sav, 100);
  EXCEPTION WHEN insufficient_privilege THEN v_refuse := true;
  END;
  IF NOT v_refuse THEN RAISE EXCEPTION 'un devis d''une autre org a pu être fléché vers la carte'; END IF;

  -- 2. Devis fléchés : la carte les expose, du plus récent au plus ancien
  --    (quote_number fourni : le trigger de numérotation de prod n'est pas photographié)
  INSERT INTO majordhome.quotes (org_id, quote_number, client_id, intervention_id, total_ht, total_ttc, status, pennylane_quote_id, created_at)
  VALUES (v_org, 'T-SAV-1', v_client.id, v_sav, 1200, 1440, 'envoye', '9001', now() - interval '1 day') RETURNING id INTO v_quote;
  INSERT INTO majordhome.quotes (org_id, quote_number, client_id, intervention_id, total_ht, total_ttc, status, created_at)
  VALUES (v_org, 'T-SAV-2', v_client.id, v_sav, 300, 360, 'brouillon', now()) RETURNING id INTO v_quote2;

  SELECT sav_quotes, sav_urgency INTO v_card FROM public.majordhome_entretien_sav WHERE id = v_sav;
  IF jsonb_array_length(v_card.sav_quotes) <> 2 THEN RAISE EXCEPTION 'sav_quotes : 2 devis attendus, obtenu %', v_card.sav_quotes; END IF;
  IF (v_card.sav_quotes->0->>'id')::uuid <> v_quote2 OR (v_card.sav_quotes->1->>'id')::uuid <> v_quote THEN
    RAISE EXCEPTION 'sav_quotes : ordre attendu du plus récent au plus ancien, obtenu %', v_card.sav_quotes;
  END IF;
  IF (v_card.sav_quotes->1->>'total_ht')::numeric <> 1200 OR v_card.sav_quotes->1->>'status' <> 'envoye'
     OR v_card.sav_quotes->1->>'pennylane_quote_id' <> '9001' OR v_card.sav_quotes->0->>'quote_number' IS NULL THEN
    RAISE EXCEPTION 'sav_quotes : contenu inattendu %', v_card.sav_quotes;
  END IF;
  -- une carte sans devis expose un tableau vide, jamais NULL
  IF EXISTS (SELECT 1 FROM public.majordhome_entretien_sav WHERE sav_quotes IS NULL) THEN
    RAISE EXCEPTION 'sav_quotes NULL sur une carte sans devis';
  END IF;

  -- 3. Rattachement automatique : le client a une carte pipeline ACTIVE et son devis Pennylane
  --    dépasse le seuil — fléché SAV, il n'est même pas examiné.
  INSERT INTO majordhome.pennylane_sync (org_id, entity_type, local_id, pennylane_id, sync_status)
  VALUES (v_org, 'client', v_client.id, 990001, 'synced');
  INSERT INTO majordhome.leads (org_id, first_name, last_name, client_id, status_id, is_deleted)
  VALUES (v_org, 'Test', 'SAV-PIPELINE', v_client.id, v_rdv, false) RETURNING id INTO v_lead;
  INSERT INTO majordhome.pennylane_quotes (org_id, pennylane_quote_id, quote_number, status, quote_date, amount_ht, customer_id, customer_name, pl_created_at, synced_at)
  VALUES (v_org, 9001, 'D-9001', 'pending', CURRENT_DATE, 1200, 990001, 'TEST SAV', now(), now()),
         (v_org, 9002, 'D-9002', 'pending', CURRENT_DATE, 2500, 990001, 'TEST SAV', now(), now());

  v_res := public.pennylane_sync_auto_attach_pending(v_org, true);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'details') d WHERE (d->>'quote_pl_id')::bigint = 9001) THEN
    RAISE EXCEPTION 'le devis fléché SAV (9001) est proposé au rattachement : %', v_res->'details';
  END IF;
  -- le devis ordinaire du même client, lui, vise toujours la carte pipeline
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'details') d
                  WHERE (d->>'quote_pl_id')::bigint = 9002 AND (d->>'lead_id')::uuid = v_lead) THEN
    RAISE EXCEPTION 'le devis ordinaire (9002) doit toujours viser la carte pipeline : %', v_res->'details';
  END IF;

  -- 4. Défléché, le même devis redevient candidat (la clause ne porte que sur le fléchage)
  UPDATE majordhome.quotes SET intervention_id = NULL WHERE id = v_quote;
  v_res := public.pennylane_sync_auto_attach_pending(v_org, true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'details') d WHERE (d->>'quote_pl_id')::bigint = 9001) THEN
    RAISE EXCEPTION 'défléché, 9001 devrait redevenir candidat : %', v_res->'details';
  END IF;
  UPDATE majordhome.quotes SET intervention_id = v_sav WHERE id = v_quote;

  -- 5. Carte SAV supprimée : le devis survit, simplement défléché
  DELETE FROM majordhome.interventions WHERE id = v_sav;
  IF (SELECT count(*) FROM majordhome.quotes WHERE id IN (v_quote, v_quote2) AND intervention_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'suppression de la carte : les devis doivent survivre, défléchés';
  END IF;

  RAISE NOTICE 'assert-sav-quotes : OK';
END $$;
