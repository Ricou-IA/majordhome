-- ============================================================================
-- 20260916_3 — Mouchard : journal d'audit des modifications (leads, appointments)
-- ============================================================================
-- Pourquoi : l'Historique d'un lead est DÉCLARATIF — le front écrit une activité
-- quand il y pense (`status_changed`, `lead_assigned`, note), avec un `user_id`
-- qu'il déclare lui-même dans le payload de `create_majordhome_lead_activity`.
-- Toute écriture qui ne passe pas par là est invisible : « Enregistrer » dans la
-- modale (date du RDV, montant, probabilité, notes…), drag dans le planning,
-- crons Pennylane, N8N, site vitrine. Vécu le 2026-09-16 (lead PERRON) : lead ET
-- RDV modifiés à 15:05:30, aucune trace de quoi ni par qui.
--
-- Principe : un trigger AFTER générique enregistre, pour chaque ligne écrite,
--   QUI    — auth.uid() lu côté serveur (infalsifiable par le front)
--   QUAND  — changed_at
--   QUOI   — changed_fields + old_values / new_values LIMITÉS aux champs modifiés
--   PAR OÙ — `source` = nom de la RPC ou de la vue extrait de current_query()
--            (update_majordhome_lead = fiche lead, majordhome_appointments =
--            planning, pennylane_* = synchro, create_lead_from_webhook = N8N…)
--   RÔLE   — claim JWT (authenticated / service_role) ou session_user (pg_cron)
--
-- Invariants :
--   * Table APPEND-ONLY : le trigger (SECURITY DEFINER) est le seul écrivain ;
--     aucun GRANT INSERT/UPDATE/DELETE, à personne.
--   * Pas de FK vers l'entité : la piste survit à un hard delete (ligne DELETE
--     + tout l'historique restent lisibles).
--   * org_id normalisé sur l'org CORE : `appointments.org_id` porte l'org
--     majordhome (7825…) là où `leads.org_id` porte l'org core (3c68…) → mapping
--     via majordhome.organizations.core_org_id, sinon la RLS et le filtre front
--     seraient incohérents entre les deux tables.
--   * UPDATE sans champ utile (hors colonnes bruit) → AUCUNE ligne. Les doubles
--     écritures « RDV planifié → RDV planifié » ne polluent pas le journal.
--   * FAIL-SAFE : une erreur du trigger ne bloque JAMAIS l'écriture métier —
--     elle part en WARNING dans les logs Postgres. Vérifier la production réelle
--     de lignes après déploiement (une écriture depuis l'app → 1 ligne attendue).
--
-- Extension : ajouter une table = 1 CREATE TRIGGER (la fonction est générique ;
-- l'argument = liste CSV des colonnes bruit à ignorer). Candidates : clients,
-- contracts, interventions, appointment_technicians (pas de colonne id → adapter).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid,                          -- org CORE (nullable : ligne orpheline = forensics SQL seulement)
  table_name      text NOT NULL,
  record_id       uuid NOT NULL,
  lead_id         uuid,                          -- rattache les modifs d'un RDV à sa fiche lead
  action          text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_fields  text[] NOT NULL DEFAULT '{}',
  old_values      jsonb,                         -- champs modifiés uniquement (DELETE : ligne entière)
  new_values      jsonb,                         -- champs modifiés uniquement (INSERT : ligne entière)
  changed_by      uuid,                          -- auth.uid() ; NULL = automatisation / SQL direct
  changed_by_role text,                          -- authenticated | service_role | anon | postgres…
  source          text,                          -- RPC / vue d'entrée (extrait de current_query())
  changed_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE majordhome.audit_log IS
  'Mouchard : journal append-only des écritures (leads, appointments). Écrit uniquement par le trigger majordhome.audit_row_change(). changed_by = auth.uid() côté serveur.';

CREATE INDEX IF NOT EXISTS idx_audit_log_record
  ON majordhome.audit_log (org_id, table_name, record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_lead
  ON majordhome.audit_log (org_id, lead_id, changed_at DESC)
  WHERE lead_id IS NOT NULL;

-- Lecture : membres de l'org (transparence = dissuasion ; l'Historique de la
-- fiche est déjà partagé). Écriture : personne (trigger SECURITY DEFINER).
ALTER TABLE majordhome.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_select_org_members ON majordhome.audit_log;
CREATE POLICY audit_log_select_org_members ON majordhome.audit_log
  FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
    )
  );

