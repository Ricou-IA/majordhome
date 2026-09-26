-- supabase/migrations/20260926_1_org_set_modules.sql
-- ============================================================================
-- Activation des modules par organisation depuis Baikal (console d'administration),
-- spec docs/superpowers/specs/2026-09-26-baikal-admin-modules-majordhome-design.md.
--
--   - RPC public.org_set_modules : fusionne des drapeaux booléens dans
--     core.organizations.settings.modules (les autres clés de settings intactes).
--     Appelée UNIQUEMENT par l'edge baikal-admin (service_role) : elle prend org_id en
--     paramètre sans le dériver d'auth.uid() ⇒ REVOKE PUBLIC, anon, authenticated.
--     Les clés sont validées contre le catalogue (src/lib/modules.js) par l'edge ; la RPC
--     garantit le type (objet non vide de booléens).
--   - majordhome.org_modules_journal : trace (qui, quand, avant, après). RLS sans policy :
--     invisible des membres du client (settings est lisible par tout membre, on n'y range
--     donc pas l'identité de l'admin Baikal).
-- Répétée sur scripts/migration-rehearsal/ (assert-org-set-modules.sql).
-- ============================================================================

CREATE TABLE IF NOT EXISTS majordhome.org_modules_journal (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  auteur     text,
  demande    jsonb NOT NULL,
  avant      jsonb NOT NULL,
  apres      jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_modules_journal_org ON majordhome.org_modules_journal (org_id, changed_at DESC);
COMMENT ON TABLE majordhome.org_modules_journal IS
  'Journal des ouvertures / fermetures de modules par organisation (depuis Baikal, edge baikal-admin). Écrit par org_set_modules ; invisible des membres.';

ALTER TABLE majordhome.org_modules_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON majordhome.org_modules_journal FROM anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baikal_reader') THEN
    -- Baikal lit ce journal pour afficher l'historique (lecture seule, comme le reste).
    GRANT SELECT ON majordhome.org_modules_journal TO baikal_reader;
  END IF;
END;
$$;
GRANT SELECT ON majordhome.org_modules_journal TO service_role;

CREATE OR REPLACE FUNCTION public.org_set_modules(p_org_id uuid, p_modules jsonb, p_auteur text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core', 'majordhome', 'public'
AS $function$
DECLARE
  v_settings jsonb;
  v_nom text;
  v_avant jsonb;
  v_apres jsonb;
BEGIN
  IF (jsonb_typeof(p_modules) = 'object' AND p_modules <> '{}'::jsonb) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid_body' USING ERRCODE = '22023', DETAIL = 'modules : objet non vide attendu';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_modules) e WHERE jsonb_typeof(e.value) <> 'boolean') THEN
    RAISE EXCEPTION 'invalid_body' USING ERRCODE = '22023', DETAIL = 'modules : valeurs booléennes uniquement';
  END IF;

  SELECT settings, name INTO v_settings, v_nom FROM core.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_avant := CASE WHEN jsonb_typeof(v_settings->'modules') = 'object' THEN v_settings->'modules' ELSE '{}'::jsonb END;
  v_apres := v_avant || p_modules;

  UPDATE core.organizations
     SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{modules}', v_apres, true)
   WHERE id = p_org_id;

  INSERT INTO majordhome.org_modules_journal (org_id, auteur, demande, avant, apres)
  VALUES (p_org_id, nullif(trim(p_auteur), ''), p_modules, v_avant, v_apres);

  RETURN jsonb_build_object('id', p_org_id, 'nom', v_nom, 'modules', v_apres);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.org_set_modules(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_set_modules(uuid, jsonb, text) TO service_role;
