-- =============================================================================
-- 20261006_1_org_roles — profils « maison » par organisation (tranche 1, base)
-- =============================================================================
-- Spec : docs/superpowers/specs/2026-10-06-profils-maison-par-org-design.md
-- Un profil maison = libellé propre à l'org + MODÈLE standard (team_leader |
-- commercial | technicien). Partout où le code teste un rôle en dur, c'est le
-- modèle qui est vu (user_effective_role ne change pas). Seule la grille Droits
-- d'accès distingue le profil : role_can consulte d'abord la surcharge du code
-- maison, puis déroule la chaîne existante (surcharge modèle → défaut modèle →
-- refus). Écritures par RPC uniquement (20261006_2).
-- =============================================================================

-- ── 1. Tables ─────────────────────────────────────────────────────────────────
CREATE TABLE majordhome.org_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  code        text NOT NULL,
  label       text NOT NULL,
  base_role   text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_roles_code_format CHECK (code ~ '^[a-z0-9_]+$'),
  CONSTRAINT org_roles_code_not_standard CHECK (code NOT IN ('org_admin', 'team_leader', 'commercial', 'technicien')),
  CONSTRAINT org_roles_base_role CHECK (base_role IN ('team_leader', 'commercial', 'technicien')),
  CONSTRAINT org_roles_label_not_blank CHECK (length(trim(label)) > 0),
  CONSTRAINT org_roles_org_code_uniq UNIQUE (org_id, code),
  CONSTRAINT org_roles_id_org_uniq UNIQUE (id, org_id)   -- cible de la FK composite ci-dessous
);
COMMENT ON TABLE majordhome.org_roles IS
  'Profils « maison » d''une org : libellé + modèle standard. Le code est immuable et n''est jamais un code standard. Écritures par RPC org_role_* (org_admin).';

CREATE TABLE majordhome.member_org_roles (
  org_id       uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  org_role_id  uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id),
  -- même org que le profil, et CASCADE à la suppression du profil
  FOREIGN KEY (org_role_id, org_id) REFERENCES majordhome.org_roles(id, org_id) ON DELETE CASCADE
);
CREATE INDEX member_org_roles_role_idx ON majordhome.member_org_roles (org_role_id);
COMMENT ON TABLE majordhome.member_org_roles IS
  'Qui porte quel profil maison (au plus un par membre et par org). Pas de ligne = rôle standard. Écriture par member_set_org_role (org_admin).';

-- ── 2. RLS : lecture membre de l'org, aucune écriture directe ────────────────
ALTER TABLE majordhome.org_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.member_org_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_roles_select_org_members ON majordhome.org_roles
  FOR SELECT USING (org_id IN (
    SELECT om.org_id FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.status = 'active'));

CREATE POLICY member_org_roles_select_org_members ON majordhome.member_org_roles
  FOR SELECT USING (org_id IN (
    SELECT om.org_id FROM core.organization_members om
    WHERE om.user_id = auth.uid() AND om.status = 'active'));

-- ACL par défaut du schéma majordhome : anon/authenticated reçoivent arwd — on retire
-- tout, puis on rend SELECT seul (les écritures passent par les RPC SECURITY DEFINER).
REVOKE ALL ON majordhome.org_roles, majordhome.member_org_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.org_roles, majordhome.member_org_roles TO authenticated;
GRANT SELECT ON majordhome.org_roles, majordhome.member_org_roles TO service_role;

-- ── 3. Vues publiques (security_invoker) ─────────────────────────────────────
CREATE VIEW public.majordhome_org_roles WITH (security_invoker = true) AS
  SELECT id, org_id, code, label, base_role, is_active, created_at, updated_at
  FROM majordhome.org_roles;
GRANT SELECT ON public.majordhome_org_roles TO authenticated, service_role;

