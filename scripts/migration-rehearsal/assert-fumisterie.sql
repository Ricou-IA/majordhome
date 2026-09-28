-- scripts/migration-rehearsal/assert-fumisterie.sql — vérifie 20260929_1_fumisterie_tables.sql.
DO $$
DECLARE n int; r record;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relrowsecurity AND c.relname LIKE 'fum\_%';
  IF n <> 10 THEN RAISE EXCEPTION 'RLS activée sur % table(s) fum_* au lieu de 10', n; END IF;

  FOR r IN SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname LIKE 'majordhome\_fum\_%' AND c.relkind = 'v' LOOP
    IF coalesce(r.reloptions::text, '') NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'vue % sans security_invoker', r.relname; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_views WHERE schemaname = 'public' AND viewname LIKE 'majordhome\_fum\_%';
  IF n <> 11 THEN RAISE EXCEPTION '% vue(s) majordhome_fum_* au lieu de 11', n; END IF;

  SELECT count(*) INTO n FROM information_schema.views
   WHERE table_schema = 'public' AND table_name IN ('majordhome_fum_configurations','majordhome_fum_metres','majordhome_fum_composant_mapping')
     AND is_updatable = 'YES';
  IF n <> 3 THEN RAISE EXCEPTION '% vue(s) updatable(s) au lieu de 3', n; END IF;

  IF has_table_privilege('anon', 'majordhome.fum_metres', 'SELECT') THEN RAISE EXCEPTION 'anon lit fum_metres'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.fum_article_attrs', 'SELECT') THEN RAISE EXCEPTION 'service_role ne lit pas fum_article_attrs'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.fum_article_attrs', 'INSERT') THEN RAISE EXCEPTION 'authenticated écrit fum_article_attrs'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'fum_configurations';
  IF n <> 2 THEN RAISE EXCEPTION 'fum_configurations : % policies au lieu de 2', n; END IF;
  RAISE NOTICE 'assert-fumisterie OK';
END;
$$;
