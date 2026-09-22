-- assert-certificats-enfants.sql — vérifie 20260922_2_certificats_enfants_suivent_equipements.sql
-- sur le cluster de répétition. Un écart lève une exception → run.mjs sort en ECHEC.
-- Couvre : structure (triggers, privilèges), puis scénario fonctionnel (rollback) :
-- retrait du contrat / suppression d'équipement ⇒ enfant vierge purgé, enfant avec
-- certificat ou néant conservé, carte sans photo contract_id rattachée par client.

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE t.tgname IN ('trg_equipment_purge_certificat_children', 'trg_contract_equipment_purge_certificat_children')
     AND c.relname IN ('equipments', 'contract_equipments');
  IF n <> 2 THEN RAISE EXCEPTION 'triggers attendus 2, trouvé %', n; END IF;

  IF has_function_privilege('anon', 'majordhome.purge_blank_certificat_children(uuid, uuid)', 'EXECUTE')
     THEN RAISE EXCEPTION 'purge_blank_certificat_children exécutable par anon'; END IF;
  IF has_function_privilege('authenticated', 'majordhome.purge_blank_certificat_children(uuid, uuid)', 'EXECUTE')
     THEN RAISE EXCEPTION 'purge_blank_certificat_children exécutable par authenticated'; END IF;
  IF has_function_privilege('anon', 'majordhome.equipment_unlinked_purge_children()', 'EXECUTE')
     THEN RAISE EXCEPTION 'equipment_unlinked_purge_children exécutable par anon'; END IF;

  RAISE NOTICE 'assert-certificats-enfants A (structure) : OK';
END $$;

-- ── B. Scénario fonctionnel (rollback à la fin) ────────────────────────────
BEGIN;
DO $$
DECLARE
  v_client record;
  v_contract uuid;
  v_parent uuid; v_parent2 uuid;
  eq1 uuid; eq2 uuid; eq3 uuid; eq4 uuid; eq5 uuid;
  ch1 uuid; ch2 uuid; ch3 uuid; ch4 uuid; ch5 uuid;
  n int; v_eq uuid;
