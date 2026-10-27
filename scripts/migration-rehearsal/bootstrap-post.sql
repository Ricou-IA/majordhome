-- bootstrap-post.sql — privilèges tels qu'observés en prod sur les objets
-- existants (has_table_privilege, 2026-09-12), appliqués APRÈS schema-generated.sql.
-- service_role a SELECT/INSERT/UPDATE sur les tables majordhome du sous-ensemble ;
-- authenticated a SELECT/UPDATE (et INSERT/DELETE via l'ACL par défaut).

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA majordhome TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA majordhome TO authenticated; -- plus d'anon depuis 20261029_1 (2026-10-27)
GRANT SELECT ON ALL TABLES IN SCHEMA majordhome TO baikal_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
-- 20261029_1 (2026-10-27) : en prod, les vues public.majordhome_* n'accordent plus rien à anon (REVOKE nominatif, le
-- défaut du schéma public partagé reste ouvert) — reproduit ici pour que la baseline reflète la prod.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind IN ('v', 'm') AND c.relname LIKE 'majordhome\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', r.relname);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA majordhome TO authenticated, service_role;

-- Les RPC existantes gardent leur posture prod : anon révoqué.
REVOKE EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[], jsonb, jsonb, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[], jsonb, jsonb, boolean, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION majordhome.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text) FROM PUBLIC, anon, authenticated;
