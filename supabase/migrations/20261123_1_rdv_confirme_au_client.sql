-- ============================================================================
-- 20261123_1 — RDV « confirmé au client » (Eric 2026-11-23)
-- ============================================================================
-- Le cadenas du planning disait « heure figée » : or une journée pleine se fige
-- seule chaque nuit (tournees-figer) sans que le client soit prévenu (figer_sms
-- coupé). Il ne disait donc pas « le client est au courant ». On ajoute ce fait :
--   client_confirmed_at / client_confirmed_by : posés par le bouton « Confirmé au
--   client » de la fenêtre du RDV (après un appel, par exemple).
-- Règles tenues par la base :
--   - client_confirmed_by = auth.uid() de qui pose la confirmation (jamais reçu du front) ;
--   - date ou heure du RDV changée ⇒ confirmation retirée (le client a eu une autre
--     heure : à reconfirmer), comme client_notified_at.
-- La vue majordhome_appointments reste un miroir simple (colonnes ajoutées EN FIN).
-- ============================================================================

alter table majordhome.appointments
  add column if not exists client_confirmed_at timestamptz,
  add column if not exists client_confirmed_by uuid;

comment on column majordhome.appointments.client_confirmed_at is
  'Date à laquelle le RDV a été confirmé au client (appel, message). NULL = provisoire. Retirée si la date ou l''heure change.';
comment on column majordhome.appointments.client_confirmed_by is
  'Utilisateur qui a confirmé le RDV au client (auth.uid() posé par trigger).';

create or replace function majordhome.appointments_confirmation_client()
returns trigger
language plpgsql
set search_path = majordhome, public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.scheduled_date is distinct from old.scheduled_date
          or new.scheduled_start is distinct from old.scheduled_start)
     and new.client_confirmed_at is not distinct from old.client_confirmed_at then
    -- Le RDV bouge sans nouvelle confirmation : l'ancienne ne vaut plus.
    new.client_confirmed_at := null;
    new.client_confirmed_by := null;
  elsif new.client_confirmed_at is null then
    new.client_confirmed_by := null;
  elsif tg_op = 'INSERT' or new.client_confirmed_at is distinct from old.client_confirmed_at then
    new.client_confirmed_by := auth.uid();
  else
    new.client_confirmed_by := old.client_confirmed_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_confirmation_client on majordhome.appointments;
create trigger trg_appointments_confirmation_client
  before insert or update on majordhome.appointments
  for each row
  execute function majordhome.appointments_confirmation_client();

revoke execute on function majordhome.appointments_confirmation_client() from public, anon;

create or replace view public.majordhome_appointments
with (security_invoker = true) as
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
            WHEN appointment_type = 'installation'::text AND chantier_id IS NOT NULL THEN (EXISTS ( SELECT 1
               FROM majordhome.chantier_quote_stats s
              WHERE s.chantier_id = a.chantier_id AND s.validated_count > 0 AND s.invoiced_count = s.validated_count))
            ELSE false
        END AS target_invoiced,
    grand_secteur,
    time_flex_minutes,
    hour_confirmed_at,
    announced_start,
    chantier_id,
    client_confirmed_at,
    client_confirmed_by
   FROM majordhome.appointments a;

-- CREATE OR REPLACE VIEW garde l'ACL existante ; on la réaffirme sans rien rouvrir à anon.
revoke all on public.majordhome_appointments from anon;
