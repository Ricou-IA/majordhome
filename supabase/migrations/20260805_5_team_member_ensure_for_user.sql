-- ============================================================================
-- team_member_ensure_for_user — ressource planning auto pour un membre d'org
-- ============================================================================
-- Contexte : create-user (invitation) crée auth.users + core.profiles +
-- core.organization_members, mais JAMAIS la ligne majordhome.team_members qui
-- sert de ressource planning (colonne calendrier, assignation RDV, couleur).
-- Résultat : un membre invité n'apparaît nulle part dans le planning et sa
-- couleur n'est pas éditable (Gestion de l'équipe affiche « — »).
--
-- Cette RPC est idempotente : elle crée la ressource si absente, relie une
-- ressource orpheline (même email, user_id NULL — cas des imports legacy),
-- et ne touche à rien si la ressource existe déjà.
--
-- Sécurité : SECURITY DEFINER, caller doit être org_admin de p_core_org_id
-- (org_id vérifié contre auth.uid(), pas dérivé du payload) → GRANT authenticated.
-- ============================================================================

-- Idempotence structurelle : 1 seule ressource planning par (org, user).
CREATE UNIQUE INDEX IF NOT EXISTS team_members_org_user_uniq
  ON majordhome.team_members (org_id, user_id)
  WHERE user_id IS NOT NULL;

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
  v_planning_role   text;
  v_display         text;
  v_first           text;
  v_last            text;
  v_tm_id           uuid;
BEGIN
  IF p_color IS NOT NULL AND p_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Format couleur invalide (attendu #RRGGBB): %', p_color USING ERRCODE = '22023';
  END IF;

  -- 1. Le caller doit être org_admin de l'org visée
  SELECT role INTO v_caller_role
  FROM core.organization_members
  WHERE user_id = auth.uid() AND org_id = p_core_org_id;

  IF v_caller_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'org_admin_required (role=%)', v_caller_role USING ERRCODE = '42501';
  END IF;

  -- 2. La cible doit être un membre actif de cette org
  SELECT role INTO v_target_role
  FROM core.organization_members
  WHERE user_id = p_user_id AND org_id = p_core_org_id AND status = 'active';

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'user % non membre actif de org %', p_user_id, p_core_org_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. Org majordhome correspondante
  SELECT id INTO v_org_id
  FROM majordhome.organizations
  WHERE core_org_id = p_core_org_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'org majordhome introuvable pour core_org %', p_core_org_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. Ressource déjà présente → no-op (idempotent)
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

  -- 5. Ressource orpheline au même email (import legacy) → on la relie
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

  -- 6. Rôle planning dérivé du rôle effectif (cf. computeEffectiveRole côté front)
  --    org_admin → admin ; team_leader/Commercial → commercial ; sinon technician
  v_planning_role := CASE
    WHEN v_app_role = 'org_admin' OR v_target_role = 'org_admin' THEN 'admin'
    WHEN v_app_role = 'team_leader' OR v_target_role = 'team_leader' THEN 'commercial'
    WHEN lower(COALESCE(v_business_role, '')) = 'commercial' THEN 'commercial'
    ELSE 'technician'
  END;

  v_display := COALESCE(NULLIF(trim(v_full_name), ''), split_part(COALESCE(v_email, ''), '@', 1), 'Membre');
  v_first   := split_part(v_display, ' ', 1);
  v_last    := COALESCE(NULLIF(trim(substr(v_display, length(v_first) + 1)), ''), '');

  -- display_name est une colonne GENERATED (first_name || ' ' || last_name)
  INSERT INTO majordhome.team_members (
    org_id, user_id, first_name, last_name, email,
    role, calendar_color, is_active
  ) VALUES (
    v_org_id, p_user_id, v_first, v_last, v_email,
    v_planning_role, COALESCE(p_color, '#64748B'), true
  )
  RETURNING id INTO v_tm_id;

  RETURN v_tm_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.team_member_ensure_for_user(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_member_ensure_for_user(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.team_member_ensure_for_user(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.team_member_ensure_for_user(uuid, uuid, text) IS
  'Crée (idempotent) la ressource planning majordhome.team_members d''un membre d''org. org_admin only.';
