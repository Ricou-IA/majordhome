-- 20261014_2_depart_retour_technicien.sql
-- Spec : docs/superpowers/specs/2026-10-14-depart-retour-technicien-design.md

-- 1. Réglage du technicien ---------------------------------------------------
ALTER TABLE majordhome.team_members
  ADD COLUMN IF NOT EXISTS depart_point jsonb,
  ADD COLUMN IF NOT EXISTS retour_point jsonb;

ALTER TABLE majordhome.team_members
  ADD CONSTRAINT team_members_depart_point_shape CHECK (
    depart_point IS NULL OR (jsonb_typeof(depart_point->'lat') = 'number' AND jsonb_typeof(depart_point->'lng') = 'number')),
  ADD CONSTRAINT team_members_retour_point_shape CHECK (
    retour_point IS NULL OR (jsonb_typeof(retour_point->'lat') = 'number' AND jsonb_typeof(retour_point->'lng') = 'number'));

CREATE OR REPLACE VIEW public.majordhome_team_members WITH (security_invoker = true) AS
SELECT id, org_id, first_name, last_name, display_name, email, phone, role, specialties,
       calendar_color, google_calendar_id, google_calendar_email, default_availability,
       default_zone, slack_user_id, is_active, created_at, updated_at, user_id,
       daily_work_minutes, include_in_routing,
       depart_point, retour_point
FROM majordhome.team_members;

-- 2. RPC réglages de tournée : signature étendue (DROP : le type de retour change)
DROP FUNCTION IF EXISTS public.team_member_set_routing_settings(uuid, integer, boolean, text[]);

CREATE FUNCTION public.team_member_set_routing_settings(
  p_team_member_id uuid,
  p_daily_work_minutes integer DEFAULT NULL,
  p_include_in_routing boolean DEFAULT NULL,
  p_specialties text[] DEFAULT NULL,
  p_depart_point jsonb DEFAULT NULL,
  p_retour_point jsonb DEFAULT NULL,
  p_reset_depart boolean DEFAULT false,
  p_reset_retour boolean DEFAULT false
)
RETURNS TABLE (daily_work_minutes integer, include_in_routing boolean, specialties text[],
               depart_point jsonb, retour_point jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_core_org_id uuid;
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  IF p_daily_work_minutes IS NOT NULL AND (p_daily_work_minutes < 60 OR p_daily_work_minutes > 1440) THEN
    RAISE EXCEPTION 'Budget journalier hors bornes (60-1440 min): %', p_daily_work_minutes USING ERRCODE = '22023';
  END IF;
  -- Un point sans coordonnées numériques est une faute de saisie, pas un réglage.
  IF p_depart_point IS NOT NULL AND (jsonb_typeof(p_depart_point->'lat') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_depart_point->'lng') IS DISTINCT FROM 'number') THEN
    RAISE EXCEPTION 'Point de départ sans coordonnées' USING ERRCODE = '22023';
  END IF;
  IF p_retour_point IS NOT NULL AND (jsonb_typeof(p_retour_point->'lat') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_retour_point->'lng') IS DISTINCT FROM 'number') THEN
    RAISE EXCEPTION 'Point de retour sans coordonnées' USING ERRCODE = '22023';
  END IF;

  SELECT o.core_org_id INTO v_core_org_id
  FROM majordhome.team_members tm JOIN majordhome.organizations o ON o.id = tm.org_id
  WHERE tm.id = p_team_member_id;
  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  SELECT om.role INTO v_role FROM core.organization_members om
  WHERE om.user_id = v_user_id AND om.org_id = v_core_org_id;
  IF v_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'Seul un org_admin peut modifier les reglages de tournee (role=%)', v_role USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE majordhome.team_members tm
     SET daily_work_minutes = COALESCE(p_daily_work_minutes, tm.daily_work_minutes),
         include_in_routing = COALESCE(p_include_in_routing, tm.include_in_routing),
         specialties        = COALESCE(p_specialties, tm.specialties),
         depart_point       = CASE WHEN p_reset_depart THEN NULL ELSE COALESCE(p_depart_point, tm.depart_point) END,
         retour_point       = CASE WHEN p_reset_retour THEN NULL ELSE COALESCE(p_retour_point, tm.retour_point) END,
         updated_at         = NOW()
   WHERE tm.id = p_team_member_id
  RETURNING tm.daily_work_minutes, tm.include_in_routing, tm.specialties, tm.depart_point, tm.retour_point;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[], jsonb, jsonb, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean, text[], jsonb, jsonb, boolean, boolean) TO authenticated;

