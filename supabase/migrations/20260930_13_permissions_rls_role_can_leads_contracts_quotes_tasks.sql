-- 20260930_13_permissions_rls_role_can_leads_contracts_quotes_tasks.sql
-- Droits app-level, phase 4 (étape 2) : les écritures de leads / contracts / quotes / tasks
-- passent par majordhome.role_can(org_id, resource, action), comme clients / equipments /
-- interventions depuis juin. Spec : docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md
-- Décision Eric (2026-09-30, reconfirmée) : SUPPRIMER = org_admin uniquement, toute entité.
--
-- Avant : « tout membre de l'org peut tout faire » (INSERT/UPDATE/DELETE), y compris supprimer
-- un contrat ou un devis ; seul l'écran retenait la main. Après :
--   leads     → pipeline.create | pipeline.edit OU edit_own | pipeline.delete
--   contracts → clients.edit (le contrat fait partie de la fiche, décision 2) | clients.delete
--   quotes    → devis.create | devis.edit | devis.delete
--   tasks     → tasks.create | tasks.edit OU edit_own | tasks.delete
-- « edit_own » : la base autorise dès que le rôle a edit OU edit_own ; le « c'est le mien »
-- reste tenu par l'écran (un commercial touche des leads qui ne sont pas les siens :
-- rattachement de devis, fusion…). À durcir en base si besoin, pas ici.
-- appointments : hors périmètre (supprimer un RDV est un geste de planning quotidien —
-- la déplanification passe par deleteAppointment —, pas une perte de donnée).
-- Les SELECT ne changent pas. Les RPC SECURITY DEFINER et service_role ne sont pas concernés.
-- Vérifié par impersonation sur le harnais : scripts/migration-rehearsal/assert-permissions.sql

-- Privilèges de l'arbitre : explicites (la prod les a déjà ; le harnais ne les reproduit pas).
REVOKE EXECUTE ON FUNCTION majordhome.role_can(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION majordhome.user_effective_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION majordhome.role_can(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION majordhome.user_effective_role(uuid) TO authenticated, service_role;

-- ── leads (resource pipeline) ────────────────────────────────────────────────
DROP POLICY IF EXISTS leads_insert_org_members ON majordhome.leads;
DROP POLICY IF EXISTS leads_update_org_members ON majordhome.leads;
DROP POLICY IF EXISTS leads_delete_org_members ON majordhome.leads;

CREATE POLICY leads_insert_role_can ON majordhome.leads
  FOR INSERT TO PUBLIC
  WITH CHECK (majordhome.role_can(org_id, 'pipeline', 'create'));

CREATE POLICY leads_update_role_can ON majordhome.leads
  FOR UPDATE TO PUBLIC
  USING (majordhome.role_can(org_id, 'pipeline', 'edit') OR majordhome.role_can(org_id, 'pipeline', 'edit_own'))
  WITH CHECK (majordhome.role_can(org_id, 'pipeline', 'edit') OR majordhome.role_can(org_id, 'pipeline', 'edit_own'));

CREATE POLICY leads_delete_role_can ON majordhome.leads
  FOR DELETE TO PUBLIC
  USING (majordhome.role_can(org_id, 'pipeline', 'delete'));

-- ── contracts (sous la resource clients) ────────────────────────────────────
DROP POLICY IF EXISTS contracts_insert_org_member ON majordhome.contracts;
DROP POLICY IF EXISTS contracts_update_org_member ON majordhome.contracts;
DROP POLICY IF EXISTS contracts_delete_org_member ON majordhome.contracts;

CREATE POLICY contracts_insert_role_can ON majordhome.contracts
  FOR INSERT TO PUBLIC
  WITH CHECK (majordhome.role_can(org_id, 'clients', 'edit'));

CREATE POLICY contracts_update_role_can ON majordhome.contracts
  FOR UPDATE TO PUBLIC
  USING (majordhome.role_can(org_id, 'clients', 'edit'))
  WITH CHECK (majordhome.role_can(org_id, 'clients', 'edit'));

CREATE POLICY contracts_delete_role_can ON majordhome.contracts
  FOR DELETE TO PUBLIC
  USING (majordhome.role_can(org_id, 'clients', 'delete'));

-- ── quotes (resource devis) ─────────────────────────────────────────────────
DROP POLICY IF EXISTS quotes_insert ON majordhome.quotes;
DROP POLICY IF EXISTS quotes_update ON majordhome.quotes;
DROP POLICY IF EXISTS quotes_delete ON majordhome.quotes;

CREATE POLICY quotes_insert_role_can ON majordhome.quotes
  FOR INSERT TO PUBLIC
  WITH CHECK (majordhome.role_can(org_id, 'devis', 'create'));

CREATE POLICY quotes_update_role_can ON majordhome.quotes
  FOR UPDATE TO PUBLIC
  USING (majordhome.role_can(org_id, 'devis', 'edit'))
  WITH CHECK (majordhome.role_can(org_id, 'devis', 'edit'));

CREATE POLICY quotes_delete_role_can ON majordhome.quotes
  FOR DELETE TO PUBLIC
  USING (majordhome.role_can(org_id, 'devis', 'delete'));

-- ── tasks (resource tasks) ──────────────────────────────────────────────────
-- Avant : DELETE = l'auteur de la tâche. Après : org_admin (décision « toute entité »).
DROP POLICY IF EXISTS tasks_insert ON majordhome.tasks;
DROP POLICY IF EXISTS tasks_update ON majordhome.tasks;
DROP POLICY IF EXISTS tasks_delete ON majordhome.tasks;

CREATE POLICY tasks_insert_role_can ON majordhome.tasks
  FOR INSERT TO PUBLIC
  WITH CHECK (majordhome.role_can(org_id, 'tasks', 'create'));

CREATE POLICY tasks_update_role_can ON majordhome.tasks
  FOR UPDATE TO PUBLIC
  USING (majordhome.role_can(org_id, 'tasks', 'edit') OR majordhome.role_can(org_id, 'tasks', 'edit_own'))
  WITH CHECK (majordhome.role_can(org_id, 'tasks', 'edit') OR majordhome.role_can(org_id, 'tasks', 'edit_own'));

CREATE POLICY tasks_delete_role_can ON majordhome.tasks
  FOR DELETE TO PUBLIC
  USING (majordhome.role_can(org_id, 'tasks', 'delete'));
