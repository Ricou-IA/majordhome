-- 20261024_1 — VERMONT Julie (CTR-00873) : retrait de la carte d'entretien fantôme.
--
-- Le 19/10, la date de prise de RDV a été saisie comme date de passage 2026 dans le suivi du
-- contrat (fiche client → Contrat). Le trigger sync_intervention_from_visit a créé une SECONDE
-- carte directement en « Réalisé » (b59a45d5…), facturée en brouillon Pennylane le 24/10
-- (brouillon supprimé dans Pennylane par Eric le 24/10). La vraie carte (b91510c2…, Planifié au
-- 18/11 avec son RDV) n'est pas touchée. Garde-fou UI livré en parallèle (52bd6f2f) : plus de
-- passage réalisé saisi à la main sur la campagne en cours.
--
-- Tout ou rien : chaque suppression vérifie l'état attendu et lève une exception sinon.

DO $$
DECLARE
  v_n int;
BEGIN
  -- 0. Garde : la carte fantôme est bien celle attendue, sans RDV ni certificat.
  IF NOT EXISTS (
    SELECT 1 FROM majordhome.interventions
    WHERE id = 'b59a45d5-e2fd-4bf5-bf80-8aeb66672b96'
      AND contract_id = '875e4ecd-3d40-46ed-bb59-b5d7e31520da'
      AND parent_id IS NULL AND workflow_status = 'realise'
  ) THEN
    RAISE EXCEPTION 'carte fantôme introuvable ou état inattendu';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.appointments
             WHERE intervention_id IN ('b59a45d5-e2fd-4bf5-bf80-8aeb66672b96', '3ea91a65-a1f6-47c7-b71e-29de570b880c')) THEN
    RAISE EXCEPTION 'un RDV est rattaché à la carte fantôme : arrêt';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.certificats
             WHERE intervention_id IN ('b59a45d5-e2fd-4bf5-bf80-8aeb66672b96', '3ea91a65-a1f6-47c7-b71e-29de570b880c')) THEN
    RAISE EXCEPTION 'un certificat est rattaché à la carte fantôme : arrêt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.interventions
                 WHERE id = 'b91510c2-8afc-4f21-8405-a2264d115cdf' AND workflow_status = 'planifie') THEN
    RAISE EXCEPTION 'la vraie carte (18/11) n''est plus en Planifié : arrêt';
  END IF;

  -- 1. Visite 2026 saisie par erreur.
  DELETE FROM majordhome.maintenance_visits
  WHERE id = 'e122dd97-2729-4ccc-8f96-03fa08d464e6'
    AND contract_id = '875e4ecd-3d40-46ed-bb59-b5d7e31520da'
    AND visit_year = 2026 AND visit_date = '2026-10-19';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'visite 2026 : % ligne(s) au lieu de 1', v_n; END IF;

  -- 2. Mapping vers le brouillon Pennylane supprimé (sinon « Facturer » croirait la facture faite).
  DELETE FROM majordhome.pennylane_sync
  WHERE entity_type = 'invoice'
    AND local_id = 'b59a45d5-e2fd-4bf5-bf80-8aeb66672b96'
    AND pennylane_id = 32991482535936;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'mapping Pennylane : % ligne(s) au lieu de 1', v_n; END IF;

  -- 3. Carte fantôme : l'intervention poêle (enfant) puis la carte.
  DELETE FROM majordhome.interventions
  WHERE id = '3ea91a65-a1f6-47c7-b71e-29de570b880c'
    AND parent_id = 'b59a45d5-e2fd-4bf5-bf80-8aeb66672b96';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'intervention enfant : % ligne(s) au lieu de 1', v_n; END IF;

  DELETE FROM majordhome.interventions WHERE id = 'b59a45d5-e2fd-4bf5-bf80-8aeb66672b96';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'carte fantôme : % ligne(s) au lieu de 1', v_n; END IF;
END $$;