-- 3. Exception du jour -------------------------------------------------------
CREATE TABLE majordhome.team_member_day_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES majordhome.organizations(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES majordhome.team_members(id) ON DELETE CASCADE,
  date date NOT NULL,
  depart text CHECK (depart IN ('agence', 'perso')),
  retour text CHECK (retour IN ('agence', 'perso')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_member_day_endpoints_uniq UNIQUE (team_member_id, date),
  CONSTRAINT team_member_day_endpoints_non_vide CHECK (depart IS NOT NULL OR retour IS NOT NULL)
);
CREATE INDEX team_member_day_endpoints_org_date ON majordhome.team_member_day_endpoints (org_id, date);

ALTER TABLE majordhome.team_member_day_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_member_day_endpoints_select ON majordhome.team_member_day_endpoints
  FOR SELECT TO authenticated
  USING (org_id IN (
    SELECT o.id FROM majordhome.organizations o
    JOIN core.organization_members om ON om.org_id = o.core_org_id
    WHERE om.user_id = auth.uid()));
-- Aucune policy d'écriture : la RPC ci-dessous est le seul écrivain.
-- Les ACL par défaut du schéma donnent arwd à anon/authenticated : on les retire
-- explicitement (défense en profondeur, en plus de la RLS sans policy d'écriture).
REVOKE ALL ON majordhome.team_member_day_endpoints FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON majordhome.team_member_day_endpoints FROM authenticated;
GRANT SELECT ON majordhome.team_member_day_endpoints TO authenticated, service_role;

CREATE VIEW public.majordhome_team_member_day_endpoints WITH (security_invoker = true) AS
SELECT id, org_id, team_member_id, date, depart, retour, created_by, created_at, updated_at
FROM majordhome.team_member_day_endpoints;
REVOKE ALL ON public.majordhome_team_member_day_endpoints FROM PUBLIC, anon;
GRANT SELECT ON public.majordhome_team_member_day_endpoints TO authenticated, service_role;

CREATE FUNCTION public.team_member_set_day_endpoints(
  p_team_member_id uuid, p_date date, p_depart text DEFAULT NULL, p_retour text DEFAULT NULL)
RETURNS TABLE (team_member_id uuid, date date, depart text, retour text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_core_org_id uuid;
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Date requise' USING ERRCODE = '22023';
  END IF;
  IF (p_depart IS NOT NULL AND p_depart NOT IN ('agence', 'perso'))
     OR (p_retour IS NOT NULL AND p_retour NOT IN ('agence', 'perso')) THEN
    RAISE EXCEPTION 'Valeur hors liste (agence | perso)' USING ERRCODE = '22023';
  END IF;

  SELECT tm.org_id, o.core_org_id INTO v_org_id, v_core_org_id
  FROM majordhome.team_members tm JOIN majordhome.organizations o ON o.id = tm.org_id
  WHERE tm.id = p_team_member_id;
  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  SELECT om.role INTO v_role FROM core.organization_members om
  WHERE om.user_id = v_user_id AND om.org_id = v_core_org_id;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'Réservé aux responsables (role=%)', v_role USING ERRCODE = '42501';
  END IF;

  IF p_depart IS NULL AND p_retour IS NULL THEN
    DELETE FROM majordhome.team_member_day_endpoints e
     WHERE e.team_member_id = p_team_member_id AND e.date = p_date AND e.org_id = v_org_id;
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO majordhome.team_member_day_endpoints AS e (org_id, team_member_id, date, depart, retour, created_by)
  VALUES (v_org_id, p_team_member_id, p_date, p_depart, p_retour, v_user_id)
  ON CONFLICT ON CONSTRAINT team_member_day_endpoints_uniq DO UPDATE
     SET depart = EXCLUDED.depart, retour = EXCLUDED.retour, updated_at = now()
  RETURNING e.team_member_id, e.date, e.depart, e.retour;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.team_member_set_day_endpoints(uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_day_endpoints(uuid, date, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
