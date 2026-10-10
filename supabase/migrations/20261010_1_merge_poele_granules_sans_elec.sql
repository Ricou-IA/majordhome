-- ============================================================================
-- 20261010_1 — Fusion du type « Poêle à granulés (sans électronique) »
--              dans « Poêle à granulés » (simplification du référentiel)
-- ============================================================================
-- Mesure prod Mayer (2026-10-10) : tarifs (190 € × 3 zones), durée (90 min)
-- et compétences (4 techniciens, entretien + pose) identiques aux deux types.
-- Re-pointe tout ce qui référence `poele_granules_sans_elec` vers
-- `poele_granules_elec` de la même org, puis supprime le type (tarifs et
-- compétences tombent en cascade, chantiers → SET NULL mais aucun concerné).
-- Générique par org : toute org possédant les deux codes est fusionnée.
-- ============================================================================

DO $$
DECLARE
  v_org   uuid;
  v_from  uuid;
  v_to    uuid;
  v_n     integer;
BEGIN
  FOR v_org, v_from, v_to IN
    SELECT s.org_id, s.id, t.id
      FROM majordhome.pricing_equipment_types s
      JOIN majordhome.pricing_equipment_types t
        ON t.org_id = s.org_id AND t.code = 'poele_granules_elec'
     WHERE s.code = 'poele_granules_sans_elec'
  LOOP
    UPDATE majordhome.equipments SET equipment_type_id = v_to WHERE equipment_type_id = v_from;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'org % : % équipement(s) re-pointé(s)', v_org, v_n;

    UPDATE majordhome.contract_pricing_items SET equipment_type_id = v_to WHERE equipment_type_id = v_from;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'org % : % ligne(s) de contrat re-pointée(s)', v_org, v_n;

    UPDATE majordhome.leads SET equipment_type_id = v_to WHERE equipment_type_id = v_from;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'org % : % lead(s) re-pointé(s)', v_org, v_n;

    UPDATE majordhome.chantiers SET equipment_type_id = v_to WHERE equipment_type_id = v_from;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'org % : % chantier(s) re-pointé(s)', v_org, v_n;

    -- Garde : plus aucune référence hors cascade avant de supprimer
    IF EXISTS (SELECT 1 FROM majordhome.equipments WHERE equipment_type_id = v_from)
       OR EXISTS (SELECT 1 FROM majordhome.contract_pricing_items WHERE equipment_type_id = v_from)
       OR EXISTS (SELECT 1 FROM majordhome.leads WHERE equipment_type_id = v_from)
       OR EXISTS (SELECT 1 FROM majordhome.chantiers WHERE equipment_type_id = v_from)
    THEN
      RAISE EXCEPTION 'merge_incomplete pour org %', v_org;
    END IF;

    DELETE FROM majordhome.pricing_equipment_types WHERE id = v_from;
    RAISE NOTICE 'org % : type poele_granules_sans_elec supprimé', v_org;
  END LOOP;
END $$;
