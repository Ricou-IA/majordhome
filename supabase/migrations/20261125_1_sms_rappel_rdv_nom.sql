-- ============================================================================
-- 20261125_1_sms_rappel_rdv_nom.sql — le rappel de RDV connaît le NOM du client
-- ============================================================================
--
-- CONTEXTE
-- Eric, 2026-11-25 : « le prénom seul c'est trop intime ». Le gabarit `rappel_rdv`
-- reçoit une étiquette « Nom » (`{{nom}}`, registre `src/lib/smsCampaigns.js`).
-- L'envoi à la main depuis la fenêtre du RDV lit le nom sur le RDV ; le cron
-- `sms-rappel-rdv`, lui, ne connaît que ce que rend cette fonction : on y ajoute
-- `last_name`, EN FIN de liste (l'edge déjà déployée lit ses colonnes par nom et
-- ignore celle-ci tant qu'elle n'est pas redéployée).
--
-- Même règle que le prénom : la fiche client d'abord (source de vérité), la copie
-- prise sur le RDV (`appointments.client_name`) en repli.
--
-- Le type de retour change : DROP puis CREATE (CREATE OR REPLACE le refuse), donc
-- les droits sont reposés — service_role seul, comme avant (l'org est reçue en
-- paramètre, jamais dérivée d'auth.uid()).
-- ============================================================================

drop function if exists public.sms_rappel_rdv_candidates(uuid, date, date);

create function public.sms_rappel_rdv_candidates(
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
  technicians     jsonb,
  last_name       text
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
    ), '[]'::jsonb)                                               as technicians,
    coalesce(nullif(btrim(c.last_name), ''), a.client_name)       as last_name
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
  'RDV d''entretien (maintenance, scheduled) d''une org CORE dans [p_from, p_to] (≤ 31 j) non encore notifiés (client_notified_at IS NULL), avec prénom et nom du client. service_role only — consommée par l''edge sms-rappel-rdv.';

revoke execute on function public.sms_rappel_rdv_candidates(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.sms_rappel_rdv_candidates(uuid, date, date)
  to service_role;
