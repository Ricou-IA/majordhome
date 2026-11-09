-- assert-sav-urgency.sql — vérifie 20261109_1_sav_urgency.sql sur le cluster de répétition.
-- Un écart lève une exception → run.mjs sort en ECHEC.

DO $$
DECLARE
  n int;
  v_upd text;
  v_last text;
  v_def text;
BEGIN
  -- A. Colonne sur la table
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'majordhome' AND table_name = 'interventions'
     AND column_name = 'sav_urgency' AND data_type = 'text' AND is_nullable = 'YES';
  IF n <> 1 THEN RAISE EXCEPTION 'colonne interventions.sav_urgency absente'; END IF;

  -- B. Liste fermée
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conname = 'interventions_sav_urgency_check' AND conrelid = 'majordhome.interventions'::regclass;
  IF v_def IS NULL THEN RAISE EXCEPTION 'contrainte interventions_sav_urgency_check absente'; END IF;
  IF v_def NOT LIKE '%urgent%' OR v_def NOT LIKE '%normal%' OR v_def NOT LIKE '%peut_attendre%' THEN
    RAISE EXCEPTION 'contrainte sav_urgency : liste inattendue (%)', v_def;
  END IF;

  -- C. Les deux vues exposent la colonne, en DERNIÈRE position
  FOR v_last IN
    SELECT c.column_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name IN ('majordhome_interventions', 'majordhome_entretien_sav')
       AND c.ordinal_position = (SELECT max(c2.ordinal_position) FROM information_schema.columns c2
                                  WHERE c2.table_schema = c.table_schema AND c2.table_name = c.table_name)
  LOOP
    IF v_last <> 'sav_urgency' THEN RAISE EXCEPTION 'dernière colonne de vue attendue sav_urgency, trouvé %', v_last; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('majordhome_interventions', 'majordhome_entretien_sav')
     AND column_name = 'sav_urgency';
  IF n <> 2 THEN RAISE EXCEPTION 'sav_urgency attendue dans 2 vues, trouvé %', n; END IF;

  -- D. Le miroir des interventions reste updatable (canal d'écriture de savService)
  SELECT is_updatable INTO v_upd FROM information_schema.views
   WHERE table_schema = 'public' AND table_name = 'majordhome_interventions';
  IF v_upd IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'majordhome_interventions non updatable (%)', v_upd; END IF;

  -- E. security_invoker conservé
  SELECT count(*) INTO n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('majordhome_interventions', 'majordhome_entretien_sav')
     AND c.reloptions::text LIKE '%security_invoker=true%';
  IF n <> 2 THEN RAISE EXCEPTION 'security_invoker attendu sur 2 vues, trouvé %', n; END IF;

  -- F. Les colonnes déjà exposées n'ont pas bougé (une colonne retirée casserait le kanban)
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_entretien_sav'
     AND column_name IN ('anomalies', 'invoice_import_status', 'planned_team_size', 'planned_days',
                         'effective_contract_id', 'next_rdv_date', 'has_active_rdv', 'parts_detail');
  IF n <> 8 THEN RAISE EXCEPTION 'colonnes historiques de majordhome_entretien_sav attendues 8, trouvé %', n; END IF;

  RAISE NOTICE 'assert-sav-urgency : OK';
END $$;
