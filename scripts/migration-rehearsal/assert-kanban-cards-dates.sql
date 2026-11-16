-- assert-kanban-cards-dates.sql — vérifie 20261117_2 (dates des devis sur majordhome_kanban_cards)
-- sur le cluster de répétition. Autonome : crée ses leads, ses devis rattachés et leur miroir
-- Pennylane. Un écart lève une exception.
DO $$
DECLARE
  v_org     uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_devis   uuid := '77777777-7777-7777-7777-000000000001'; -- un devis en attente + un refusé plus ancien
  v_perdu   uuid := '77777777-7777-7777-7777-000000000002'; -- deux devis refusés
  v_nu      uuid := '77777777-7777-7777-7777-000000000003'; -- aucun devis (carte « classic »)
  v_ejecte  uuid := '77777777-7777-7777-7777-000000000004'; -- un devis en attente + un devis éjecté plus ancien
  v_absent  uuid := '77777777-7777-7777-7777-000000000005'; -- devis refusé absent du miroir
  v_st_new  uuid;
  r record;
  n int;
BEGIN
  -- Structure : option, ACL, colonnes
  IF (SELECT (reloptions::text LIKE '%security_invoker=true%') FROM pg_class WHERE oid = 'public.majordhome_kanban_cards'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'majordhome_kanban_cards sans security_invoker';
  END IF;
  IF has_table_privilege('anon', 'public.majordhome_kanban_cards', 'SELECT') THEN
    RAISE EXCEPTION 'majordhome_kanban_cards lisible par anon';
  END IF;
  IF has_table_privilege('authenticated', 'public.majordhome_kanban_cards', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION 'majordhome_kanban_cards illisible par authenticated';
  END IF;
  IF has_table_privilege('service_role', 'public.majordhome_kanban_cards', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION 'majordhome_kanban_cards illisible par service_role';
  END IF;
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'majordhome_kanban_cards';
  IF n <> 15 THEN RAISE EXCEPTION 'majordhome_kanban_cards : 15 colonnes attendues, % trouvées', n; END IF;
  -- Les 12 premières colonnes n'ont pas bougé (placement et montants intacts)
  IF (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'majordhome_kanban_cards' AND ordinal_position <= 12)
     <> 'card_key,lead_id,org_id,card_type,column_key,devis_count,total_amount,pending_count,accepted_count,refused_count,next_rdv_date,has_active_rdv' THEN
    RAISE EXCEPTION 'les 12 premières colonnes de majordhome_kanban_cards ont changé';
  END IF;
  IF (SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'majordhome_kanban_cards' AND ordinal_position > 12)
     <> 'first_quote_date:date,quotes_validated_at:timestamp with time zone,quotes_refused_at:timestamp with time zone' THEN
    RAISE EXCEPTION 'colonnes de dates inattendues en fin de majordhome_kanban_cards';
  END IF;

  -- Données
  SELECT id INTO v_st_new FROM majordhome.statuses WHERE display_order = 1 LIMIT 1;
  IF v_st_new IS NULL THEN RAISE EXCEPTION 'statut « Nouveau » introuvable'; END IF;
  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, status_id, is_deleted)
  VALUES (v_devis,  v_org, 'TEST', 'DATES-DEVIS',  v_st_new, false),
         (v_perdu,  v_org, 'TEST', 'DATES-PERDU',  v_st_new, false),
         (v_nu,     v_org, 'TEST', 'DATES-NU',     v_st_new, false),
         (v_ejecte, v_org, 'TEST', 'DATES-EJECTE', v_st_new, false),
         (v_absent, v_org, 'TEST', 'DATES-ABSENT', v_st_new, false);

  INSERT INTO majordhome.pennylane_quotes (org_id, pennylane_quote_id, status, pl_updated_at)
  VALUES (v_org, 990000001, 'pending', TIMESTAMPTZ '2026-10-20 09:00+00'),
         (v_org, 990000002, 'denied',  TIMESTAMPTZ '2026-10-05 09:00+00'),
         (v_org, 990000003, 'denied',  TIMESTAMPTZ '2026-09-12 09:00+00'),
         (v_org, 990000004, 'denied',  TIMESTAMPTZ '2026-10-28 15:30+00'),
         (v_org, 990000005, 'pending', TIMESTAMPTZ '2026-11-02 09:00+00'),
         (v_org, 990000006, 'pending', TIMESTAMPTZ '2026-08-02 09:00+00');
         -- 990000007 (lead v_absent) volontairement absent du miroir

  INSERT INTO majordhome.lead_pennylane_quotes (org_id, lead_id, pennylane_quote_id, quote_amount_ht, quote_date, quote_status, ejected_at)
  VALUES (v_org, v_devis,  990000001, 4000, DATE '2026-10-18', 'pending', NULL),
         (v_org, v_devis,  990000002, 3500, DATE '2026-09-30', 'denied',  NULL),
         (v_org, v_perdu,  990000003, 2000, DATE '2026-09-01', 'denied',  NULL),
         (v_org, v_perdu,  990000004, 2500, DATE '2026-10-10', 'denied',  NULL),
         (v_org, v_ejecte, 990000005, 1000, DATE '2026-11-01', 'pending', NULL),
         (v_org, v_ejecte, 990000006, 9000, DATE '2026-08-01', 'pending', TIMESTAMPTZ '2026-08-15 00:00+00'),
         (v_org, v_absent, 990000007, 1500, DATE '2026-07-07', 'denied',  NULL);

  -- 1. Devis envoyé : la date est celle du PREMIER devis du lead, refusé compris
  SELECT count(*) INTO n FROM public.majordhome_kanban_cards WHERE lead_id = v_devis;
  IF n <> 1 THEN RAISE EXCEPTION 'v_devis : 1 carte attendue, % trouvées', n; END IF;
  SELECT * INTO r FROM public.majordhome_kanban_cards WHERE lead_id = v_devis;
  IF r.column_key <> 'devis_envoye' OR r.devis_count <> 1 OR r.total_amount <> 4000 THEN
    RAISE EXCEPTION 'v_devis : placement modifié (% / % / %)', r.column_key, r.devis_count, r.total_amount;
  END IF;
  IF r.first_quote_date IS DISTINCT FROM DATE '2026-09-30' THEN
    RAISE EXCEPTION 'v_devis : 1er devis attendu le 2026-09-30, trouvé %', r.first_quote_date;
  END IF;
  IF r.quotes_refused_at IS DISTINCT FROM TIMESTAMPTZ '2026-10-05 09:00+00' OR r.quotes_validated_at IS NOT NULL THEN
    RAISE EXCEPTION 'v_devis : dates de refus / validation inattendues (% / %)', r.quotes_refused_at, r.quotes_validated_at;
  END IF;

  -- 2. Perdu par Pennylane : la date est celle du DERNIER refus
  SELECT * INTO r FROM public.majordhome_kanban_cards WHERE lead_id = v_perdu;
  IF r.column_key <> 'perdu' OR r.devis_count <> 2 THEN
    RAISE EXCEPTION 'v_perdu : placement modifié (% / %)', r.column_key, r.devis_count;
  END IF;
  IF r.quotes_refused_at IS DISTINCT FROM TIMESTAMPTZ '2026-10-28 15:30+00' THEN
    RAISE EXCEPTION 'v_perdu : dernier refus attendu le 2026-10-28, trouvé %', r.quotes_refused_at;
  END IF;
  IF r.first_quote_date IS DISTINCT FROM DATE '2026-09-01' THEN
    RAISE EXCEPTION 'v_perdu : 1er devis attendu le 2026-09-01, trouvé %', r.first_quote_date;
  END IF;

  -- 3. Carte sans devis : placée par le statut, trois dates NULL
  SELECT * INTO r FROM public.majordhome_kanban_cards WHERE lead_id = v_nu;
  IF r.column_key <> 'nouveau' OR r.card_key <> v_nu::text || ':classic' THEN
    RAISE EXCEPTION 'v_nu : carte classique attendue en « nouveau », trouvé % / %', r.column_key, r.card_key;
  END IF;
  IF r.first_quote_date IS NOT NULL OR r.quotes_validated_at IS NOT NULL OR r.quotes_refused_at IS NOT NULL THEN
    RAISE EXCEPTION 'v_nu : une carte sans devis porte une date de devis';
  END IF;

  -- 4. Un devis éjecté ne date rien
  SELECT * INTO r FROM public.majordhome_kanban_cards WHERE lead_id = v_ejecte;
  IF r.first_quote_date IS DISTINCT FROM DATE '2026-11-01' THEN
    RAISE EXCEPTION 'v_ejecte : le devis éjecté a daté la carte (%)', r.first_quote_date;
  END IF;

  -- 5. Devis refusé absent du miroir : la carte reste en Perdu, sans date de refus (repli côté écran)
  SELECT * INTO r FROM public.majordhome_kanban_cards WHERE lead_id = v_absent;
  IF r.column_key <> 'perdu' THEN RAISE EXCEPTION 'v_absent : carte attendue en « perdu », trouvé %', r.column_key; END IF;
  IF r.quotes_refused_at IS NOT NULL OR r.first_quote_date IS DISTINCT FROM DATE '2026-07-07' THEN
    RAISE EXCEPTION 'v_absent : dates inattendues (% / %)', r.quotes_refused_at, r.first_quote_date;
  END IF;

  RAISE NOTICE 'assert-kanban-cards-dates : OK';
END $$;
