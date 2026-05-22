-- supabase/migrations/20260522_org_update_settings.sql
-- RPC SECURITY DEFINER : merge JSONB des settings d'une org, réservée org_admin.

CREATE OR REPLACE FUNCTION public.org_update_settings(
  p_org_id uuid,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_new_settings jsonb;
BEGIN
  -- 1. Membership check : user est bien membre de cette org
  SELECT role INTO v_role
  FROM core.organization_members
  WHERE user_id = v_user_id AND org_id = p_org_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of this org' USING ERRCODE = '42501';
  END IF;
  IF v_role <> 'org_admin' THEN
    RAISE EXCEPTION 'Only org_admin can edit settings (role=%)', v_role
      USING ERRCODE = '42501';
  END IF;

  -- 2. Shallow merge JSONB (|| opérateur 1er niveau seulement)
  --    Convention : l'UI envoie des patches plats au 1er niveau.
  --    Pour les sous-arbres (territoire_centers), l'UI envoie l'arbre entier.
  UPDATE core.organizations
  SET settings = COALESCE(settings, '{}'::jsonb) || p_patch,
      updated_at = NOW()
  WHERE id = p_org_id
  RETURNING settings INTO v_new_settings;

  RETURN v_new_settings;
END;
$$;

-- Sécurité : seuls les users authenticated peuvent appeler (anon bloqué).
-- La RPC elle-même vérifie ensuite le rôle org_admin via auth.uid().
REVOKE EXECUTE ON FUNCTION public.org_update_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_update_settings(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.org_update_settings IS
  'Merge JSONB shallow des settings d''une org. Réservée org_admin. Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §8.4';
