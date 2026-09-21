-- assert-planned-order.sql — vérifie 20260922_1_planned_order.sql sur le cluster de répétition.
-- Un écart lève une exception → run.mjs sort en ECHEC.

DO $$
DECLARE
  n int;
  v_def text;
  v_upd text;
BEGIN
  -- A. Colonnes sur les deux tables
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'majordhome' AND table_name IN ('leads', 'interventions')
     AND column_name IN ('planned_team_size', 'planned_days') AND data_type = 'smallint';
  IF n <> 4 THEN RAISE EXCEPTION 'colonnes planned_* attendues 4, trouvé %', n; END IF;

  -- B. Contraintes de plage
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname IN ('leads_planned_team_size_range', 'leads_planned_days_range',
                     'interventions_planned_team_size_range', 'interventions_planned_days_range');
  IF n <> 4 THEN RAISE EXCEPTION 'contraintes de plage attendues 4, trouvé %', n; END IF;

  -- C. Les trois vues exposent les deux colonnes, en fin de liste
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('majordhome_interventions', 'majordhome_chantiers', 'majordhome_entretien_sav')
     AND column_name IN ('planned_team_size', 'planned_days');
  IF n <> 6 THEN RAISE EXCEPTION 'colonnes planned_* dans les vues attendues 6, trouvé %', n; END IF;

  -- D. Le miroir des interventions reste updatable (canal d'écriture de savService.updateFields)
  SELECT is_updatable INTO v_upd FROM information_schema.views
   WHERE table_schema = 'public' AND table_name = 'majordhome_interventions';
  IF v_upd IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'majordhome_interventions non updatable (%)', v_upd; END IF;

  -- E. security_invoker conservé sur les trois vues
  SELECT count(*) INTO n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('majordhome_interventions', 'majordhome_chantiers', 'majordhome_entretien_sav')
     AND c.reloptions::text LIKE '%security_invoker=true%';
  IF n <> 3 THEN RAISE EXCEPTION 'security_invoker attendu sur 3 vues, trouvé %', n; END IF;

  -- F. La RPC accepte les deux clés
  SELECT pg_get_functiondef('public.update_majordhome_lead(uuid, jsonb)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%planned_team_size%' OR v_def NOT LIKE '%planned_days%' THEN
    RAISE EXCEPTION 'update_majordhome_lead ne cite pas planned_team_size / planned_days';
  END IF;

  -- G. anon ne peut toujours pas exécuter la RPC (CREATE OR REPLACE conserve les ACL)
  IF has_function_privilege('anon', 'public.update_majordhome_lead(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'update_majordhome_lead exécutable par anon';
  END IF;

  RAISE NOTICE 'assert-planned-order : OK';
END $$;
