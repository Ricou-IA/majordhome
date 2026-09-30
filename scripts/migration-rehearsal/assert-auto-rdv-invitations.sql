-- assert-auto-rdv-invitations.sql — vérifie 20260930_5_auto_rdv_invitations.sql sur le cluster de répétition.
DO $$
DECLARE n int; r record;
BEGIN
  IF to_regclass('majordhome.auto_rdv_invitations') IS NULL THEN RAISE EXCEPTION 'table auto_rdv_invitations absente'; END IF;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relname = 'auto_rdv_invitations' AND c.relrowsecurity;
  IF n <> 1 THEN RAISE EXCEPTION 'RLS non activée'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'auto_rdv_invitations' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'policy d''écriture inattendue'; END IF;
  FOR r IN SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname = 'majordhome_auto_rdv_invitations' LOOP
    IF coalesce(r.reloptions::text, '') NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'vue sans security_invoker'; END IF;
  END LOOP;
  IF to_regclass('public.majordhome_auto_rdv_invitations') IS NULL THEN RAISE EXCEPTION 'vue absente'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.auto_rdv_invitations', 'INSERT') THEN RAISE EXCEPTION 'service_role sans INSERT'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.auto_rdv_invitations', 'UPDATE') THEN RAISE EXCEPTION 'service_role sans UPDATE'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.auto_rdv_invitations', 'INSERT') THEN RAISE EXCEPTION 'authenticated écrit les invitations'; END IF;
  IF has_table_privilege('anon', 'public.majordhome_auto_rdv_invitations', 'SELECT') THEN RAISE EXCEPTION 'anon lit les invitations'; END IF;
  -- Unicité (org, contrat, mois)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'majordhome' AND tablename = 'auto_rdv_invitations' AND indexdef ILIKE '%UNIQUE%contract_id, mois%') THEN
    RAISE EXCEPTION 'contrainte UNIQUE (org_id, contract_id, mois) absente';
  END IF;
  -- Crons (si pg_cron est présent sur le cluster de répétition)
  IF to_regclass('cron.job') IS NOT NULL THEN
    SELECT count(*) INTO n FROM cron.job WHERE jobname IN ('auto-rdv-ouverture', 'auto-rdv-relances');
    IF n <> 2 THEN RAISE EXCEPTION '% cron(s) auto-rdv au lieu de 2', n; END IF;
  END IF;
END $$;