-- Les privilèges PAR DÉFAUT du schéma accordent ALL à authenticated/service_role
-- sur toute nouvelle table : on retire tout, puis on ne rend que SELECT.
REVOKE ALL ON majordhome.audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON majordhome.audit_log TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Fonction trigger générique
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_ignored   text[] := CASE WHEN TG_NARGS > 0 THEN string_to_array(TG_ARGV[0], ',') ELSE '{}'::text[] END;
  v_old       jsonb  := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new       jsonb  := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_row       jsonb  := COALESCE(v_new, v_old);
  v_changed   text[];
  v_old_diff  jsonb;
  v_new_diff  jsonb;
  v_claims    jsonb;
  v_uid       uuid;
  v_role      text;
  v_source    text;
  v_org       uuid;
  v_core_org  uuid;
  v_lead_id   uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(n.key ORDER BY n.key), '{}'::text[])
      INTO v_changed
      FROM jsonb_each(v_new) n
     WHERE NOT (n.key = ANY (v_ignored))
       AND n.value IS DISTINCT FROM (v_old -> n.key);

    -- Rien d'utile n'a bougé (ex. updated_at seul) → pas de ligne.
    IF COALESCE(array_length(v_changed, 1), 0) = 0 THEN
      RETURN NULL;
    END IF;

    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_old_diff, v_new_diff
      FROM unnest(v_changed) AS k;

  ELSIF TG_OP = 'INSERT' THEN
    v_new_diff := jsonb_strip_nulls(v_new - v_ignored);
    v_changed  := ARRAY(SELECT jsonb_object_keys(v_new_diff) ORDER BY 1);

  ELSE -- DELETE
    v_old_diff := jsonb_strip_nulls(v_old - v_ignored);
    v_changed  := ARRAY(SELECT jsonb_object_keys(v_old_diff) ORDER BY 1);
  END IF;

  -- QUI : claims JWT posés par PostgREST (absents en pg_cron / SQL direct).
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_claims := NULL;
  END;
  v_uid  := auth.uid();
  v_role := COALESCE(v_claims ->> 'role', session_user::text);

  -- PAR OÙ : première référence public.xxx / majordhome.xxx de la requête
  -- racine (RPC PostgREST, vue publique, table en SQL direct).
  v_source := substring(current_query() FROM '(?:public|majordhome)"?\."?([A-Za-z_][A-Za-z0-9_]*)');

  -- ORG : normalisation sur l'org core (appointments porte l'org majordhome).
  v_org := NULLIF(v_row ->> 'org_id', '')::uuid;
  IF v_org IS NOT NULL THEN
    SELECT o.core_org_id INTO v_core_org FROM majordhome.organizations o WHERE o.id = v_org;
    v_org := COALESCE(v_core_org, v_org);
  END IF;

  v_lead_id := CASE
    WHEN TG_TABLE_NAME = 'leads' THEN (v_row ->> 'id')::uuid
    ELSE NULLIF(COALESCE(v_new ->> 'lead_id', v_old ->> 'lead_id'), '')::uuid
  END;

  INSERT INTO majordhome.audit_log (
    org_id, table_name, record_id, lead_id, action, changed_fields,
    old_values, new_values, changed_by, changed_by_role, source
  ) VALUES (
    v_org, TG_TABLE_NAME, (v_row ->> 'id')::uuid, v_lead_id, TG_OP, v_changed,
    v_old_diff, v_new_diff, v_uid, v_role, v_source
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Fail-safe : le mouchard ne bloque jamais l'écriture métier.
  RAISE WARNING 'audit_row_change(%.%) failed: % [%]', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;

-- Fonction trigger : non appelable directement, mais on ferme par hygiène.
REVOKE ALL ON FUNCTION majordhome.audit_row_change() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Triggers (colonnes bruit en argument : techniques, dérivées, cadencées
--    par des crons — elles n'ont rien à faire dans l'Historique d'une fiche)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_leads ON majordhome.leads;
CREATE TRIGGER trg_audit_leads
  AFTER INSERT OR UPDATE OR DELETE ON majordhome.leads
  FOR EACH ROW EXECUTE FUNCTION majordhome.audit_row_change(
    'updated_at,status_changed_at,latitude,longitude,geocoded_at,zone,sort_order'
  );

DROP TRIGGER IF EXISTS trg_audit_appointments ON majordhome.appointments;
CREATE TRIGGER trg_audit_appointments
  AFTER INSERT OR UPDATE OR DELETE ON majordhome.appointments
  FOR EACH ROW EXECUTE FUNCTION majordhome.audit_row_change(
    'updated_at,scheduled_at,google_event_id,google_calendar_id,google_synced_at,slack_message_ts,slack_channel_id,reminder_24h_sent,reminder_1h_sent,client_notified_at'
  );

-- ----------------------------------------------------------------------------
-- 4. Vue publique (security_invoker → RLS de la table s'applique)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_audit_log
WITH (security_invoker = true) AS
SELECT
  a.id,
  a.org_id,
  a.table_name,
  a.record_id,
  a.lead_id,
  a.action,
  a.changed_fields,
  a.old_values,
  a.new_values,
  a.changed_by,
  a.changed_by_role,
  a.source,
  a.changed_at,
  p.full_name AS changed_by_name
FROM majordhome.audit_log a
LEFT JOIN public.profiles p ON p.id = a.changed_by;

REVOKE ALL ON public.majordhome_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.majordhome_audit_log TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Vérification post-apply (à exécuter, ne pas se fier au texte) :
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_audit_%';
--   SELECT has_table_privilege('anon', 'majordhome.audit_log', 'SELECT');           -- false
--   SELECT has_table_privilege('authenticated', 'majordhome.audit_log', 'INSERT');  -- false
--   SELECT has_table_privilege('service_role', 'majordhome.audit_log', 'SELECT');   -- true
--   puis une écriture depuis l'app → SELECT * FROM majordhome.audit_log ORDER BY id DESC LIMIT 1;
-- ----------------------------------------------------------------------------
