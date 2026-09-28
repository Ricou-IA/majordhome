-- 20260928_4 — Fusion du doublon de carte entretien LECARPENTIER Gérard (CTR-00783), validée par Eric.
--
-- Carte GARDÉE 9ea17a00… : créée le 18/06 (avant le contrat du 20/06 → sans contrat),
-- certificat signé CERT-2026-00309 (24/06, Ludovic Robert) sur le parent, facturée le 26/06.
-- Carte ABSORBÉE 07e55459… : créée le 02/09 par la saisie d'une visite 2026 au 02/06
-- (ensureRealisedCardForVisit ne cherchait que par contrat — corrigé 4c7583d). Porte le RDV
-- du 02/06 et un enfant « Néant » ; marquée facturée le 28/09 (doublon du 26/06).
--
-- Fusion (rien ne se perd) : RDV → carte gardée ; certificat → enfant-équipement de la carte
-- gardée (PAC 03014f46…), enfant passé réalisé ; date 02/06 + tag « Contrat » repris ;
-- visite 2026 rattachée (date du certificat notée). Puis suppression de l'absorbée et de son
-- enfant Néant (aucune autre référence : factures, SMS, appels, certificats, visites = 0).
-- Rejouable : sort sans rien faire si l'absorbée n'existe plus.

do $$
declare
  v_keep   uuid := '9ea17a00-76f8-4353-8d6e-9cbd721241de';
  v_dup    uuid := '07e55459-7f8f-42b2-85cb-374525869b49';
  v_child  uuid := '6d266aad-be49-4a50-bb89-981326570a27';   -- enfant PAC de la carte gardée
  v_neant  uuid := '3fad26c3-06c5-4323-9e50-2a3ecb5ef05c';   -- enfant Néant de l'absorbée
  v_ctr    uuid := 'c3df6ef9-5800-4b92-bdd0-ba0e55dcfbbb';
  v_eq     uuid := '03014f46-2c16-4e13-ac80-2d11cfefbf36';
  v_cert   uuid;
begin
  if not exists (select 1 from majordhome.interventions where id = v_dup) then
    raise notice 'doublon déjà fusionné';
    return;
  end if;

  -- 1. RDV du 02/06
  update majordhome.appointments set intervention_id = v_keep where intervention_id = v_dup;

  -- 2. Certificat signé : du parent vers l'enfant-équipement
  select id into v_cert from majordhome.certificats
   where intervention_id = v_keep and statut = 'signe' and equipment_id is null
   order by created_at desc limit 1;
  if v_cert is not null
     and not exists (select 1 from majordhome.certificats where intervention_id = v_child) then
    update majordhome.certificats
       set intervention_id = v_child, equipment_id = v_eq, contract_id = coalesce(contract_id, v_ctr)
     where id = v_cert;
    update majordhome.interventions
       set workflow_status = 'realise', status = 'completed'
     where id = v_child;
  end if;

  -- 3. Carte gardée : date du RDV + tag contrat (facturation du 26/06 conservée)
  update majordhome.interventions
     set scheduled_date = coalesce(scheduled_date, DATE '2026-06-02'),
         report_date    = coalesce(report_date, DATE '2026-06-02'::timestamptz),
         tags           = case when 'Contrat' = any(tags) then tags else array_append(tags, 'Contrat') end
   where id = v_keep;

  -- 4. Visite 2026 : rattachée à la carte gardée
  update majordhome.maintenance_visits
     set intervention_id = v_keep,
         notes = coalesce(notes || ' — ', '')
           || 'Fusion 2026-09-28 : doublon de carte supprimé ; certificat CERT-2026-00309 daté du 24/06/2026'
   where contract_id = v_ctr and visit_year = 2026;

  -- 5. Suppression de l'absorbée (enfant d'abord)
  delete from majordhome.interventions where id = v_neant and parent_id = v_dup;
  delete from majordhome.interventions where id = v_dup;
end $$;