BEGIN
  SELECT id, org_id, project_id INTO v_client FROM majordhome.clients WHERE project_id IS NOT NULL LIMIT 1;
  IF v_client.id IS NULL THEN RAISE EXCEPTION 'fixture : aucun client'; END IF;

  INSERT INTO majordhome.contracts (org_id, client_id) VALUES (v_client.org_id, v_client.id) RETURNING id INTO v_contract;

  INSERT INTO majordhome.equipments (project_id, category, brand) VALUES (v_client.project_id, 'autre', 'REHEARSAL 1') RETURNING id INTO eq1;
  INSERT INTO majordhome.equipments (project_id, category, brand) VALUES (v_client.project_id, 'autre', 'REHEARSAL 2') RETURNING id INTO eq2;
  INSERT INTO majordhome.equipments (project_id, category, brand) VALUES (v_client.project_id, 'autre', 'REHEARSAL 3') RETURNING id INTO eq3;
  INSERT INTO majordhome.equipments (project_id, category, brand) VALUES (v_client.project_id, 'autre', 'REHEARSAL 4') RETURNING id INTO eq4;
  INSERT INTO majordhome.equipments (project_id, category, brand) VALUES (v_client.project_id, 'autre', 'REHEARSAL 5') RETURNING id INTO eq5;
  INSERT INTO majordhome.contract_equipments (contract_id, equipment_id)
    VALUES (v_contract, eq1), (v_contract, eq2), (v_contract, eq3), (v_contract, eq4), (v_contract, eq5);

  -- Carte racine avec photo contract_id + 4 enfants : 2 vierges, 1 avec certificat, 1 néant
  INSERT INTO majordhome.interventions (project_id, client_id, contract_id, intervention_type, workflow_status, status)
    VALUES (v_client.project_id, v_client.id, v_contract, 'entretien', 'planifie', 'scheduled') RETURNING id INTO v_parent;
  INSERT INTO majordhome.interventions (project_id, client_id, contract_id, parent_id, equipment_id, intervention_type, workflow_status, status)
    VALUES (v_client.project_id, v_client.id, v_contract, v_parent, eq1, 'entretien', 'planifie', 'scheduled') RETURNING id INTO ch1;
  INSERT INTO majordhome.interventions (project_id, client_id, contract_id, parent_id, equipment_id, intervention_type, workflow_status, status)
    VALUES (v_client.project_id, v_client.id, v_contract, v_parent, eq2, 'entretien', 'planifie', 'scheduled') RETURNING id INTO ch2;
  INSERT INTO majordhome.interventions (project_id, client_id, contract_id, parent_id, equipment_id, intervention_type, workflow_status, status)
    VALUES (v_client.project_id, v_client.id, v_contract, v_parent, eq3, 'entretien', 'planifie', 'scheduled') RETURNING id INTO ch3;
  INSERT INTO majordhome.certificats (org_id, equipment_id, intervention_id, equipement_type) VALUES (v_client.org_id, eq3, ch3, 'autre');
  INSERT INTO majordhome.interventions (project_id, client_id, contract_id, parent_id, equipment_id, intervention_type, workflow_status, status)
    VALUES (v_client.project_id, v_client.id, v_contract, v_parent, eq4, 'entretien', 'realise', 'cancelled') RETURNING id INTO ch4;

  -- Carte racine SANS photo contract_id (contrat dérivé par la vue) + 1 enfant vierge
  INSERT INTO majordhome.interventions (project_id, client_id, intervention_type, workflow_status, status)
    VALUES (v_client.project_id, v_client.id, 'entretien', 'planifie', 'scheduled') RETURNING id INTO v_parent2;
  INSERT INTO majordhome.interventions (project_id, client_id, parent_id, equipment_id, intervention_type, workflow_status, status)
    VALUES (v_client.project_id, v_client.id, v_parent2, eq5, 'entretien', 'planifie', 'scheduled') RETURNING id INTO ch5;

  -- (1) Retirer eq1 du contrat ⇒ enfant vierge purgé, équipement conservé
  DELETE FROM majordhome.contract_equipments WHERE contract_id = v_contract AND equipment_id = eq1;
  IF EXISTS (SELECT 1 FROM majordhome.interventions WHERE id = ch1) THEN RAISE EXCEPTION '(1) enfant vierge d''eq1 toujours présent après retrait du contrat'; END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.equipments WHERE id = eq1) THEN RAISE EXCEPTION '(1) eq1 a été supprimé alors qu''il était seulement retiré'; END IF;

  -- (2) Supprimer l'équipement eq2 ⇒ enfant vierge purgé, suppression passée
  DELETE FROM majordhome.equipments WHERE id = eq2;
  IF EXISTS (SELECT 1 FROM majordhome.interventions WHERE id = ch2) THEN RAISE EXCEPTION '(2) enfant vierge d''eq2 toujours présent après suppression de l''équipement'; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.equipments WHERE id = eq2) THEN RAISE EXCEPTION '(2) eq2 non supprimé'; END IF;

  -- (3) Retirer eq3 (enfant avec certificat) ⇒ enfant conservé
  DELETE FROM majordhome.contract_equipments WHERE contract_id = v_contract AND equipment_id = eq3;
  IF NOT EXISTS (SELECT 1 FROM majordhome.interventions WHERE id = ch3) THEN RAISE EXCEPTION '(3) enfant porteur d''un certificat supprimé'; END IF;

  -- (4) Supprimer eq4 (enfant néant) ⇒ enfant conservé, equipment_id NULL
  DELETE FROM majordhome.equipments WHERE id = eq4;
  SELECT equipment_id INTO v_eq FROM majordhome.interventions WHERE id = ch4;
  IF NOT FOUND THEN RAISE EXCEPTION '(4) enfant néant supprimé'; END IF;
  IF v_eq IS NOT NULL THEN RAISE EXCEPTION '(4) equipment_id de l''enfant néant non passé à NULL'; END IF;

  -- (5) Carte sans photo contract_id : retrait d'eq5 ⇒ enfant vierge purgé via le client
  DELETE FROM majordhome.contract_equipments WHERE contract_id = v_contract AND equipment_id = eq5;
  IF EXISTS (SELECT 1 FROM majordhome.interventions WHERE id = ch5) THEN RAISE EXCEPTION '(5) enfant vierge d''une carte sans contract_id non purgé'; END IF;

  -- Les parents sont intacts
  SELECT count(*) INTO n FROM majordhome.interventions WHERE id IN (v_parent, v_parent2);
  IF n <> 2 THEN RAISE EXCEPTION 'parents touchés (% restants sur 2)', n; END IF;

  RAISE NOTICE 'assert-certificats-enfants B (scénario) : OK';
END $$;
ROLLBACK;