CREATE VIEW public.majordhome_member_org_roles WITH (security_invoker = true) AS
  SELECT m.org_id, m.user_id, m.org_role_id, r.code, r.label, r.base_role, r.is_active
  FROM majordhome.member_org_roles m
  JOIN majordhome.org_roles r ON r.id = m.org_role_id;
GRANT SELECT ON public.majordhome_member_org_roles TO authenticated, service_role;

-- ── 4. role_permissions accepte les codes maison DE L'ORG ────────────────────
-- Un CHECK ne peut pas lire une autre table, un FK ne peut pas être conditionnel :
-- trigger. Un code maison d'une AUTRE org est refusé (23514, comme l'ancien CHECK).
ALTER TABLE majordhome.role_permissions DROP CONSTRAINT role_permissions_role_check;

CREATE OR REPLACE FUNCTION majordhome.role_permissions_check_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'majordhome', 'public'
AS $function$
BEGIN
  IF NEW.role IN ('org_admin', 'team_leader', 'commercial', 'technicien') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.org_roles r WHERE r.org_id = NEW.org_id AND r.code = NEW.role) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'role_permissions.role invalide : % (ni standard, ni profil maison de l''org %)', NEW.role, NEW.org_id
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER role_permissions_check_role
  BEFORE INSERT OR UPDATE OF role, org_id ON majordhome.role_permissions
  FOR EACH ROW EXECUTE FUNCTION majordhome.role_permissions_check_role();

-- ── 5. Code maison de l'appelant ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.user_org_role_code(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
  SELECT r.code
  FROM majordhome.member_org_roles m
  JOIN majordhome.org_roles r ON r.id = m.org_role_id
  WHERE m.org_id = p_org_id
    AND m.user_id = auth.uid()
    AND r.is_active
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION majordhome.user_org_role_code(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION majordhome.user_org_role_code(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION majordhome.user_org_role_code(uuid) TO authenticated;
COMMENT ON FUNCTION majordhome.user_org_role_code(uuid) IS
  'Code du profil maison ACTIF porté par auth.uid() dans l''org, sinon NULL. Lu par role_can — jamais passé en paramètre.';

-- ── 6. role_can : surcharge maison d'abord, puis chaîne existante ────────────
CREATE OR REPLACE FUNCTION majordhome.role_can(p_org_id uuid, p_resource text, p_action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_role text;
  v_code text;
  v_allowed boolean;
BEGIN
  v_role := majordhome.user_effective_role(p_org_id);
  IF v_role IS NULL THEN RETURN false; END IF;       -- pas membre de l'org
  IF v_role = 'org_admin' THEN RETURN true; END IF;  -- bypass admin

  -- 0) surcharge du profil maison (20261006_1) — le modèle reste v_role
  v_code := majordhome.user_org_role_code(p_org_id);
  IF v_code IS NOT NULL THEN
    SELECT allowed INTO v_allowed
    FROM majordhome.role_permissions
    WHERE org_id = p_org_id AND role = v_code AND resource = p_resource AND action = p_action;
    IF FOUND THEN RETURN v_allowed; END IF;
  END IF;

  -- 1) override per-org du modèle
  SELECT allowed INTO v_allowed
  FROM majordhome.role_permissions
  WHERE org_id = p_org_id AND role = v_role AND resource = p_resource AND action = p_action;
  IF FOUND THEN RETURN v_allowed; END IF;

  -- 2) défaut app-level du modèle
  SELECT allowed INTO v_allowed
  FROM majordhome.app_role_permissions
  WHERE role = v_role AND resource = p_resource AND action = p_action;
  IF FOUND THEN RETURN v_allowed; END IF;

  RETURN false;  -- fail-closed
END;
$function$;
-- ACL de role_can : CREATE OR REPLACE conserve les privilèges, mais on les re-pose
-- explicitement (idempotent) — l'effet réel se vérifie par has_function_privilege.
REVOKE ALL ON FUNCTION majordhome.role_can(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION majordhome.role_can(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION majordhome.role_can(uuid, text, text) TO authenticated;
