-- 20260930_14_permissions_purge_surcharges.sql
-- Droits app-level, phase 6 (étape 3) : les surcharges par org (majordhome.role_permissions)
-- ne portent plus que les VRAIS choix d'une org. Photographie prod du 2026-09-30 :
--   Mayer 138 lignes (25 org_admin, 92 = défaut app, 6 hors registre, 15 divergentes),
--   Cimaj 130 lignes (copie de Mayer par org_seed_permissions : 126/130 identiques), H&E 0.
--
-- 1. Lignes `org_admin` : jamais lues (bypass total dans role_can ET resolvePermission).
-- 2. Lignes égales au défaut app (toutes orgs) : résolution inchangée par construction
--    (surcharge == défaut). Inclut pv_calculator / thermal_study, devenues des défauts (20260930_12).
-- 3. Surcharges `delete = true` pour un rôle non-admin : contredisent « supprimer = org_admin
--    uniquement » (Eric, 2026-06-02, reconfirmé 2026-09-30). Restes du Sprint 7, pas des choix.
--    Mayer : commercial/team_leader devis.delete, commercial/team_leader/technicien tasks.delete.
-- 4. Cimaj : héritage du gabarit Mayer, org sans membre non-admin → défauts app (décision Eric).
--
-- Restent chez Mayer 10 surcharges, à lire comme des choix de l'org :
--   commercial.entretiens.edit, commercial.tasks.assign|edit, commercial.voice_recorder.use,
--   team_leader.meta_ads.view, team_leader.tasks.edit_own,
--   technicien.tasks.assign|edit|edit_own, technicien.voice_recorder.use.

-- 1. org_admin
DELETE FROM majordhome.role_permissions WHERE role = 'org_admin';

-- 2. redondantes avec le défaut app
DELETE FROM majordhome.role_permissions rp
USING majordhome.app_role_permissions a
WHERE a.role = rp.role AND a.resource = rp.resource AND a.action = rp.action
  AND a.allowed = rp.allowed;

-- 3. suppression ouverte à un non-admin
DELETE FROM majordhome.role_permissions
WHERE action = 'delete' AND allowed = true;

-- 4. Cimaj (62cd2073-96e0-4300-adae-4c1bb8934546) → défauts app
DELETE FROM majordhome.role_permissions
WHERE org_id = '62cd2073-96e0-4300-adae-4c1bb8934546';
