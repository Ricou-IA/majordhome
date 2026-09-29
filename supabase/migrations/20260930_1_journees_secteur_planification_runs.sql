-- ============================================================================
-- 20260930_1 — Auto-RDV tranche 1 « Voir » (spec 2026-09-29 § 3.1, § 3.3, § 4.3)
-- ============================================================================
-- 1. majordhome.journees_secteur : étiquette de secteur d'une journée de
--    technicien + trace du figeage (figee_at / figee_par). org_id = org CORE.
--    Une journée est disponible par nature : personne ne l'ouvre, l'étiquette
--    dit seulement à quel secteur elle est dédiée (déduite des RDV posés,
--    posée par la machine, ou corrigée à la main).
-- 2. majordhome.planification_runs : journal des passages des crons de
--    planification (tournees-figer aujourd'hui, auto-rdv-* demain). Avant, le
--    rapport du cron n'existait que dans net._http_response : personne ne
--    pouvait savoir si une journée avait été figée par la machine.
-- 3. majordhome.figer_journee(...) : le figeage atomique, appelé par la RPC
--    service_role du cron ET par une RPC authentifiée pour le bouton « Figer
--    la journée ». Avant, le bouton bouclait sur updateAppointment, RDV par
--    RDV, non atomique.
-- ============================================================================

-- ── 1. journees_secteur ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS majordhome.journees_secteur (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  date            date NOT NULL,
  team_member_id  uuid NOT NULL REFERENCES majordhome.team_members(id) ON DELETE CASCADE,
  grand_secteur   text,
  origine         text NOT NULL DEFAULT 'deduite' CHECK (origine IN ('deduite', 'machine', 'humain')),
  figee_at        timestamptz,
  figee_par       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, team_member_id, date)
);
COMMENT ON TABLE majordhome.journees_secteur IS
  'Étiquette de secteur d''une journée de technicien (déduite des RDV posés, posée par la machine, ou corrigée à la main) + trace du figeage. org_id = org CORE. Une journée est disponible par nature : personne ne l''ouvre.';
