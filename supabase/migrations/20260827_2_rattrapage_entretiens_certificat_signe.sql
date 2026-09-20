-- supabase/migrations/20260827_2_rattrapage_entretiens_certificat_signe.sql
-- ============================================================================
-- Rattrapage des entretiens laisses « planifie » par la regression du bucket
-- Storage `certificats` (cf. 20260827_1_storage_bucket_certificats.sql).
--
-- Entre le 2026-08-11 et le 2026-08-27, CertificatWizard levait sur l'echec
-- d'upload du PDF, AVANT d'appeler `savService.markRealise`. Consequence : des
-- certificats signes par le client en base, mais des entretiens restes
-- « planifie » au kanban — invisibles cote bureau.
--
-- On rejoue ici ce que markRealise aurait fait : `workflow_status='realise'`
-- + `status='completed'`. Restreint aux interventions RACINES (parent_id is
-- null) : markRealise propage sinon au parent via maybeCompleteParent(), qui
-- n'a pas d'equivalent SQL trivial. Aucun cas enfant n'est concerne au moment
-- d'ecrire (verifie), la clause est une garde.
--
-- Critere : un certificat SIGNE fait foi — le client a signe, l'entretien a eu
-- lieu. Les brouillons ne sont pas touches.
--
-- Idempotent : rejouable, le WHERE ne matche plus une fois applique.
-- ============================================================================

do $$
declare
  n_rattrapes int;
begin
  with cibles as (
    select i.id
    from majordhome.certificats c
    join majordhome.interventions i on i.id = c.intervention_id
    where c.statut = 'signe'
      and c.created_at > '2026-08-11'
      and i.workflow_status = 'planifie'
      and i.parent_id is null
  )
  update majordhome.interventions i
     set workflow_status = 'realise',
         status          = 'completed',
         updated_at      = now()
    from cibles
   where i.id = cibles.id;

  get diagnostics n_rattrapes = row_count;
  raise notice 'entretiens rattrapes : %', n_rattrapes;
end $$;
