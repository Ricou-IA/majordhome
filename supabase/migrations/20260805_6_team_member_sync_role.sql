-- ============================================================================
-- team_member_sync_role_for_user — le rôle planning suit le rôle du membre
-- ============================================================================
-- Contexte : team_members.role ('admin' | 'commercial' | 'technician') pilote
-- l'assignation des RDV (SectionAssignee : types commerciaux → commercial+admin,
-- types techniques → technician). Il était figé à la création de la ressource :
-- un Technicien passé Commercial dans Gestion de l'équipe restait proposé comme
-- technicien et disparaissait des RDV commerciaux — échec silencieux.
--
-- 1. Dérivation extraite dans un helper unique (plus de CASE dupliqué).
-- 2. RPC de resync appelée par le front après tout changement de rôle.
-- ============================================================================

-- Source unique de la dérivation rôle effectif → rôle planning.
-- Miroir de computeEffectiveRole() côté front (src/lib/permissions.js).
CREATE OR REPLACE FUNCTION majordhome.planning_role_for(
  p_app_role text,
  p_business_role text,
  p_membership_role text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_app_role = 'org_admin'   OR p_membership_role = 'org_admin'   THEN 'admin'
    WHEN p_app_role = 'team_leader' OR p_membership_role = 'team_leader' THEN 'commercial'
    WHEN lower(COALESCE(p_business_role, '')) = 'commercial'             THEN 'commercial'
    ELSE 'technician'
  END;
$function$;

COMMENT ON FUNCTION majordhome.planning_role_for(text, text, text) IS
  'Rôle planning (team_members.role) dérivé du rôle effectif d''un membre. Miroir de computeEffectiveRole() côté front.';

-- ---------------------------------------------------------------------------
-- ensure : même logique, dérivation déléguée au helper
-- ---------------------------------------------------------------------------
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

  SELECT role INTO v_caller_role
  FROM core.organization_members
  WHERE user_id = auth.uid() AND org_id = p_core_org_id;

  IF v_caller_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'org_admin_required (role=%)', v_caller_role USING ERRCODE = '42501';
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

  -- display_name est une colonne GENERATED (first_name || ' ' || last_name)
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

-- ---------------------------------------------------------------------------
-- sync : réaligne le rôle planning sur le rôle effectif courant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_member_sync_role_for_user(
  p_core_org_id uuid,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_caller_role   text;
  v_target_role   text;
  v_org_id        uuid;
  v_app_role      text;
  v_business_role text;
  v_new_role      text;
BEGIN
  SELECT role INTO v_caller_role
  FROM core.organization_members
  WHERE user_id = auth.uid() AND org_id = p_core_org_id;

  IF v_caller_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'org_admin_required (role=%)', v_caller_role USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_org_id
  FROM majordhome.organizations
  WHERE core_org_id = p_core_org_id;

  IF v_org_id IS NULL THEN
    RETURN NULL; -- org non majordhome : rien à synchroniser
  END IF;

  SELECT role INTO v_target_role
  FROM core.organization_members
  WHERE user_id = p_user_id AND org_id = p_core_org_id;

  SELECT app_role, business_role INTO v_app_role, v_business_role
  FROM core.profiles
  WHERE id = p_user_id;

  v_new_role := majordhome.planning_role_for(v_app_role, v_business_role, v_target_role);

  UPDATE majordhome.team_members
     SET role = v_new_role, updated_at = NOW()
   WHERE org_id = v_org_id
     AND user_id = p_user_id
     AND role IS DISTINCT FROM v_new_role;

  RETURN v_new_role;
END;
$function$;

REVOKE ALL ON FUNCTION public.team_member_sync_role_for_user(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_member_sync_role_for_user(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.team_member_sync_role_for_user(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.team_member_sync_role_for_user(uuid, uuid) IS
  'Réaligne majordhome.team_members.role sur le rôle effectif courant du membre. org_admin only. No-op si pas de ressource planning.';
