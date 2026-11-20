-- ============================================================================
-- Contrat Membres v1 de Baikal (canal baikal-admin) — 2026-11-20
-- ============================================================================
-- Baikal administre les membres de Majord'home sans en tenir de copie : il
-- demande la liste et les gestes à l'edge `baikal-admin` (X-Baikal-Key), qui
-- s'appuie sur ces objets. Contrat de référence côté Baikal :
-- docs/contrats/membres-relais-v1.ts.
--
-- 1. majordhome.effective_role_for : le rôle effectif d'un membre, miroir de
--    computeEffectiveRole() (src/lib/permissions.js).
-- 2. public.baikal_membres : organisations et membres actifs de l'app, avec
--    l'état du compte (dernière connexion, blocage) lu dans auth.users.
--    service_role uniquement.
-- 3. public.team_member_ensure_for_user : accepte désormais l'appel
--    service_role (l'edge baikal-admin n'a pas d'utilisateur), en plus de
--    l'org_admin. Corps inchangé par ailleurs.
-- ============================================================================

-- 1. Rôle effectif -----------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.effective_role_for(
  p_app_role text,
  p_business_role text,
  p_membership_role text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_app_role = 'org_admin'   OR p_membership_role = 'org_admin'   THEN 'org_admin'
    WHEN p_app_role = 'team_leader' OR p_membership_role = 'team_leader' THEN 'team_leader'
    WHEN lower(coalesce(p_business_role, '')) = 'commercial'             THEN 'commercial'
    ELSE 'technicien'
  END;
$function$;

COMMENT ON FUNCTION majordhome.effective_role_for(text, text, text) IS
  'Rôle effectif (org_admin | team_leader | commercial | technicien) d''un membre. Miroir de computeEffectiveRole() côté front.';

-- 2. Liste des membres pour Baikal --------------------------------------------
-- Ne rend que les organisations de l'app et leurs membres actifs : la base
-- porte aussi des comptes d'apps cohabitantes, jamais exposés ici.
CREATE OR REPLACE FUNCTION public.baikal_membres(
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'organisations', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'nom', o.name) ORDER BY o.name)
      FROM core.organizations o
      WHERE o.app_id = 'majordhome'
    ), '[]'::jsonb),
    'membres', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'email', u.email,
          'nom', nullif(btrim(p.full_name), ''),
          'org_id', om.org_id,
          'role', majordhome.effective_role_for(p.app_role, p.business_role, om.role),
          'cree_le', u.created_at,
          'derniere_connexion', u.last_sign_in_at,
          'bloque', coalesce(u.banned_until > now(), false)
        )
        ORDER BY o.name, p.full_name, u.email
      )
      FROM core.organization_members om
      JOIN core.organizations o ON o.id = om.org_id AND o.app_id = 'majordhome'
      JOIN auth.users u ON u.id = om.user_id AND u.deleted_at IS NULL
      LEFT JOIN core.profiles p ON p.id = om.user_id
      WHERE om.status = 'active'
        AND (p_org_id IS NULL OR om.org_id = p_org_id)
        AND (p_user_id IS NULL OR om.user_id = p_user_id)
    ), '[]'::jsonb)
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.baikal_membres(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.baikal_membres(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.baikal_membres(uuid, uuid) IS
  'Contrat Membres v1 de Baikal : organisations de l''app et membres actifs (état du compte compris). service_role uniquement, appelée par l''edge baikal-admin.';

-- 3. Ressource planning : appel service_role admis ----------------------------
-- Seule la garde de l'appelant change (service_role OU org_admin de l'org).
CREATE OR REPLACE FUNCTION public.team_member_ensure_for_user(
  p_core_org_id uuid,
  p_user_id uuid,
  p_color text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_caller_role     text;
  v_target_role     text;
  v_org_id          uuid;
  v_full_name       text;
  v_email           text;
  v_app_role        text;
  v_business_role   text;
  v_display         text;
  v_first           text;
  v_last            text;
  v_tm_id           uuid;
BEGIN
  IF p_color IS NOT NULL AND p_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Format couleur invalide (attendu #RRGGBB): %', p_color USING ERRCODE = '22023';
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' THEN
    SELECT role INTO v_caller_role
    FROM core.organization_members
    WHERE user_id = auth.uid() AND org_id = p_core_org_id;

    IF v_caller_role IS DISTINCT FROM 'org_admin' THEN
      RAISE EXCEPTION 'org_admin_required (role=%)', v_caller_role USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT role INTO v_target_role
  FROM core.organization_members
  WHERE user_id = p_user_id AND org_id = p_core_org_id AND status = 'active';

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'user % non membre actif de org %', p_user_id, p_core_org_id USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_org_id
  FROM majordhome.organizations
  WHERE core_org_id = p_core_org_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org majordhome introuvable pour core_org %', p_core_org_id USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_tm_id
  FROM majordhome.team_members
  WHERE org_id = v_org_id AND user_id = p_user_id;

  IF v_tm_id IS NOT NULL THEN
    RETURN v_tm_id;
  END IF;

  SELECT full_name, email, app_role, business_role
    INTO v_full_name, v_email, v_app_role, v_business_role
  FROM core.profiles
  WHERE id = p_user_id;

  IF v_email IS NOT NULL THEN
    UPDATE majordhome.team_members
       SET user_id = p_user_id, is_active = true, updated_at = NOW()
     WHERE org_id = v_org_id
       AND user_id IS NULL
       AND lower(email) = lower(v_email)
    RETURNING id INTO v_tm_id;

    IF v_tm_id IS NOT NULL THEN
      RETURN v_tm_id;
    END IF;
  END IF;

  v_display := COALESCE(NULLIF(trim(v_full_name), ''), split_part(COALESCE(v_email, ''), '@', 1), 'Membre');
  v_first   := split_part(v_display, ' ', 1);
  v_last    := COALESCE(NULLIF(trim(substr(v_display, length(v_first) + 1)), ''), '');

  INSERT INTO majordhome.team_members (
    org_id, user_id, first_name, last_name, email,
    role, calendar_color, is_active
  ) VALUES (
    v_org_id, p_user_id, v_first, v_last, v_email,
    majordhome.planning_role_for(v_app_role, v_business_role, v_target_role),
    COALESCE(p_color, '#64748B'), true
  )
  RETURNING id INTO v_tm_id;

  RETURN v_tm_id;
END;
$function$;
