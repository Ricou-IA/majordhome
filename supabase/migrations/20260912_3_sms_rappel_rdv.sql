-- ============================================================================
-- 20260912_3_sms_rappel_rdv.sql — rappel automatique des RDV d'entretien (SMS)
-- ============================================================================
--
-- CONTEXTE
-- Le planning sert de pré-planification : c'est un appel humain qui valide le
-- rendez-vous, donc pas de SMS à la pose. À la place, un cron rappelle au client
-- son entretien — la veille, ou en début de semaine pour les 7 jours suivants —
-- selon un réglage d'org (`core.organizations.settings.sms.rappel_rdv`, édité
-- dans Settings → Organisation → SMS). Le cron pg_cron est HORAIRE : c'est
-- l'edge `sms-rappel-rdv` qui, pour chaque org, lit le réglage et décide s'il y
-- a quelque chose à faire maintenant. Rien n'est codé en dur ici.
--
-- ANTI-DOUBLON
-- `appointments.client_notified_at` (colonne existante, jamais utilisée jusqu'ici :
-- 0 ligne non NULL au 2026-09-12) est posée par l'edge après un envoi réussi et
-- remise à NULL par trigger dès que la date ou l'heure du RDV change → le client
-- déplacé est re-notifié, jamais deux fois pour le même créneau. La passe H+1 du
-- cron peut donc retenter un échec sans risque.
--
-- ⚠ Les deux RPC prennent l'org (ou un id de RDV) dans leur payload sans le
-- dériver d'auth.uid() : charte multi-tenant ⇒ service_role ONLY. L'edge, elle,
-- est protégée par MDH_CRON_SECRET.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Candidats : RDV d'entretien planifiés dans la fenêtre, pas encore notifiés.
--    Téléphone / prénom : la fiche client d'abord (source de vérité, corrigeable),
--    la photo prise sur le RDV en repli. Techniciens en jsonb : le choix du nom
--    affiché (prénom, repli nom complet) appartient au registre front, pas au SQL.
-- ---------------------------------------------------------------------------
create or replace function public.sms_rappel_rdv_candidates(
  p_core_org_id uuid,
  p_from        date,
  p_to          date
)
returns table (
  appointment_id  uuid,
  intervention_id uuid,
  client_id       uuid,
  phone           text,
  first_name      text,
  scheduled_date  date,
  scheduled_start time,
  technicians     jsonb
)
language sql
stable
security definer
set search_path = majordhome, public
as $$
  select
    a.id                                                          as appointment_id,
    a.intervention_id,
    a.client_id,
    coalesce(nullif(btrim(c.phone), ''), a.client_phone)          as phone,
    coalesce(nullif(btrim(c.first_name), ''), a.client_first_name) as first_name,
    a.scheduled_date,
    a.scheduled_start,
    coalesce((
      select jsonb_agg(
               jsonb_build_object('first_name', tm.first_name, 'display_name', tm.display_name)
               order by tm.display_name
             )
      from majordhome.appointment_technicians at2
      join majordhome.team_members tm on tm.id = at2.technician_id
      where at2.appointment_id = a.id
    ), '[]'::jsonb)                                               as technicians
  from majordhome.appointments a
  join majordhome.organizations o on o.id = a.org_id
  left join majordhome.clients c on c.id = a.client_id
  where p_core_org_id is not null
    and p_from is not null and p_to is not null
    and p_to >= p_from and p_to - p_from <= 31          -- garde-fou : jamais une fenêtre géante par erreur
    and o.core_org_id = p_core_org_id
    and a.appointment_type = 'maintenance'
    and a.status = 'scheduled'
    and a.scheduled_date between p_from and p_to
    and a.scheduled_start is not null
    and a.client_notified_at is null
  order by a.scheduled_date, a.scheduled_start;
$$;

comment on function public.sms_rappel_rdv_candidates(uuid, date, date) is
  'RDV d''entretien (maintenance, scheduled) d''une org CORE dans [p_from, p_to] (≤ 31 j) non encore notifiés (client_notified_at IS NULL). service_role only — consommée par l''edge sms-rappel-rdv.';

revoke execute on function public.sms_rappel_rdv_candidates(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.sms_rappel_rdv_candidates(uuid, date, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Marquage après envoi réussi. Idempotent (un RDV déjà marqué reste marqué).
-- ---------------------------------------------------------------------------
create or replace function public.sms_rappel_rdv_mark_notified(p_appointment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = majordhome, public
as $$
declare
  v_found boolean;
begin
  if p_appointment_id is null then
    raise exception 'appointment_id_required' using errcode = 'P0001';
  end if;

  update majordhome.appointments
     set client_notified_at = now()
   where id = p_appointment_id
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;

comment on function public.sms_rappel_rdv_mark_notified(uuid) is
  'Pose appointments.client_notified_at = now() après un rappel SMS parti. service_role only — consommée par l''edge sms-rappel-rdv.';

revoke execute on function public.sms_rappel_rdv_mark_notified(uuid)
  from public, anon, authenticated;
grant execute on function public.sms_rappel_rdv_mark_notified(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Un RDV déplacé (date ou heure) redevient « à notifier ». Même patron que
--    reset_geocode_on_address_change sur clients. `UPDATE OF` : le trigger ne se
--    déclenche que si l'une des deux colonnes figure dans le SET — le marquage
--    (client_notified_at seul) ne le réveille donc pas.
-- ---------------------------------------------------------------------------
create or replace function majordhome.reset_client_notified_on_reschedule()
returns trigger
language plpgsql
as $$
begin
  if new.scheduled_date is distinct from old.scheduled_date
     or new.scheduled_start is distinct from old.scheduled_start then
    new.client_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_client_notified_on_reschedule on majordhome.appointments;
create trigger reset_client_notified_on_reschedule
  before update of scheduled_date, scheduled_start on majordhome.appointments
  for each row
  execute function majordhome.reset_client_notified_on_reschedule();

-- ---------------------------------------------------------------------------
-- 4. Cron HORAIRE (pg_cron tourne en UTC : 5h-19h UTC couvre 7h-20h à Paris en
--    toute saison — les heures proposées dans l'onglet SMS). Le corps est vide :
--    aucune org n'envoie tant que son réglage est `off` (défaut). Même patron
--    que geocode-sweep / mailing-scheduler : secret lu depuis vault.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'sms-rappel-rdv',
  '0 5-19 * * *',
  $$
    select net.http_post(
      url := 'https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/sms-rappel-rdv',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mdh_cron_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
