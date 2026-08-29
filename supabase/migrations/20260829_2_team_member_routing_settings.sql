-- 20260829_2_team_member_routing_settings.sql
-- Écriture des réglages de tournée d'un technicien depuis /settings/team.
-- Spec : docs/superpowers/specs/2026-08-29-optimisation-tournees-entretiens-design.md
--
-- Pourquoi une RPC : `majordhome.team_members` n'est pas écrivable via PostgREST
-- (schéma non exposé), et la vue publique est en lecture pour ce cas d'usage.
-- Le pattern est copié sur `team_member_set_calendar_color`, seule voie d'écriture
-- existante vers cette table.
--
-- Pourquoi UNE RPC pour deux champs plutôt que deux mono-champ (comme
-- calendar_color) : ces deux réglages forment un tout — « comment ce membre
-- participe aux tournées ». Ajouter une RPC par colonne est ce qui a produit la
-- dette actuelle ; un 3ᵉ réglage de tournée entrera ici plutôt que dans une
-- 3ᵉ fonction. Les deux paramètres sont nullables : passer NULL laisse le champ
-- inchangé (patch partiel).

CREATE OR REPLACE FUNCTION public.team_member_set_routing_settings(
  p_team_member_id      uuid,
  p_daily_work_minutes  integer DEFAULT NULL,
  p_include_in_routing  boolean DEFAULT NULL
)
RETURNS TABLE (daily_work_minutes integer, include_in_routing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_user_id     uuid := auth.uid();
  v_core_org_id uuid;
  v_role        text;
BEGIN
  -- Posture frontend : pas d'appelant anonyme, traité en première instruction.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;

  -- Une journée de travail hors de ces bornes est une faute de saisie, pas un
  -- réglage : la laisser passer produirait des tournées absurdes en silence.
  IF p_daily_work_minutes IS NOT NULL
     AND (p_daily_work_minutes < 60 OR p_daily_work_minutes > 1440) THEN
    RAISE EXCEPTION 'Budget journalier hors bornes (60-1440 min): %', p_daily_work_minutes
      USING ERRCODE = '22023';
  END IF;

  SELECT o.core_org_id INTO v_core_org_id
  FROM majordhome.team_members tm
  JOIN majordhome.organizations o ON o.id = tm.org_id
  WHERE tm.id = p_team_member_id;

  IF v_core_org_id IS NULL THEN
    RAISE EXCEPTION 'Team member % introuvable', p_team_member_id USING ERRCODE = 'P0002';
  END IF;

  SELECT role INTO v_role
  FROM core.organization_members
  WHERE user_id = v_user_id AND org_id = v_core_org_id;

  -- Garde en autorisation positive : `IS DISTINCT FROM` refuse aussi un rôle NULL
  -- (utilisateur sans appartenance), là où `!=` laisserait passer.
  IF v_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'Seul un org_admin peut modifier les reglages de tournee (role=%)', v_role
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE majordhome.team_members tm
     SET daily_work_minutes = COALESCE(p_daily_work_minutes, tm.daily_work_minutes),
         include_in_routing = COALESCE(p_include_in_routing, tm.include_in_routing),
         updated_at         = NOW()
   WHERE tm.id = p_team_member_id
  RETURNING tm.daily_work_minutes, tm.include_in_routing;
END;
$function$;

-- PUBLIC n'est PAS optionnel : PostgreSQL accorde EXECUTE à PUBLIC par défaut sur
-- toute fonction créée, et anon en hérite. Un REVOKE … FROM anon seul réussirait
-- sans rien retirer.
REVOKE EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_set_routing_settings(uuid, integer, boolean)
  TO authenticated;
