/**
 * useContractCreationLines — lignes d'un contrat EN COURS DE CRÉATION (CreateContractModal).
 * ============================================================================
 * Un équipement constaté chez un client n'est pas sous contrat ; mais quand on crée le
 * contrat, ce qui est déjà recensé doit être proposé d'emblée. Avant ce hook, la modale
 * ne lisait jamais les équipements du client : elle partait d'une liste vide de TYPES et
 * recréait un équipement par type coché — donc des doublons de ce que la fiche portait
 * déjà (Eric 2026-11-16).
 *
 * Lignes du contrat = équipements recensés retenus (cochés par défaut, RATTACHÉS à la
 * création) + types ajoutés dans la modale (nouveaux équipements, comme avant).
 * Le prix d'un équipement recensé suit `computeContractLines` — le calcul de la fiche
 * contrat une fois créé (1 ligne par équipement) — et la dégressivité porte sur l'ensemble.
 * ============================================================================
 */

import { useState, useMemo, useCallback } from 'react';
import { useClientEquipments } from '@hooks/useClients';
import { pricingService } from '@services/pricing.service';
import { contractsService } from '@services/contracts.service';
import { computeContractLines, calculateContractTotal } from '@/lib/contractPricing';
import { logger } from '@lib/logger';

/**
 * Écrit les équipements d'un contrat qui vient d'être créé :
 *  - types ajoutés dans la modale → nouveaux équipements + liens (comme avant) ;
 *  - équipements déjà recensés retenus → RATTACHÉS (même geste que « Ajouter au contrat »
 *    de l'onglet Équipements), jamais recréés.
 * Les services renvoient `{ error }` sans throw : chaque erreur est lue. Un rattachement
 * refusé est compté et rendu à l'appelant, qui le dit à l'utilisateur.
 *
 * @param {object} p
 * @param {string} p.contractId
 * @param {string|null} p.clientId
 * @param {Array} p.newItems - `calculator.getItemsForSave()`
 * @param {Array} p.recensedLines - lignes recensées RETENUES (sortie du hook, `included`)
 * @param {string|null} p.zoneId - zone tarifaire active
 * @returns {Promise<{ linkFailures: number }>}
 */
export async function saveContractCreationEquipments({ contractId, clientId, newItems = [], recensedLines = [], zoneId = null }) {
  if (!contractId || (newItems.length === 0 && recensedLines.length === 0)) return { linkFailures: 0 };

  // Photo tarifaire de création : types ajoutés + équipements recensés typés. `equipment_id` reste
  // NULL — une ligne avec `equipment_id` voudrait dire « prix forcé par ligne » (cf. CLAUDE.md).
  const recensedSnapshot = zoneId
    ? recensedLines.filter((line) => line.equipmentTypeId).map((line) => ({
      equipmentTypeId: line.equipmentTypeId,
      zoneId,
      quantity: line.unitCount || 1,
      basePrice: line.basePrice,
      unitPrice: 0,
      lineTotal: line.lineTotal,
    }))
    : [];
  const saveResult = await pricingService.saveContractPricingItems(contractId, [...newItems, ...recensedSnapshot]);
  if (saveResult.error) logger.warn('[contractCreation] Erreur sauvegarde pricing items:', saveResult.error);

  if (clientId && newItems.length > 0) {
    const eqResult = await contractsService.createEquipmentsFromPricingItems(contractId, clientId, newItems);
    if (eqResult.error) logger.warn('[contractCreation] Erreur création équipements:', eqResult.error);
  }

  let linkFailures = 0;
  for (const line of recensedLines) {
    const { error: linkError } = await contractsService.addEquipmentToContract(contractId, line.equipmentId);
    if (linkError) {
      linkFailures += 1;
      logger.error('[contractCreation] Rattachement équipement refusé:', line.equipmentId, linkError);
    }
  }
  return { linkFailures };
}

/**
 * @param {object} p
 * @param {string|null} p.clientId - client EXISTANT sélectionné (null pour un client en cours de création)
 * @param {object} p.pricingData - sortie de `usePricingData()`
 * @param {object} p.calculator - sortie de `usePricingCalculator()` (types ajoutés + zone active)
 */
export function useContractCreationLines({ clientId, pricingData, calculator }) {
  const {
    equipments,
    isLoading,
    error,
    refresh,
  } = useClientEquipments(clientId);

  // Tout est coché par défaut : on ne retient que ce que l'utilisateur ÉCARTE.
  const [excludedIds, setExcludedIds] = useState(() => new Set());

  const { rates, equipmentTypes, discounts } = pricingData;
  const { activeZone, items: addedItems } = calculator;

  const recensedLines = useMemo(() => (
    computeContractLines({ equipments, rates, equipmentTypes, zone: activeZone })
      .items.map((line) => ({ ...line, included: !excludedIds.has(line.equipmentId) }))
  ), [equipments, rates, equipmentTypes, activeZone, excludedIds]);

  const lines = useMemo(() => [
    ...recensedLines.filter((line) => line.included).map((line) => ({
      key: `eq-${line.equipmentId}`,
      label: line.labelWithUnits,
      detail: line.reference,
      quantity: 1,
      basePrice: line.basePrice,
      lineTotal: line.lineTotal,
      recensed: true,
    })),
    ...addedItems.map((item, idx) => ({
      key: `type-${item.equipmentTypeId}-${idx}`,
      label: item.equipType?.label || item.equipmentTypeCode,
      detail: null,
      quantity: item.equipType?.has_unit_pricing ? item.quantity : 1,
      basePrice: item.basePrice,
      lineTotal: item.lineTotal,
      recensed: false,
    })),
  ], [recensedLines, addedItems]);

  const pricing = useMemo(() => calculateContractTotal(lines, discounts), [lines, discounts]);

  const toggle = useCallback((equipmentId) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(equipmentId)) next.delete(equipmentId); else next.add(equipmentId);
      return next;
    });
  }, []);

  const resetSelection = useCallback(() => setExcludedIds(new Set()), []);

  return {
    /** Équipements recensés du client, chacun avec `included` (coché) et son prix grille. */
    recensedLines,
    /** Équipements recensés bruts (pour savoir si un type est déjà couvert). */
    recensedEquipments: equipments,
    /** Toutes les lignes du contrat (recensés retenus + types ajoutés). */
    lines,
    /** { subtotal, discountPercent, discountAmount, total } sur l'ensemble des lignes. */
    pricing,
    isLoading,
    error,
    retry: refresh,
    toggle,
    resetSelection,
  };
}

export default useContractCreationLines;
