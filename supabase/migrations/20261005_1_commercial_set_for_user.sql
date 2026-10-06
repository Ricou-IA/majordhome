-- =============================================================================
-- commercial_set_for_user — la liste « Commercial assigné » devient paramétrable
-- =============================================================================
-- majordhome.commercials alimente le sélecteur « Commercial assigné » des leads
-- (et le dashboard pipeline, Meta Ads, le segment mailing, les VT du pipeline).
-- Rien ne l'écrivait : ses lignes étaient posées à la main en base. Cette RPC
-- est l'unique écrivain, appelée depuis Settings → Équipe (case « Commercial »).
--
--   - cocher   : réactive la ligne du membre, ou relie une ligne orpheline de
--                même e-mail, ou en crée une depuis son profil ;
--   - décocher : is_active = false. Jamais de DELETE : leads.assigned_user_id et
--                appointments.assigned_commercial_id pointent sur commercials.id.
--
-- Idempotence structurelle : index unique partiel (org_id, profile_id).
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS commercials_org_profile_uniq
  ON majordhome.commercials (org_id, profile_id)
  WHERE profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.commercial_set_for_user(
  p_core_org_id uuid,
  p_user_id uuid,
  p_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_is_member   boolean;
  v_full_name   text;
  v_email       text;
  v_id          uuid;
BEGIN
  IF p_core_org_id IS NULL OR p_user_id IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_caller_role
  FROM core.organization_members
  WHERE user_id = auth.uid() AND org_id = p_core_org_id;

  IF v_caller_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'org_admin_required (role=%)', v_caller_role USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM core.organization_members
    WHERE user_id = p_user_id AND org_id = p_core_org_id
  ) INTO v_is_member;

  IF v_is_member IS NOT TRUE THEN
    RAISE EXCEPTION 'not_an_org_member' USING ERRCODE = '42501';
  END IF;

  SELECT NULLIF(TRIM(full_name), ''), NULLIF(TRIM(email), '')
    INTO v_full_name, v_email
  FROM core.profiles
  WHERE id = p_user_id;

  -- Ligne déjà reliée au membre
  SELECT id INTO v_id
  FROM majordhome.commercials
  WHERE org_id = p_core_org_id AND profile_id = p_user_id;

  -- Sinon : ligne orpheline de même e-mail (posée à la main avant le lien profil)
  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_id
    FROM majordhome.commercials
    WHERE org_id = p_core_org_id
      AND profile_id IS NULL
      AND LOWER(email) = LOWER(v_email)
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE majordhome.commercials
       SET is_active  = p_active,
           profile_id = p_user_id,
           full_name  = COALESCE(v_full_name, full_name),
           email      = COALESCE(v_email, email),
           updated_at = NOW()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  IF p_active IS NOT TRUE THEN
    RETURN NULL; -- rien à désactiver
  END IF;

  INSERT INTO majordhome.commercials (org_id, full_name, email, profile_id, is_active)
  VALUES (p_core_org_id, COALESCE(v_full_name, v_email, 'Utilisateur'), v_email, p_user_id, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.commercial_set_for_user(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commercial_set_for_user(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.commercial_set_for_user(uuid, uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.commercial_set_for_user(uuid, uuid, boolean) IS
  'Inscrit / retire un membre de la liste des commerciaux assignables aux leads (majordhome.commercials). org_admin only. Retirer = is_active false, jamais de DELETE.';
