-- 20260912_3_appointments_souplesse.sql
-- ============================================================================
-- Souplesse d'un rendez-vous : « fenêtres d'abord, heures ensuite ».
-- Spec : docs/superpowers/specs/2026-09-12-tournees-fenetres-et-consolidation-design.md
--
-- time_flex_minutes : tolérance autour de scheduled_start — 0 figé (exigence du
--   client), 15, 30, 240 (demi-journée). NULL = souplesse par défaut de l'org
--   (settings.tournees.souplesse_defaut_minutes). Décision Eric 2026-09-12 : par
--   principe TOUS les RDV existants sont adaptables → pas de reprise de données.
-- hour_confirmed_at : heure communiquée au client (figé à la prise, ou
--   consolidation « Figer la journée »). NOT NULL ⇒ le moteur ne déplace plus.
-- ============================================================================

ALTER TABLE majordhome.appointments
  ADD COLUMN IF NOT EXISTS time_flex_minutes smallint,
  ADD COLUMN IF NOT EXISTS hour_confirmed_at timestamptz;

ALTER TABLE majordhome.appointments
  DROP CONSTRAINT IF EXISTS appointments_time_flex_minutes_check;
ALTER TABLE majordhome.appointments
  ADD CONSTRAINT appointments_time_flex_minutes_check
  CHECK (time_flex_minutes IS NULL OR time_flex_minutes IN (0, 15, 30, 240));

COMMENT ON COLUMN majordhome.appointments.time_flex_minutes IS
  'Tolerance autour de scheduled_start : 0 fige, 15, 30, 240 (demi-journee). NULL = defaut org (settings.tournees.souplesse_defaut_minutes).';
COMMENT ON COLUMN majordhome.appointments.hour_confirmed_at IS
  'Heure communiquee au client (fige a la prise ou consolidation). NOT NULL = le moteur de tournees ne deplace plus ce RDV.';

-- Vue miroir simple auto-updatable : colonnes ajoutées EN FIN de liste
-- (CREATE OR REPLACE VIEW n'autorise que ça). Définition reprise de
-- pg_get_viewdef le 2026-09-12 — ne pas y introduire de LATERAL/window.
CREATE OR REPLACE VIEW public.majordhome_appointments
  WITH (security_invoker = true) AS
  SELECT id,
    org_id,
    service_request_id,
    lead_id,
    client_name,
    client_phone,
    client_email,
    address,
    postal_code,
    city,
    scheduled_date,
    scheduled_start,
    scheduled_end,
    duration_minutes,
    scheduled_at,
    appointment_type,
    equipment_type,
    priority,
    status,
    subject,
    description,
    internal_notes,
    completion_notes,
    parts_used,
    photos_urls,
    signature_url,
    completed_at,
    is_billable,
    estimated_amount,
    final_amount,
    invoice_id,
    invoice_status,
    is_recurring,
    recurrence_rule,
    parent_appointment_id,
    google_event_id,
    google_calendar_id,
    google_synced_at,
    slack_message_ts,
    slack_channel_id,
    client_notified_at,
    reminder_24h_sent,
    reminder_1h_sent,
    source,
    created_at,
    updated_at,
    created_by,
    cancelled_at,
    cancellation_reason,
    client_id,
    client_first_name,
    assigned_commercial_id,
    intervention_id,
        CASE
            WHEN intervention_id IS NOT NULL THEN COALESCE(( SELECT i.invoiced_at IS NOT NULL OR i.workflow_status = 'facture'::text
               FROM majordhome.interventions i
              WHERE i.id = a.intervention_id), false)
            WHEN appointment_type = 'installation'::text AND lead_id IS NOT NULL THEN (EXISTS ( SELECT 1
               FROM majordhome.lead_pennylane_quotes q
              WHERE q.lead_id = a.lead_id AND q.is_winning_quote = true AND q.quote_status = 'invoiced'::text AND q.ejected_at IS NULL))
            ELSE false
        END AS target_invoiced,
    grand_secteur,
    -- Ajouts 20260912_3 (souplesse)
    time_flex_minutes,
    hour_confirmed_at
   FROM majordhome.appointments a;

-- Vérifications (après application) :
--   SELECT is_insertable_into FROM information_schema.views WHERE table_name = 'majordhome_appointments';  -- YES
--   SELECT reloptions FROM pg_class WHERE oid = 'public.majordhome_appointments'::regclass;                -- {security_invoker=true}
