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

-- pgcrypto vit dans le schéma `extensions` en prod (vérifié 2026-09-25) : crypt / gen_salt
-- sont appelés qualifiés (extensions.crypt) par les RPC du module Maintenance.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public; -- comme en prod (public.unaccent, 1.1) : org_role_create (20261006_2)
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- Stub Supabase : auth.uid() lit la claim `sub` posée par les tests via
--   SET request.jwt.claim.sub = '<uuid>';  (RESET pour redevenir anonyme)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

-- ACL par défaut observées en prod (pg_default_acl, 2026-09-12) :
--   majordhome : authenticated=arwd, baikal_reader=r — PAS service_role, PLUS d'anon (20261029_1, 2026-10-27 ; avant : anon=arwd)
--   public     : anon/authenticated/service_role = tous privilèges
-- Les migrations doivent donc REVOKE anon et GRANT service_role explicitement :
-- c'est précisément ce que la répétition vérifie.
ALTER DEFAULT PRIVILEGES IN SCHEMA majordhome GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated; -- plus d'anon depuis 20261029_1 (2026-10-27)
ALTER DEFAULT PRIVILEGES IN SCHEMA majordhome GRANT SELECT ON TABLES TO baikal_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- Stub Vault (supabase_vault) : mêmes signatures que la prod (create_secret / update_secret / decrypted_secrets),
-- secret stocké en clair — on ne teste que les RPC org_secret_* (20261024_2), pas le chiffrement.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  key_id uuid,
  nonce bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, key_id, nonce, created_at, updated_at FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO vault.secrets (name, description, secret, key_id) VALUES (new_name, new_description, new_secret, new_key_id) RETURNING id
$$;
CREATE OR REPLACE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  UPDATE vault.secrets SET secret = COALESCE(new_secret, secret), name = COALESCE(new_name, name),
    description = COALESCE(new_description, description), updated_at = now() WHERE id = secret_id
$$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;
GRANT USAGE ON SCHEMA vault TO service_role;
GRANT SELECT ON vault.decrypted_secrets TO service_role;

-- Stub Storage (les migrations posent bucket + policies ; en répétition on ne teste que la syntaxe)
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz DEFAULT now()
);
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Stub pg_cron (20261017_1) : cron.schedule(nom, …) met à jour le job de même nom, comme
-- l'extension ; les assertions lisent cron.job. Rien n'est jamais exécuté.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid;
$$;
