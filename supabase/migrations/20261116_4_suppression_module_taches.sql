-- 20261116_4_suppression_module_taches.sql
-- ============================================================================
-- Suppression du module Tâches (décision Eric, 2026-11-16 : « il n'est pas utilisé »).
--
-- Le front a été retiré juste avant, dans le même passage (page /tasks, bouton
-- « Nouvelle tâche », hook, service — commit e8cdd5dc). Reste la base :
--   - vues    public.majordhome_tasks, public.majordhome_task_notes
--   - RPC     create_ / update_ / delete_majordhome_task, create_ / delete_majordhome_task_note
--   - tables  majordhome.tasks (18 lignes), majordhome.task_notes (0 ligne)
--   - trigger majordhome.tasks_updated_at()
--   - droits  ressource « tasks » : 18 défauts app + 6 surcharges Mayer
--
-- IRRÉVERSIBLE : les 18 tâches sont perdues (liste montrée à Eric avant accord).
-- Aucun autre appelant : ni le site vitrine, ni les 63 workflows N8N, ni un cron, ni la
-- RPC des mémos vocaux (vérifié sur pg_proc.prosrc et la base N8N le 2026-11-16).
--
-- Volontairement SANS « CASCADE » : un objet dépendant inattendu doit faire échouer la
-- migration, pas disparaître avec elle. À ne pas confondre avec le module Maintenance
-- (majordhome.maint_tasks, maint_task_logs — tâches récurrentes), qui n'est pas touché.
-- ============================================================================

-- 1. Vues publiques
DROP VIEW IF EXISTS public.majordhome_task_notes;
DROP VIEW IF EXISTS public.majordhome_tasks;

-- 2. RPC (trois d'entre elles retournent le type de ligne des tables : avant les tables)
DROP FUNCTION IF EXISTS public.create_majordhome_task(jsonb);
DROP FUNCTION IF EXISTS public.update_majordhome_task(uuid, jsonb);
DROP FUNCTION IF EXISTS public.delete_majordhome_task(uuid);
DROP FUNCTION IF EXISTS public.create_majordhome_task_note(uuid, text);
DROP FUNCTION IF EXISTS public.delete_majordhome_task_note(uuid);

-- 3. Tables (policies, contraintes et trigger partent avec elles)
DROP TABLE IF EXISTS majordhome.task_notes;
DROP TABLE IF EXISTS majordhome.tasks;
DROP FUNCTION IF EXISTS majordhome.tasks_updated_at();

-- 4. Droits : la ressource « tasks » sort du registre (src/lib/permissionsRegistry.js).
--    Surcharges par org d'abord, défauts app ensuite.
DELETE FROM majordhome.role_permissions     WHERE resource = 'tasks';
DELETE FROM majordhome.app_role_permissions WHERE resource = 'tasks';

-- 5. Contrôle : plus rien du module, et le module Maintenance est intact.
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('majordhome.tasks') IS NOT NULL OR to_regclass('majordhome.task_notes') IS NOT NULL
     OR to_regclass('public.majordhome_tasks') IS NOT NULL OR to_regclass('public.majordhome_task_notes') IS NOT NULL THEN
    RAISE EXCEPTION 'suppression Tâches : une table ou une vue existe encore';
  END IF;

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname IN ('public', 'majordhome')
     AND (p.proname ~ '^(create|update|delete)_majordhome_task(_note)?$' OR p.proname = 'tasks_updated_at');
  IF n <> 0 THEN RAISE EXCEPTION 'suppression Tâches : % fonction(s) restante(s)', n; END IF;

  SELECT (SELECT count(*) FROM majordhome.app_role_permissions WHERE resource = 'tasks')
       + (SELECT count(*) FROM majordhome.role_permissions WHERE resource = 'tasks') INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'suppression Tâches : % ligne(s) de droits restante(s)', n; END IF;

  -- Homonymes du module Maintenance : ils doivent toujours être là.
  IF to_regclass('majordhome.maint_tasks') IS NULL OR to_regclass('majordhome.maint_task_logs') IS NULL
     OR to_regclass('public.majordhome_maint_tasks') IS NULL OR to_regclass('public.majordhome_maint_task_logs') IS NULL THEN
    RAISE EXCEPTION 'suppression Tâches : le module Maintenance (maint_tasks) a été touché';
  END IF;
END $$;
