-- supabase/migrations/20260911_1_rattrapage_visites_certificat_parent.sql
-- ============================================================================
-- Rattrapage des entretiens « Réalisé » SANS visite datée.
--
-- Cause (2026-06-18 → 2026-09-11) : le CTA « Remplir le certificat » de la
-- modale planning (et « Remplir » de l'historique ClientModal) ouvrait le wizard
-- sur l'intervention PARENTE. `savService.markRealise(parent)` posait
-- `realise`/`completed` sans passer par `completeParentEntretien`, seul chemin
-- qui enregistre la visite (`maintenance_visits`) — donc :
--   - certificat signé rattaché au parent (`equipment_id` NULL) ;
--   - aucune ligne `maintenance_visits` 2026, `report_date` NULL ;
--   - `current_year_visit_status` NULL → contrat toujours candidat Programmation /
--     Tournées / SMS de rappel (3 contrats ont été re-planifiés à tort) ;
--   - la section Certificats crée l'enfant à la volée → « 0/1 À faire ».
--
-- Ce que fait ce script, par carte racine concernée :
--   1. INSERT `maintenance_visits` 2026 `completed`, date + technicien du certificat.
--      Le trigger `sync_intervention_from_visit` pose `report_date`/`scheduled_date`
--      sur la racine LA PLUS RÉCENTE du contrat — deux effets à neutraliser :
--        a) il rétrograde `facture` → `realise` : on restaure le workflow_status ;
--        b) si une racine plus récente existe (doublon de re-planification), il la
--           bascule à tort : on la restaure intégralement et on date la vraie carte.
--   2. Ré-attache le certificat à l'enfant-équipement quand c'est sans ambiguïté
--      (un seul équipement candidat, ou n° de série qui matche exactement un seul),
--      et si l'enfant n'a pas déjà son certificat (index unique
--      `idx_certificats_intervention_unique`). Enfant créé `realise` si absent.
--      Sinon : le certificat reste sur le parent, la visite est posée quand même.
--
-- Idempotent : le WHERE (aucune visite 2026 sur le contrat) ne matche plus une
-- fois appliqué. Rejouable après le déploiement du correctif front si de nouvelles
-- cartes sont passées par l'ancien chemin entre-temps.
-- ============================================================================

do $$
declare
  r record;
  v_cert record;
  v_tgt record;
  v_visit_date date;
  v_serial_norm text;
  v_target_eq uuid;
  v_child_id uuid;
  v_created_by uuid;
  n_visits int := 0;
  n_wf_restored int := 0;
  n_other_root_restored int := 0;
  n_reattach_existing int := 0;
  n_reattach_created int := 0;
  n_skip_reattach int := 0;
