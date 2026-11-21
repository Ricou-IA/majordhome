-- 20261121_3 — Changement de rôle d'un membre : borné à l'organisation et aux rôles de l'application.
--
-- Constat du 2026-11-21 (test « un membre créé dans Majord'home est administrable »), mesuré en production :
--   `core.update_member_role` vérifiait que l'APPELANT est administrateur de `p_org_id`, mais jamais que la CIBLE
--   en est membre, ni que le rôle demandé est un rôle de l'application. Un administrateur d'une organisation pouvait
--   donc : (1) réécrire le rôle du profil d'un membre d'une AUTRE organisation ; (2) se donner `app_role = 'super_admin'`
--   (le garde « ne pas se retirer admin » ne regarde que le rôle d'adhésion), donc lire toutes les organisations.
--   Les deux fonctions (enveloppe `public` et cœur `core`) étaient en plus exécutables par `anon`.
--
-- Correctif : la cible doit être membre actif de l'organisation ; les rôles sont pris dans des listes fermées
-- (celles de ROLE_DB_MAPPING, `src/lib/permissions.js`) ; `anon` et PUBLIC n'exécutent plus rien.

CREATE OR REPLACE FUNCTION core.update_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_app_role text,
  p_business_role text DEFAULT NULL,
  p_membership_role text DEFAULT 'member'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core', 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_cible_membre boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Seul un administrateur peut changer les rôles' USING ERRCODE = '42501';
  END IF;

  -- L'appelant est administrateur de l'organisation
  SELECT role INTO v_caller_role
  FROM core.organization_members
  WHERE org_id = p_org_id AND user_id = auth.uid() AND status = 'active';

  IF v_caller_role IS DISTINCT FROM 'org_admin' THEN
    RAISE EXCEPTION 'Seul un administrateur peut changer les rôles' USING ERRCODE = '42501';
  END IF;

  -- La cible est membre actif de CETTE organisation
  SELECT EXISTS (
    SELECT 1 FROM core.organization_members
    WHERE org_id = p_org_id AND user_id = p_user_id AND status = 'active'
  ) INTO v_cible_membre;

  IF v_cible_membre IS NOT TRUE THEN
    RAISE EXCEPTION 'Ce membre n''appartient pas à votre organisation' USING ERRCODE = '42501';
  END IF;

  -- Rôles de l'application uniquement (jamais super_admin)
  IF p_app_role IS NULL OR p_app_role NOT IN ('org_admin', 'team_leader', 'user') THEN
    RAISE EXCEPTION 'Rôle inconnu : %', coalesce(p_app_role, 'NULL') USING ERRCODE = '22023';
  END IF;
  IF p_membership_role IS NULL OR p_membership_role NOT IN ('org_admin', 'team_leader', 'member') THEN
    RAISE EXCEPTION 'Rôle d''adhésion inconnu : %', coalesce(p_membership_role, 'NULL') USING ERRCODE = '22023';
  END IF;

  -- Empêcher de se retirer soi-même le rôle admin
  IF p_user_id = auth.uid() AND (p_membership_role <> 'org_admin' OR p_app_role <> 'org_admin') THEN
    RAISE EXCEPTION 'Vous ne pouvez pas retirer votre propre rôle administrateur';
  END IF;

  UPDATE core.profiles
  SET app_role = p_app_role,
      business_role = p_business_role,
      updated_at = now()
  WHERE id = p_user_id;

  UPDATE core.organization_members
  SET role = p_membership_role
  WHERE org_id = p_org_id AND user_id = p_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION core.update_member_role(uuid, uuid, text, text, text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_member_role(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION core.update_member_role(uuid, uuid, text, text, text)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.update_member_role(uuid, uuid, text, text, text) TO authenticated, service_role;
