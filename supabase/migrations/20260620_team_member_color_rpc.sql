-- 20260620_team_member_color_rpc.sql
-- Phase 2 — éditeur de couleur planning par personne (Settings → Équipe).
-- RPC org_admin pour écrire majordhome.team_members.calendar_color (schéma non
-- exposé via PostgREST → SECURITY DEFINER). Autorisation : org_admin de l'org du
-- team_member (bridge majordhome.organizations.core_org_id → core.organization_members).
CREATE OR REPLACE FUNCTION public.team_member_set_calendar_color(p_team_member_id uuid, p_color text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_core_org_id uuid;
  v_role text;
BEGIN
  -- Format strict #RRGGBB
  IF p_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Format couleur invalide (attendu #RRGGBB): %', p_color USING ERRCODE = '22023';
  END IF;

  -- Org CORE du team_member (bridge majordhome -> core)
  SELECT o.core_org_id INTO v_core_org_id
  FROM majordhome.team_members tm
  JOIN majordhome.organizations o ON o.id = tm.org_id
  WHERE tm.id = p_team_member_id;

  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  -- Autorisation : org_admin de cette org
  SELECT role INTO v_role
  FROM core.organization_members
  WHERE user_id = v_user_id AND org_id = v_core_org_id;

  IF v_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'Seul un org_admin peut changer la couleur (role=%)', v_role USING ERRCODE = '42501';
  END IF;

  UPDATE majordhome.team_members
  SET calendar_color = p_color, updated_at = NOW()
  WHERE id = p_team_member_id;

  RETURN p_color;
END;
$function$;

REVOKE ALL ON FUNCTION public.team_member_set_calendar_color(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_member_set_calendar_color(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_calendar_color(uuid, text) TO authenticated;
