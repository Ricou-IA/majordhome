-- 20260928_2 — Rattrapage DUBREUIL Nadine (CTR-00036) : entretien fait le 10/09, visite jamais enregistrée.
--
-- Chaîne (diagnostic 2026-09-28) :
--   - contrat résilié le 26/02, réactivé les 10-11/09 ;
--   - 02/09 : édition du RDV maintenance du 10/09 → resolveCardForAppointment ne trouve pas
--     de contrat ACTIF → carte entretien « dégradée » 433169cb… créée SANS contract_id ;
--   - 10/09 : certificat CERT-2026-00727 signé sur la carte parente (ancien markRealise,
--     avant 024be52) → carte Réalisé, aucune maintenance_visits ;
--   - 11/09 : carte marquée Facturé puis Encaissé ; le rattrapage 20260911_1 l'a manquée
--     (jointure sur interventions.contract_id, NULL ici) ;
--   - même le markRealise corrigé et le trigger sync_intervention_from_visit travaillent par
--     contract_id : une carte sans contrat ne peut jamais recevoir sa visite.
--
-- Ce script : rattache la carte au contrat (le seul du client), pose la visite 2026 depuis le
-- certificat, et restaure « facture » (le trigger rétrograde en « realise »).
-- Rejouable : ne fait rien si une visite 2026 existe déjà sur le contrat.

do $$
declare
  v_card uuid := '433169cb-fb4f-467b-b323-bbe2c03ed681';
  v_contract uuid := 'c23a2cb0-6631-423c-83b4-bff69996b7d1';
  v_cert record;
  v_wf text;
begin
  if exists (select 1 from majordhome.maintenance_visits where contract_id = v_contract and visit_year = 2026) then
    raise notice 'CTR-00036 : visite 2026 déjà présente, rien à faire';
    return;
  end if;

  select workflow_status into v_wf from majordhome.interventions where id = v_card;

  update majordhome.interventions
     set contract_id = v_contract
   where id = v_card and contract_id is null;

  select * into v_cert from majordhome.certificats
   where intervention_id = v_card and statut = 'signe'
   order by signed_at desc nulls last limit 1;

  insert into majordhome.maintenance_visits
    (contract_id, org_id, visit_year, visit_date, status, technician_name, notes, created_by, intervention_id)
  values
    (v_contract, '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', 2026, v_cert.date_intervention, 'completed',
     v_cert.technicien_nom,
     'Rattrapage 2026-09-28 : visite reconstituée depuis le certificat ' || v_cert.reference
       || ' (carte créée sans contrat, visite jamais enregistrée)',
     (select p.id from core.profiles p where p.id = v_cert.created_by),
     v_card);

  -- Le trigger a posé realise + dates sur la carte : on rend son état « facture »
  update majordhome.interventions set workflow_status = v_wf
   where id = v_card and workflow_status is distinct from v_wf;
end $$;