COMMENT ON COLUMN majordhome.journees_secteur.origine IS 'deduite (RDV déjà posés) · machine (journée vide étiquetée par le cron) · humain (corrigée dans le Planning).';
COMMENT ON COLUMN majordhome.journees_secteur.figee_par IS '''cron'' ou ''user:<uuid>''.';

DROP TRIGGER IF EXISTS trg_journees_secteur_updated_at ON majordhome.journees_secteur;
CREATE TRIGGER trg_journees_secteur_updated_at BEFORE UPDATE ON majordhome.journees_secteur
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

-- ── 2. planification_runs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS majordhome.planification_runs (
  id        bigserial PRIMARY KEY,
  org_id    uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  job       text NOT NULL CHECK (job IN ('tournees-figer', 'auto-rdv-ouverture', 'auto-rdv-relances')),
  ran_at    timestamptz NOT NULL DEFAULT now(),
  dry_run   boolean NOT NULL DEFAULT false,
  rapport   jsonb NOT NULL DEFAULT '{}'::jsonb,
  duree_ms  integer,
  erreur    text
);
CREATE INDEX IF NOT EXISTS planification_runs_org_job_ran_idx
  ON majordhome.planification_runs (org_id, job, ran_at DESC);
COMMENT ON TABLE majordhome.planification_runs IS
  'Journal des passages des crons de planification (tournees-figer, auto-rdv-*). Écrit par les edges (service_role), même en échec. Lu par le Dashboard entretiens.';

-- ── 3. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE majordhome.journees_secteur   ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.planification_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journees_secteur_select ON majordhome.journees_secteur;
CREATE POLICY journees_secteur_select ON majordhome.journees_secteur FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS journees_secteur_write ON majordhome.journees_secteur;
CREATE POLICY journees_secteur_write ON majordhome.journees_secteur FOR ALL TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om
                    WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('org_admin', 'team_leader')))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om
                         WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('org_admin', 'team_leader')));

DROP POLICY IF EXISTS planification_runs_select ON majordhome.planification_runs;
CREATE POLICY planification_runs_select ON majordhome.planification_runs FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
-- planification_runs : aucune policy d'écriture (service_role seulement, bypass RLS).

-- ── 4. Privilèges (explicites : les ACL par défaut du schéma donnent arwd à anon/authenticated) ──
REVOKE ALL ON majordhome.journees_secteur, majordhome.planification_runs FROM anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baikal_reader') THEN
    REVOKE ALL ON majordhome.journees_secteur, majordhome.planification_runs FROM baikal_reader;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.journees_secteur TO authenticated;
GRANT SELECT ON majordhome.planification_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.journees_secteur TO service_role;
GRANT SELECT, INSERT ON majordhome.planification_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE majordhome.planification_runs_id_seq TO service_role;

-- ── 5. Vues publiques (miroirs simples, updatable, security_invoker) ───────
DROP VIEW IF EXISTS public.majordhome_journees_secteur;
CREATE VIEW public.majordhome_journees_secteur WITH (security_invoker = true) AS
  SELECT id, org_id, date, team_member_id, grand_secteur, origine, figee_at, figee_par, created_at, updated_at
  FROM majordhome.journees_secteur;
DROP VIEW IF EXISTS public.majordhome_planification_runs;
CREATE VIEW public.majordhome_planification_runs WITH (security_invoker = true) AS
  SELECT id, org_id, job, ran_at, dry_run, rapport, duree_ms, erreur
  FROM majordhome.planification_runs;

REVOKE ALL ON public.majordhome_journees_secteur, public.majordhome_planification_runs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_journees_secteur TO authenticated, service_role;
GRANT SELECT ON public.majordhome_planification_runs TO authenticated;
GRANT SELECT, INSERT ON public.majordhome_planification_runs TO service_role;

-- ── 6. Figeage atomique partagé ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.figer_journee(p_mdh_org_id uuid, p_lignes jsonb, p_par text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_ligne   jsonb;
  v_refuses text[] := '{}';
  v_now     timestamptz := now();
  v_count   int := 0;
  v_core    uuid;
  r         record;
BEGIN
  IF p_mdh_org_id IS NULL OR p_lignes IS NULL OR jsonb_typeof(p_lignes) <> 'array' THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;
  SELECT o.core_org_id INTO v_core FROM majordhome.organizations o WHERE o.id = p_mdh_org_id;
  IF v_core IS NULL THEN RAISE EXCEPTION 'org_not_found'; END IF;

  -- 1. Chaque RDV doit être exactement tel que l'ordonnanceur l'a vu : même
  --    heure, encore adaptable, pas clos, d'un type concerné par la souplesse.
  FOR v_ligne IN SELECT * FROM jsonb_array_elements(p_lignes) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM majordhome.appointments a
      WHERE a.id = (v_ligne->>'id')::uuid
        AND a.org_id = p_mdh_org_id
        AND a.scheduled_start = (v_ligne->>'attendu')::time
        AND a.hour_confirmed_at IS NULL
        AND coalesce(a.time_flex_minutes, -1) <> 0
        AND a.status NOT IN ('cancelled', 'completed', 'no_show')
        AND a.appointment_type IN ('maintenance', 'service')
    ) THEN
      v_refuses := array_append(v_refuses, v_ligne->>'id');
    END IF;
  END LOOP;
  IF coalesce(array_length(v_refuses, 1), 0) > 0 THEN
    RETURN jsonb_build_object('figes', 0, 'refuses', to_jsonb(v_refuses));
  END IF;

  -- 2. Heures définitives : le bloc suit le barème (R1), l'ancre = l'heure annoncée.
  FOR v_ligne IN SELECT * FROM jsonb_array_elements(p_lignes) LOOP
    UPDATE majordhome.appointments a SET
      scheduled_start   = (v_ligne->>'scheduled_start')::time,
      scheduled_end     = (v_ligne->>'scheduled_end')::time,
      duration_minutes  = (v_ligne->>'duration_minutes')::int,
      time_flex_minutes = 0,
      hour_confirmed_at = v_now,
      announced_start   = (v_ligne->>'scheduled_start')::time,
      updated_at        = v_now
    WHERE a.id = (v_ligne->>'id')::uuid AND a.org_id = p_mdh_org_id;
    v_count := v_count + 1;
  END LOOP;

  -- 3. Trace du figeage sur l'étiquette de chaque (date, technicien) concerné.
  FOR r IN
    SELECT DISTINCT a.scheduled_date AS d, at.technician_id AS tech
    FROM jsonb_array_elements(p_lignes) l
    JOIN majordhome.appointments a ON a.id = (l->>'id')::uuid
    JOIN majordhome.appointment_technicians at ON at.appointment_id = a.id
  LOOP
    INSERT INTO majordhome.journees_secteur (org_id, date, team_member_id, origine, figee_at, figee_par)
    VALUES (v_core, r.d, r.tech, 'deduite', v_now, p_par)
    ON CONFLICT (org_id, team_member_id, date) DO UPDATE
      SET figee_at = EXCLUDED.figee_at, figee_par = EXCLUDED.figee_par, updated_at = v_now;
  END LOOP;

  RETURN jsonb_build_object('figes', v_count, 'refuses', '[]'::jsonb);
END
$$;
REVOKE EXECUTE ON FUNCTION majordhome.figer_journee(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION majordhome.figer_journee(uuid, jsonb, text) IS
  'Figeage atomique d''une journée ordonnancée (heures définitives + trace sur journees_secteur). Interne : appelée par tournees_figer_journee (cron) et tournees_figer_journee_user (bouton).';

-- 6a. RPC du cron : signature inchangée, service_role only (p_org_id vient du payload).
CREATE OR REPLACE FUNCTION public.tournees_figer_journee(p_org_id uuid, p_lignes jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
  SELECT majordhome.figer_journee(p_org_id, p_lignes, 'cron');
$$;
REVOKE EXECUTE ON FUNCTION public.tournees_figer_journee(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tournees_figer_journee(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.tournees_figer_journee(uuid, jsonb) IS
  'Figeage d''une journée ordonnancée (edge tournees-figer). service_role only ; tout ou rien si un RDV a changé depuis l''ordonnancement.';

-- 6b. RPC du bouton « Figer la journée » : posture frontend. L'org est celle des
--     RDV (jamais du payload) ; l'appelant doit être org_admin ou team_leader de
--     l'org CORE correspondante. Garde positive (IS NOT TRUE), auth.uid() NULL
--     refusé en première instruction.
CREATE OR REPLACE FUNCTION public.tournees_figer_journee_user(p_lignes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_mdh   uuid;
  v_core  uuid;
  v_ok    boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_lignes IS NULL OR jsonb_typeof(p_lignes) <> 'array' OR jsonb_array_length(p_lignes) = 0 THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;
  SELECT a.org_id INTO v_mdh FROM majordhome.appointments a
   WHERE a.id = (p_lignes->0->>'id')::uuid;
  IF v_mdh IS NULL THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lignes) l
    JOIN majordhome.appointments a ON a.id = (l->>'id')::uuid
    WHERE a.org_id <> v_mdh
  ) THEN RAISE EXCEPTION 'mixed_orgs'; END IF;
  SELECT o.core_org_id INTO v_core FROM majordhome.organizations o WHERE o.id = v_mdh;
  SELECT EXISTS (
    SELECT 1 FROM core.organization_members om
    WHERE om.user_id = v_uid AND om.org_id = v_core AND om.role IN ('org_admin', 'team_leader')
  ) INTO v_ok;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN majordhome.figer_journee(v_mdh, p_lignes, 'user:' || v_uid::text);
END
$$;
REVOKE EXECUTE ON FUNCTION public.tournees_figer_journee_user(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tournees_figer_journee_user(jsonb) TO authenticated;
COMMENT ON FUNCTION public.tournees_figer_journee_user(jsonb) IS
  'Figeage atomique d''une journée depuis le bouton « Figer la journée ». Org dérivée des RDV ; org_admin/team_leader seulement.';
