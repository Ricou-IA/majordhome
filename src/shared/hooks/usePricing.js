/**
 * usePricing.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour le moteur de tarification.
 *
 * - usePricingData()        : charge toutes les données de référence (zones, types, rates, discounts, extras)
 * - useContractPricing()    : charge les lignes tarifaires d'un contrat
 * - usePricingCalculator()  : state machine pour le formulaire de création contrat
 *
 * @version 1.0.0 - Création moteur de tarification
 * ============================================================================
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  pricingService,
  detectZoneFromPostalCode,
  detectZoneForAddress,
  calculateLineTotal,
  calculateContractTotal,
} from '@/shared/services/pricing.service';
import { contractKeys, pricingKeys } from '@/shared/hooks/cacheKeys';

// Re-export for backward compatibility
export { pricingKeys } from '@/shared/hooks/cacheKeys';

// ============================================================================
// HOOK - usePricingData (données de référence)
// ============================================================================

/**
 * Charge toutes les données de référence pricing en une requête.
 * Utilisé par le formulaire de création contrat.
 *
 * @returns {Object} { zones, equipmentTypes, rates, discounts, extras, isLoading, error }
 */
export function usePricingData() {
  const { data, isLoading, error } = useQuery({
    queryKey: pricingKeys.allData(),
    queryFn: async () => {
      const result = await pricingService.getAllPricingData();
      if (result.error) throw result.error;
      return result.data;
    },
    staleTime: 5 * 60_000, // 5 min - données de référence stables
  });

  return {
    zones: data?.zones || [],
    equipmentTypes: data?.equipmentTypes || [],
    rates: data?.rates || [],
    discounts: data?.discounts || [],
    extras: data?.extras || [],
    isLoading,
    error,
  };
}

// ============================================================================
// HOOK - useContractPricing (lignes tarifaires d'un contrat)
// ============================================================================

/**
 * Charge les lignes tarifaires d'un contrat existant.
 *
 * @param {string} contractId - UUID du contrat
 * @returns {Object} { items, isLoading, error, refresh }
 */
