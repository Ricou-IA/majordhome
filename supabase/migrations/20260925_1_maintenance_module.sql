-- supabase/migrations/20260925_1_maintenance_module.sql
-- ============================================================================
-- Module Maintenance — tâches récurrentes par unité, borne d'atelier, traçabilité
-- (spec docs/superpowers/specs/2026-09-25-module-maintenance-taches-recurrentes-design.md).
--
--   - maint_units / maint_tasks : paramétrage (org_admin), archivage, jamais de DELETE.
--   - maint_operators : signataires de la borne (prénom + PIN). Le hash du PIN n'est
--     JAMAIS lisible par un membre : privilèges colonne + vue sans pin_hash (un hash de
--     4 chiffres se casse hors ligne en une seconde). `has_pin` = colonne générée.
--   - maint_task_logs : journal APPEND-ONLY, aucune policy d'écriture — une réalisation
--     passe uniquement par maint_record_completion, qui vérifie le PIN. Trigger anti
--     UPDATE/DELETE.
--   - maint_digest_runs : anti-doublon de l'e-mail du soir (service_role).
--   - L'échéance n'est PAS stockée : elle se calcule (src/lib/maintenance/echeances.js).
--   - org_id = org CORE. RPC SECURITY DEFINER : auth.uid() NULL refusé, gardes positives,
--     REVOKE PUBLIC/anon (+ authenticated pour la RPC service_role).
-- Répétée sur scripts/migration-rehearsal/ (assert-maintenance.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Unités
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.maint_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES core.organizations(id),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maint_units_id_org_key UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_maint_units_org ON majordhome.maint_units (org_id, sort_order);
COMMENT ON TABLE majordhome.maint_units IS
  'Module Maintenance : unités (machine, ligne, poste) portant des tâches récurrentes. Archivées, jamais supprimées (le journal doit rester lisible).';

-- ----------------------------------------------------------------------------
-- 2. Tâches
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.maint_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES core.organizations(id),
  unit_id        uuid NOT NULL,
  label          text NOT NULL CHECK (length(trim(label)) > 0),
  instructions   text,
  frequency_kind text NOT NULL CHECK (frequency_kind IN ('weekdays', 'interval')),
  weekdays       smallint[],
  interval_unit  text CHECK (interval_unit IN ('day', 'week', 'month')),
  interval_count integer CHECK (interval_count BETWEEN 1 AND 366),
  start_date     date NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Paris')::date),
  sort_order     integer NOT NULL DEFAULT 0,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- FK composite : une tâche ne peut pas pointer l'unité d'une autre org.
  CONSTRAINT maint_tasks_unit_fk FOREIGN KEY (unit_id, org_id) REFERENCES majordhome.maint_units (id, org_id),
  CONSTRAINT maint_tasks_id_org_key UNIQUE (id, org_id),
  CONSTRAINT maint_tasks_frequency_consistent CHECK (
    (frequency_kind = 'weekdays'
      AND weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7
      AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
      AND interval_unit IS NULL AND interval_count IS NULL)
    OR
    (frequency_kind = 'interval'
      AND interval_unit IS NOT NULL AND interval_count IS NOT NULL
      AND weekdays IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_maint_tasks_org_unit ON majordhome.maint_tasks (org_id, unit_id, sort_order);
COMMENT ON TABLE majordhome.maint_tasks IS
  'Module Maintenance : tâche récurrente d''une unité. Fréquence = jours de la semaine (ISO 1-7) OU tous les N jours/semaines/mois. L''échéance se calcule (src/lib/maintenance/echeances.js), elle n''est pas stockée.';

-- ----------------------------------------------------------------------------
-- 3. Opérateurs (signataires de la borne)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.maint_operators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES core.organizations(id),
  first_name      text NOT NULL CHECK (length(trim(first_name)) > 0),
  active          boolean NOT NULL DEFAULT true,
  pin_hash        text,
  has_pin         boolean GENERATED ALWAYS AS (pin_hash IS NOT NULL) STORED,
  failed_attempts smallint NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maint_operators_id_org_key UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_maint_operators_org ON majordhome.maint_operators (org_id, sort_order);
COMMENT ON TABLE majordhome.maint_operators IS
  'Module Maintenance : signataires de la borne (pas des comptes de connexion). pin_hash (bcrypt) illisible par les membres ; écrit par maint_set_operator_pin, vérifié par maint_record_completion (5 échecs ⇒ blocage 15 min).';

-- ----------------------------------------------------------------------------
-- 4. Journal des réalisations (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.maint_task_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES core.organizations(id),
  task_id     uuid NOT NULL,
  unit_id     uuid NOT NULL,
  operator_id uuid NOT NULL,
  status      text NOT NULL CHECK (status IN ('done', 'not_done')),
  comment     text,
  due_date    date NOT NULL,
  done_at     timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL,
  CONSTRAINT maint_task_logs_task_fk FOREIGN KEY (task_id, org_id) REFERENCES majordhome.maint_tasks (id, org_id),
  CONSTRAINT maint_task_logs_unit_fk FOREIGN KEY (unit_id, org_id) REFERENCES majordhome.maint_units (id, org_id),
  CONSTRAINT maint_task_logs_operator_fk FOREIGN KEY (operator_id, org_id) REFERENCES majordhome.maint_operators (id, org_id),
  CONSTRAINT maint_task_logs_comment_required CHECK (status = 'done' OR length(trim(coalesce(comment, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS idx_maint_task_logs_org_done ON majordhome.maint_task_logs (org_id, done_at DESC);
CREATE INDEX IF NOT EXISTS idx_maint_task_logs_task_done ON majordhome.maint_task_logs (task_id, done_at DESC);
COMMENT ON TABLE majordhome.maint_task_logs IS
  'Module Maintenance : journal NON MODIFIABLE des réalisations (fait / pas pu faire). Écriture uniquement via maint_record_completion (PIN vérifié). recorded_by = compte connecté (borne), operator_id = signataire.';

CREATE OR REPLACE FUNCTION majordhome.maint_task_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'maint_log_immutable' USING ERRCODE = '42501',
    DETAIL = 'Le journal de maintenance est non modifiable : une correction s''écrit comme une nouvelle réalisation.';
END;
$$;
DROP TRIGGER IF EXISTS trg_maint_task_logs_append_only ON majordhome.maint_task_logs;
CREATE TRIGGER trg_maint_task_logs_append_only
  BEFORE UPDATE OR DELETE ON majordhome.maint_task_logs
  FOR EACH ROW EXECUTE FUNCTION majordhome.maint_task_logs_append_only();

-- ----------------------------------------------------------------------------
-- 5. Anti-doublon de l'e-mail du soir
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.maint_digest_runs (
  org_id      uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  day         date NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  provider_id text,
  PRIMARY KEY (org_id, day)
);
COMMENT ON TABLE majordhome.maint_digest_runs IS
  'Module Maintenance : e-mail du soir envoyé (org, jour). Posé par maint_digest_mark_sent seulement après une réponse 2xx de Resend.';

-- updated_at
DROP TRIGGER IF EXISTS trg_maint_units_updated_at ON majordhome.maint_units;
CREATE TRIGGER trg_maint_units_updated_at BEFORE UPDATE ON majordhome.maint_units
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();
DROP TRIGGER IF EXISTS trg_maint_tasks_updated_at ON majordhome.maint_tasks;
CREATE TRIGGER trg_maint_tasks_updated_at BEFORE UPDATE ON majordhome.maint_tasks
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();
DROP TRIGGER IF EXISTS trg_maint_operators_updated_at ON majordhome.maint_operators;
CREATE TRIGGER trg_maint_operators_updated_at BEFORE UPDATE ON majordhome.maint_operators
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 6. RLS — lecture membre ; paramétrage org_admin ; journal et digest : aucune écriture
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.maint_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.maint_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.maint_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.maint_task_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.maint_digest_runs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['maint_units', 'maint_tasks', 'maint_operators'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON majordhome.%1$s', t);
    EXECUTE format($p$CREATE POLICY %1$s_select ON majordhome.%1$s FOR SELECT TO authenticated
      USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())))$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_insert_admin ON majordhome.%1$s', t);
    EXECUTE format($p$CREATE POLICY %1$s_insert_admin ON majordhome.%1$s FOR INSERT TO authenticated
      WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om
                             WHERE om.user_id = (SELECT auth.uid()) AND om.role = 'org_admin'))$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_update_admin ON majordhome.%1$s', t);
    EXECUTE format($p$CREATE POLICY %1$s_update_admin ON majordhome.%1$s FOR UPDATE TO authenticated
      USING (org_id IN (SELECT om.org_id FROM core.organization_members om
                        WHERE om.user_id = (SELECT auth.uid()) AND om.role = 'org_admin'))
      WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om
                             WHERE om.user_id = (SELECT auth.uid()) AND om.role = 'org_admin'))$p$, t);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS maint_task_logs_select ON majordhome.maint_task_logs;
CREATE POLICY maint_task_logs_select ON majordhome.maint_task_logs FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
-- maint_task_logs : aucune policy d'écriture. maint_digest_runs : aucune policy (service_role).

-- ----------------------------------------------------------------------------
-- 7. Privilèges — explicites (ACL par défaut du schéma : arwd à anon/authenticated)
-- ----------------------------------------------------------------------------
REVOKE ALL ON majordhome.maint_units, majordhome.maint_tasks, majordhome.maint_operators,
              majordhome.maint_task_logs, majordhome.maint_digest_runs FROM anon, authenticated;
-- Les ACL par défaut du schéma donnent aussi SELECT à baikal_reader (app cohabitante) :
-- il lirait pin_hash. Le module Maintenance ne la concerne pas → retiré.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baikal_reader') THEN
    REVOKE ALL ON majordhome.maint_units, majordhome.maint_tasks, majordhome.maint_operators,
                  majordhome.maint_task_logs, majordhome.maint_digest_runs FROM baikal_reader;
  END IF;
END;
$$;
GRANT SELECT, INSERT, UPDATE ON majordhome.maint_units, majordhome.maint_tasks TO authenticated;
-- Opérateurs : privilèges COLONNE — pin_hash n'est ni lisible ni inscriptible par un membre.
GRANT SELECT (id, org_id, first_name, active, has_pin, failed_attempts, locked_until, sort_order, created_at, updated_at)
  ON majordhome.maint_operators TO authenticated;
GRANT INSERT (org_id, first_name, active, sort_order) ON majordhome.maint_operators TO authenticated;
GRANT UPDATE (first_name, active, sort_order) ON majordhome.maint_operators TO authenticated;
GRANT SELECT ON majordhome.maint_task_logs TO authenticated;
GRANT SELECT ON majordhome.maint_units, majordhome.maint_tasks, majordhome.maint_operators,
                majordhome.maint_task_logs, majordhome.maint_digest_runs TO service_role;

-- ----------------------------------------------------------------------------
-- 8. Vues publiques — miroirs security_invoker (operators SANS pin_hash)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.majordhome_maint_units;
CREATE VIEW public.majordhome_maint_units WITH (security_invoker = true) AS
  SELECT id, org_id, name, description, sort_order, archived_at, created_at, updated_at
    FROM majordhome.maint_units;

DROP VIEW IF EXISTS public.majordhome_maint_tasks;
CREATE VIEW public.majordhome_maint_tasks WITH (security_invoker = true) AS
  SELECT id, org_id, unit_id, label, instructions, frequency_kind, weekdays, interval_unit, interval_count,
         start_date, sort_order, archived_at, created_at, updated_at
    FROM majordhome.maint_tasks;

DROP VIEW IF EXISTS public.majordhome_maint_operators;
CREATE VIEW public.majordhome_maint_operators WITH (security_invoker = true) AS
  SELECT id, org_id, first_name, active, has_pin, failed_attempts, locked_until, sort_order, created_at, updated_at
    FROM majordhome.maint_operators;

DROP VIEW IF EXISTS public.majordhome_maint_task_logs;
CREATE VIEW public.majordhome_maint_task_logs WITH (security_invoker = true) AS
  SELECT id, org_id, task_id, unit_id, operator_id, status, comment, due_date, done_at, recorded_by
    FROM majordhome.maint_task_logs;

-- Dernière réalisation de chaque tâche (lecture seule, DISTINCT ON) : l'échéance en dépend,
-- quelle que soit son ancienneté (tâche mensuelle, annuelle…) — sans relire tout le journal.
DROP VIEW IF EXISTS public.majordhome_maint_last_logs;
CREATE VIEW public.majordhome_maint_last_logs WITH (security_invoker = true) AS
  SELECT DISTINCT ON (task_id)
         id, org_id, task_id, unit_id, operator_id, status, comment, due_date, done_at, recorded_by
    FROM majordhome.maint_task_logs
   ORDER BY task_id, done_at DESC;

DROP VIEW IF EXISTS public.majordhome_maint_digest_runs;
CREATE VIEW public.majordhome_maint_digest_runs WITH (security_invoker = true) AS
  SELECT org_id, day, sent_at, provider_id FROM majordhome.maint_digest_runs;

REVOKE ALL ON public.majordhome_maint_units, public.majordhome_maint_tasks, public.majordhome_maint_operators,
              public.majordhome_maint_task_logs, public.majordhome_maint_last_logs,
              public.majordhome_maint_digest_runs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.majordhome_maint_units, public.majordhome_maint_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.majordhome_maint_operators TO authenticated;
GRANT SELECT ON public.majordhome_maint_task_logs, public.majordhome_maint_last_logs TO authenticated;
GRANT SELECT ON public.majordhome_maint_units, public.majordhome_maint_tasks, public.majordhome_maint_operators,
                public.majordhome_maint_task_logs, public.majordhome_maint_last_logs,
                public.majordhome_maint_digest_runs TO service_role;

-- ----------------------------------------------------------------------------
-- 9. RPC — PIN d'un opérateur (org_admin)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.maint_set_operator_pin(p_operator_id uuid, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core', 'extensions'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT org_id INTO v_org FROM majordhome.maint_operators WHERE id = p_operator_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'operator_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF (EXISTS (SELECT 1 FROM core.organization_members
               WHERE org_id = v_org AND user_id = v_user AND role = 'org_admin')) IS NOT TRUE THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
  IF (p_pin ~ '^[0-9]{4}$') IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid_pin' USING ERRCODE = '22023', DETAIL = 'Le code PIN compte 4 chiffres.';
  END IF;
  UPDATE majordhome.maint_operators
     SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)),
         failed_attempts = 0,
         locked_until = NULL
   WHERE id = p_operator_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.maint_set_operator_pin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maint_set_operator_pin(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.maint_unlock_operator(p_operator_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT org_id INTO v_org FROM majordhome.maint_operators WHERE id = p_operator_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'operator_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF (EXISTS (SELECT 1 FROM core.organization_members
               WHERE org_id = v_org AND user_id = v_user AND role = 'org_admin')) IS NOT TRUE THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;
  UPDATE majordhome.maint_operators SET failed_attempts = 0, locked_until = NULL WHERE id = p_operator_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.maint_unlock_operator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maint_unlock_operator(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. RPC — enregistrer une réalisation (borne)
--     PIN faux / opérateur bloqué ⇒ RETURN {ok:false} et PAS RAISE : un RAISE annulerait
--     l'incrément de failed_attempts (transaction rejouée à blanc) et le blocage ne
--     s'enclencherait jamais. Les erreurs de contrat, elles, lèvent (rien à conserver).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.maint_record_completion(
  p_task_id uuid,
  p_operator_id uuid,
  p_pin text,
  p_status text,
  p_comment text,
  p_due_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core', 'extensions'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_task majordhome.maint_tasks%ROWTYPE;
  v_op majordhome.maint_operators%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_failed int;
  v_locked timestamptz;
  v_log_id uuid;
  v_done_at timestamptz;
  v_max_failed constant int := 5;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_task FROM majordhome.maint_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF (EXISTS (SELECT 1 FROM core.organization_members
               WHERE org_id = v_task.org_id AND user_id = v_user)) IS NOT TRUE THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = '42501';
  END IF;
  IF v_task.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'task_archived' USING ERRCODE = '22023';
  END IF;
  IF (p_status IN ('done', 'not_done')) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'not_done' AND length(trim(coalesce(p_comment, ''))) = 0 THEN
    RAISE EXCEPTION 'comment_required' USING ERRCODE = '22023',
      DETAIL = 'Un « pas pu faire » exige un commentaire.';
  END IF;
  IF (p_due_date <= v_today AND p_due_date >= v_task.start_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid_due_date' USING ERRCODE = '22023',
      DETAIL = format('échéance %s hors bornes (début %s, aujourd''hui %s)', p_due_date, v_task.start_date, v_today);
  END IF;

  SELECT * INTO v_op FROM majordhome.maint_operators
   WHERE id = p_operator_id AND org_id = v_task.org_id
   FOR UPDATE;
  IF NOT FOUND OR v_op.active IS NOT TRUE THEN
    RAISE EXCEPTION 'operator_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_op.locked_until IS NOT NULL AND v_op.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', v_op.locked_until);
  END IF;
  IF v_op.pin_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_pin');
  END IF;

  IF (extensions.crypt(p_pin, v_op.pin_hash) = v_op.pin_hash) IS NOT TRUE THEN
    v_failed := v_op.failed_attempts + 1;
    IF v_failed >= v_max_failed THEN
      v_locked := now() + interval '15 minutes';
      UPDATE majordhome.maint_operators SET failed_attempts = 0, locked_until = v_locked WHERE id = v_op.id;
      RETURN jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', v_locked);
    END IF;
    UPDATE majordhome.maint_operators SET failed_attempts = v_failed, locked_until = NULL WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'pin_invalid', 'remaining', v_max_failed - v_failed);
  END IF;

  IF v_op.failed_attempts <> 0 OR v_op.locked_until IS NOT NULL THEN
    UPDATE majordhome.maint_operators SET failed_attempts = 0, locked_until = NULL WHERE id = v_op.id;
  END IF;

  -- clock_timestamp() et non now() : deux réalisations dans une même transaction gardent
  -- un ordre strict (la « dernière réalisation » d'une tâche ne doit jamais être ambiguë).
  INSERT INTO majordhome.maint_task_logs (org_id, task_id, unit_id, operator_id, status, comment, due_date, done_at, recorded_by)
  VALUES (v_task.org_id, v_task.id, v_task.unit_id, v_op.id, p_status, nullif(trim(p_comment), ''), p_due_date, clock_timestamp(), v_user)
  RETURNING id, done_at INTO v_log_id, v_done_at;

  RETURN jsonb_build_object('ok', true, 'log_id', v_log_id, 'done_at', v_done_at);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.maint_record_completion(uuid, uuid, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maint_record_completion(uuid, uuid, text, text, text, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- 11. RPC — marquer l'e-mail du soir envoyé (edge maintenance-digest, service_role only)
--     Prend org_id en paramètre sans le dériver d'auth.uid() ⇒ fermée à authenticated.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.maint_digest_mark_sent(p_org_id uuid, p_day date, p_provider_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public'
AS $function$
DECLARE
  v_inserted int;
BEGIN
  INSERT INTO majordhome.maint_digest_runs (org_id, day, provider_id)
  VALUES (p_org_id, p_day, p_provider_id)
  ON CONFLICT (org_id, day) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.maint_digest_mark_sent(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maint_digest_mark_sent(uuid, date, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 12. Défauts app-level de la ressource `maintenance` (registre src/lib/permissionsRegistry.js :
--     view = tous les rôles, edit = org_admin seul). Table inerte tant que la Phase 4 des
--     droits app-level n'est pas branchée ; absente du harnais de répétition ⇒ gardée.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('majordhome.app_role_permissions') IS NOT NULL THEN
    INSERT INTO majordhome.app_role_permissions (role, resource, action, allowed) VALUES
      ('team_leader', 'maintenance', 'view', true),
      ('commercial',  'maintenance', 'view', true),
      ('technicien',  'maintenance', 'view', true),
      ('team_leader', 'maintenance', 'edit', false),
      ('commercial',  'maintenance', 'edit', false),
      ('technicien',  'maintenance', 'edit', false)
    ON CONFLICT (role, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;
  END IF;
END;
$$;
