-- bootstrap-pre.sql — rôles, schémas et stub auth.uid() du cluster de répétition.
-- Exécuté AVANT schema-generated.sql. Reproduit ce dont dépendent les migrations
-- (rôles Supabase, auth.uid(), privilèges par défaut du schéma majordhome).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baikal_reader') THEN CREATE ROLE baikal_reader NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS majordhome;
CREATE SCHEMA IF NOT EXISTS auth;

GRANT USAGE ON SCHEMA public, core, majordhome TO anon, authenticated, service_role, baikal_reader;

-- Stub Supabase : auth.uid() lit la claim `sub` posée par les tests via
--   SET request.jwt.claim.sub = '<uuid>';  (RESET pour redevenir anonyme)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

-- ACL par défaut observées en prod (pg_default_acl, 2026-09-12) :
--   majordhome : anon=arwd, authenticated=arwd, baikal_reader=r — PAS service_role
--   public     : anon/authenticated/service_role = tous privilèges
-- Les migrations doivent donc REVOKE anon et GRANT service_role explicitement :
-- c'est précisément ce que la répétition vérifie.
ALTER DEFAULT PRIVILEGES IN SCHEMA majordhome GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA majordhome GRANT SELECT ON TABLES TO baikal_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