export function useContractPricing(contractId) {
  const queryClient = useQueryClient();

  const { data: items, isLoading, error, refetch } = useQuery({
    queryKey: pricingKeys.contractItems(contractId),
    queryFn: async () => {
      const result = await pricingService.getContractPricingItems(contractId);
      if (result.error) throw result.error;
      return result.data;
    },
    enabled: !!contractId,
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ items: newItems, pricing, zoneId }) => {
      // Sauvegarder les lignes
      const itemsResult = await pricingService.saveContractPricingItems(contractId, newItems);
      if (itemsResult.error) throw itemsResult.error;

      // Mettre à jour le montant du contrat
      const amountResult = await pricingService.updateContractAmount(contractId, pricing, zoneId);
      if (amountResult.error) throw amountResult.error;

      return { items: itemsResult.data, contract: amountResult.data };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pricingKeys.contractItems(contractId) });
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });

  const saveItems = useCallback(
    async (newItems, pricing, zoneId) => {
      try {
        const result = await saveMutation.mutateAsync({ items: newItems, pricing, zoneId });
        return { data: result, error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    },
    [saveMutation]
  );

  return {
    items: items || [],
    isLoading,
    error,
    saveItems,
    isSaving: saveMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - usePricingCalculator (state machine formulaire)
// ============================================================================

/**
 * State machine pour la sélection d'équipements et le calcul de prix
 * en temps réel dans le formulaire de création/édition de contrat.
 *
 * Accepte soit un code postal (string) pour rétrocompatibilité,
 * soit un objet { address, postalCode, city } pour la détection par temps de trajet.
 *
 * @param {Object} pricingData - { zones, equipmentTypes, rates, discounts }
 * @param {string|Object} clientAddressOrPostalCode - Code postal ou { address, postalCode, city }
 * @returns {Object} State + actions
 */
export function usePricingCalculator(pricingData, clientAddressOrPostalCode) {
  const { zones, equipmentTypes, rates, discounts } = pricingData || {};

  // Normaliser l'entrée : string (legacy) ou objet { address, postalCode, city }
  const clientAddress = useMemo(() => {
    if (typeof clientAddressOrPostalCode === 'string') {
      return { address: '', postalCode: clientAddressOrPostalCode, city: '' };
    }
    return clientAddressOrPostalCode || { address: '', postalCode: '', city: '' };
  }, [clientAddressOrPostalCode]);

  // Détection sync instantanée (fallback département)
  const syncZone = useMemo(
    () => detectZoneFromPostalCode(clientAddress.postalCode, zones),
    [clientAddress.postalCode, zones]
  );

  // Détection async par temps de trajet Mapbox
  const [asyncZone, setAsyncZone] = useState(null);
  const [isDetectingZone, setIsDetectingZone] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(null);
  const detectAbortRef = useRef(null);

  useEffect(() => {
    const { address, postalCode, city } = clientAddress;
    if (!postalCode || !zones?.length) {
      setAsyncZone(null);
      setDurationMinutes(null);
      return;
    }

    // Debounce 600ms pour éviter les appels pendant la saisie
    const timer = setTimeout(async () => {
      setIsDetectingZone(true);
      try {
        const result = await detectZoneForAddress(address, postalCode, city, zones);
        setAsyncZone(result.zone);
        setDurationMinutes(result.durationMinutes);
      } catch (err) {
        console.warn('[usePricingCalculator] Zone detection error:', err);
      } finally {
        setIsDetectingZone(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [clientAddress.address, clientAddress.postalCode, clientAddress.city, zones]);

  // Zone effective : async (Mapbox) > sync (département) > manual override
  const detectedZone = asyncZone || syncZone;

  // Zone sélectionnée (auto-détectée par défaut, overridable)
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const activeZone = useMemo(() => {
    if (selectedZoneId) return zones?.find((z) => z.id === selectedZoneId) || detectedZone;
    return detectedZone;
  }, [selectedZoneId, zones, detectedZone]);

  // Lignes tarifaires sélectionnées
  // Structure : [{ equipmentTypeId, equipmentTypeCode, quantity, rate, equipType, lineTotal }]
  const [selectedItems, setSelectedItems] = useState([]);

  // Index des tarifs par zone + equipment_type pour lookup rapide
  const rateIndex = useMemo(() => {
    if (!rates) return {};
    const idx = {};
    for (const r of rates) {
      const zId = r.zone_id || r.zone?.id;
      const etId = r.equipment_type_id || r.equipment_type?.id;
      if (zId && etId) {
        idx[`${zId}_${etId}`] = r;
      }
    }
    return idx;
  }, [rates]);

  // Lookup d'un tarif
  const getRate = useCallback(
    (zoneId, equipmentTypeId) => rateIndex[`${zoneId}_${equipmentTypeId}`] || null,
    [rateIndex]
  );

  // Recalculer les lignes quand la zone change
  const computedItems = useMemo(() => {
    if (!activeZone) return selectedItems;
    return selectedItems.map((item) => {
      const rate = getRate(activeZone.id, item.equipmentTypeId);
      const equipType = equipmentTypes?.find((et) => et.id === item.equipmentTypeId);
      const lineTotal = calculateLineTotal(rate, equipType, item.quantity);
      return {
        ...item,
        rate,
        equipType,
        basePrice: rate ? parseFloat(rate.price) : 0,
        unitPrice: rate ? parseFloat(rate.unit_price) : 0,
        lineTotal,
      };
    });
  }, [selectedItems, activeZone, getRate, equipmentTypes]);

  // Calcul total avec remises
  const pricing = useMemo(
    () => calculateContractTotal(computedItems, discounts),
    [computedItems, discounts]
  );

  // --- ACTIONS ---

  const addItem = useCallback(
    (equipmentTypeId, quantity = 1) => {
      const equipType = equipmentTypes?.find((et) => et.id === equipmentTypeId);
      if (!equipType) return;

      // Vérifier que le type n'est pas déjà ajouté (sauf unit_pricing)
      const exists = selectedItems.find((item) => item.equipmentTypeId === equipmentTypeId);
      if (exists && !equipType.has_unit_pricing) return;

      setSelectedItems((prev) => [
        ...prev,
        {
          equipmentTypeId,
          equipmentTypeCode: equipType.code,
          quantity: equipType.has_unit_pricing ? quantity : 1,
        },
      ]);
    },
    [equipmentTypes, selectedItems]
  );

  const removeItem = useCallback((index) => {
    setSelectedItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateItemQuantity = useCallback((index, quantity) => {
    setSelectedItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, quantity: Math.max(1, quantity) } : item))
    );
  }, []);

  const setZone = useCallback((zoneId) => {
    setSelectedZoneId(zoneId);
  }, []);

  const reset = useCallback(() => {
    setSelectedItems([]);
    setSelectedZoneId(null);
  }, []);

  /**
   * Initialise le calculator avec des items existants (édition contrat)
   * @param {Array} existingItems - Items depuis majordhome_contract_pricing_items
   * @param {string} existingZoneId - UUID de la zone du contrat
   */
  const initializeItems = useCallback((existingItems, existingZoneId = null) => {
    if (!existingItems?.length) return;
    const mapped = existingItems.map((item) => ({
      equipmentTypeId: item.equipment_type_id,
      equipmentTypeCode: item.equipment_type_code || '',
      quantity: item.quantity || 1,
    }));
    setSelectedItems(mapped);
    if (existingZoneId) {
      setSelectedZoneId(existingZoneId);
    }
  }, []);

  /**
   * Prépare les lignes pour l'envoi au service (format DB)
   */
  const getItemsForSave = useCallback(() => {
    if (!activeZone) return [];
    return computedItems.map((item) => ({
      equipmentTypeId: item.equipmentTypeId,
      zoneId: activeZone.id,
      quantity: item.quantity,
      basePrice: item.basePrice,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    }));
  }, [computedItems, activeZone]);

  return {
    // State
    detectedZone,
    activeZone,
    items: computedItems,
    pricing, // { subtotal, discountPercent, discountAmount, total }
    hasItems: computedItems.length > 0,
    isDetectingZone,
    durationMinutes,

    // Actions
    addItem,
    removeItem,
    updateItemQuantity,
    setZone,
    reset,
    initializeItems,
    getItemsForSave,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default usePricingData;
