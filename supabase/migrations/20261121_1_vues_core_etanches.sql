-- 20261121_1 — Vues publiques du socle (organisations, profils, membres, projets) : étanches par organisation.
--
-- Constat du 2026-11-21 (ouverture de la 2ᵉ entité, Cimaj), mesuré en production :
--   * public.organizations / profiles / organization_members / projects / admin_users_stats n'avaient pas
--     `security_invoker` : elles s'exécutaient avec les droits de leur propriétaire et contournaient la RLS de `core`.
--   * `anon` et `authenticated` y avaient SELECT, INSERT, UPDATE et DELETE.
--   Conséquences : sans compte, lecture de toutes les organisations (réglages compris, dont le jeton Search Console de
--   Mayer), de tous les profils (e-mails) et de toutes les fiches « projet » (une par client) ; écriture possible.
--   Un utilisateur connecté pouvait en plus se donner `app_role = 'super_admin'` ou changer d'organisation
--   (UPDATE de son propre profil, autorisé par `profiles_update_secure` sur toutes les colonnes).
--
-- Correctif :
--   1. les vues passent en `security_invoker` : la RLS de `core` s'applique à qui interroge ;
--   2. ce que l'écran faisait légitimement grâce au contournement devient une règle écrite : un membre lit les
--      profils de SON organisation (noms des collègues), lit / crée / modifie les projets de SON organisation
--      (un projet naît avec chaque fiche client, quel que soit le rôle) ;
--   3. `anon` n'a plus aucun droit sur ces vues ; `authenticated` ne modifie plus que les colonnes d'usage
--      (nom, avatar, bio d'un profil ; nom, description, réglages d'une organisation — toujours org_admin par la RLS).
--      Rôle, organisation, application, offre et crédits ne s'écrivent que côté serveur (service_role, RPC SECURITY DEFINER).
--
-- Les edges lisent ces vues avec la clé service_role (RLS contournée) : inchangé.

-- 1. Règles « même organisation » -------------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_select_same_org ON core.profiles;
CREATE POLICY profiles_select_same_org ON core.profiles
  FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND org_id = core.rls_get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS projects_select_same_org ON core.projects;
CREATE POLICY projects_select_same_org ON core.projects
  FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND org_id = core.rls_get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS projects_insert_same_org ON core.projects;
CREATE POLICY projects_insert_same_org ON core.projects
  FOR INSERT TO authenticated
  WITH CHECK (org_id IS NOT NULL AND org_id = core.rls_get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS projects_update_same_org ON core.projects;
CREATE POLICY projects_update_same_org ON core.projects
  FOR UPDATE TO authenticated
  USING (org_id IS NOT NULL AND org_id = core.rls_get_user_org_id(auth.uid()))
  WITH CHECK (org_id IS NOT NULL AND org_id = core.rls_get_user_org_id(auth.uid()));

-- 2. Les vues appliquent la RLS de qui interroge ------------------------------------------------------------------

ALTER VIEW public.organizations        SET (security_invoker = true);
ALTER VIEW public.profiles             SET (security_invoker = true);
ALTER VIEW public.organization_members SET (security_invoker = true);
ALTER VIEW public.projects             SET (security_invoker = true);
ALTER VIEW public.admin_users_stats    SET (security_invoker = true);

-- 3. Droits ------------------------------------------------------------------------------------------------------

REVOKE ALL ON public.organizations, public.profiles, public.organization_members, public.projects,
              public.admin_users_stats, public.apps
  FROM PUBLIC, anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.organizations, public.profiles, public.organization_members, public.admin_users_stats, public.apps
  FROM authenticated;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.projects FROM authenticated;

GRANT UPDATE (full_name, avatar_url, bio, updated_at)   ON public.profiles      TO authenticated;
GRANT UPDATE (name, description, settings, updated_at)  ON public.organizations TO authenticated;

-- Mêmes limites sur les tables : le schéma `core` est lui aussi exposé par l'API.
REVOKE ALL ON core.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.profiles      FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.organizations FROM authenticated;
GRANT UPDATE (full_name, avatar_url, bio, updated_at)  ON core.profiles      TO authenticated;
GRANT UPDATE (name, description, settings, updated_at) ON core.organizations TO authenticated;