begin
  for r in
    select i.id, i.contract_id, i.client_id, i.project_id, i.scheduled_date,
           c.org_id, c.contract_number, cl.project_id as client_project_id
    from majordhome.interventions i
    join majordhome.contracts c on c.id = i.contract_id
    join majordhome.clients cl on cl.id = i.client_id
    where i.parent_id is null
      and i.intervention_type = 'entretien'
      and i.workflow_status in ('realise', 'facture')
      and c.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
      and not exists (
        select 1 from majordhome.maintenance_visits v
        where v.contract_id = i.contract_id and v.visit_year = 2026
      )
      and exists (
        select 1 from majordhome.certificats ce
        where ce.intervention_id = i.id and ce.statut = 'signe' and ce.equipment_id is null
      )
    order by i.created_at
  loop
    select * into v_cert
    from majordhome.certificats ce
    where ce.intervention_id = r.id and ce.statut = 'signe'
    order by ce.signed_at desc
    limit 1;

    v_visit_date := coalesce(v_cert.date_intervention, r.scheduled_date, v_cert.signed_at::date);

    -- created_by de la visite : FK core.profiles → seulement si le profil existe
    select p.id into v_created_by from core.profiles p where p.id = v_cert.created_by;

    -- Snapshot de la cible du trigger (racine la plus récente du contrat)
    select id, workflow_status, status, scheduled_date, report_date into v_tgt
    from majordhome.interventions
    where contract_id = r.contract_id and parent_id is null
    order by created_at desc
    limit 1;

    -- 1) Visite 2026
    insert into majordhome.maintenance_visits
      (contract_id, org_id, visit_year, visit_date, status, technician_name, notes, created_by, intervention_id)
    values
      (r.contract_id, r.org_id, 2026, v_visit_date, 'completed', v_cert.technicien_nom,
       'Rattrapage 2026-09-11 : visite reconstituée depuis le certificat ' || v_cert.reference
         || ' (wizard ouvert sur le parent, visite jamais enregistrée)',
       v_created_by, r.id);
    n_visits := n_visits + 1;

    -- 1a/1b) Neutraliser les effets de bord du trigger
    if v_tgt.id = r.id then
      if v_tgt.workflow_status <> 'realise' then
        update majordhome.interventions set workflow_status = v_tgt.workflow_status where id = r.id;
        n_wf_restored := n_wf_restored + 1;
      end if;
    else
      update majordhome.interventions
         set workflow_status = v_tgt.workflow_status,
             status          = v_tgt.status,
             scheduled_date  = v_tgt.scheduled_date,
             report_date     = v_tgt.report_date
       where id = v_tgt.id;
      update majordhome.interventions
         set report_date    = v_visit_date::timestamptz,
             scheduled_date = coalesce(scheduled_date, v_visit_date)
       where id = r.id;
      n_other_root_restored := n_other_root_restored + 1;
      raise notice '% : racine plus récente % restaurée (doublon de re-planification à traiter)', r.contract_number, v_tgt.id;
    end if;

    -- 2) Ré-attache du certificat à l'enfant-équipement
    v_serial_norm := regexp_replace(lower(coalesce(v_cert.equipement_numero_serie, '')), '\s', '', 'g');

    with cands as (
      select e.id, regexp_replace(lower(coalesce(e.serial_number, '')), '\s', '', 'g') as serial_norm
      from majordhome.equipments e
      where e.id in (select cq.equipment_id from majordhome.contract_equipments cq where cq.contract_id = r.contract_id)
         or (not exists (select 1 from majordhome.contract_equipments cq where cq.contract_id = r.contract_id)
             and e.project_id = r.client_project_id and e.status = 'active')
    )
    select case
             when (select count(*) from cands) = 1 then (select id from cands)
             when (select count(*) from cands where serial_norm <> '' and serial_norm = v_serial_norm) = 1
               then (select id from cands where serial_norm <> '' and serial_norm = v_serial_norm)
           end
      into v_target_eq;

    if v_target_eq is null then
      n_skip_reattach := n_skip_reattach + 1;
      raise notice '% : certificat % laissé sur le parent (équipement ambigu)', r.contract_number, v_cert.reference;
      continue;
    end if;

    select id into v_child_id
    from majordhome.interventions
    where parent_id = r.id and equipment_id = v_target_eq
    limit 1;

    if v_child_id is not null
       and exists (select 1 from majordhome.certificats x where x.intervention_id = v_child_id) then
      n_skip_reattach := n_skip_reattach + 1;
      raise notice '% : certificat % laissé sur le parent (enfant déjà certifié)', r.contract_number, v_cert.reference;
      continue;
    end if;

    if v_child_id is null then
      insert into majordhome.interventions
        (parent_id, equipment_id, project_id, client_id, contract_id, intervention_type, workflow_status, status)
      values
        (r.id, v_target_eq, r.project_id, r.client_id, r.contract_id, 'entretien', 'realise', 'completed')
      returning id into v_child_id;
      n_reattach_created := n_reattach_created + 1;
    else
      update majordhome.interventions
         set workflow_status = 'realise', status = 'completed'
       where id = v_child_id;
      n_reattach_existing := n_reattach_existing + 1;
    end if;

    update majordhome.certificats
       set intervention_id = v_child_id, equipment_id = v_target_eq
     where id = v_cert.id;
  end loop;

  raise notice 'visites posées : % | facture restaurés : % | racines tierces restaurées : % | certificats ré-attachés (enfant existant / créé) : % / % | laissés sur le parent : %',
    n_visits, n_wf_restored, n_other_root_restored, n_reattach_existing, n_reattach_created, n_skip_reattach;
end $$;
