-- 20260617_4_appointments_grand_secteur.sql
-- Colonne "photo" du grand secteur, figée à la création d'un RDV (cf. Programmation).
-- La vue majordhome_appointments reste un miroir mono-table auto-updatable :
-- CREATE OR REPLACE n'autorisant l'ajout de colonnes qu'EN FIN de liste, grand_secteur
-- est ajouté après target_invoiced.

ALTER TABLE majordhome.appointments ADD COLUMN IF NOT EXISTS grand_secteur text;

CREATE OR REPLACE VIEW public.majordhome_appointments
WITH (security_invoker=true)
AS
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
    grand_secteur
   FROM majordhome.appointments a;
