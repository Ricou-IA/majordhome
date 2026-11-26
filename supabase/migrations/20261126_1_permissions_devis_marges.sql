-- 20261126_1_permissions_devis_marges.sql — droit « Voir les marges » du devis, réglable par rôle
-- Eric 2026-11-26 : Philippe Mazel (responsable) ne voyait plus l'interrupteur « Afficher les marges »,
-- réservé à l'administrateur par le brief UX P0-11. Nouvelle action devis/marges dans le registre
-- (src/lib/permissionsRegistry.js, source unique) : responsable oui, commercial et technicien non.
-- Garde d'écran seulement (sql: null) : aucune policy ne change. Lignes tirées de
-- `node scripts/gen-app-role-permissions-sql.mjs` ; idempotent (upsert sur role, resource, action).
INSERT INTO majordhome.app_role_permissions (role, resource, action, allowed) VALUES
  ('team_leader','devis','marges',true),
  ('commercial','devis','marges',false),
  ('technicien','devis','marges',false)
ON CONFLICT (role, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;
