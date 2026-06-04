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
} from '@services/pricing.service';
import { useAuth } from '@contexts/AuthContext';
import { getOrgHeadquarters } from '@/lib/territoire-config';
import { contractKeys, pricingKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { pricingKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK - usePricingData (données de référence)
// ============================================================================

/**
 * Charge toutes les données de référence pricing en une requête, scopées sur
 * l'organisation courante (RLS + filtre explicite défense en profondeur).
 *
 * @returns {Object} { zones, equipmentTypes, rates, discounts, extras, isLoading, error }
 */
export function usePricingData() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: pricingKeys.allData(orgId),
    queryFn: async () => {
      const result = await pricingService.getAllPricingData(orgId);
      if (result.error) throw result.error;
      return result.data;
    },
    enabled: !!orgId,
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
// HOOK - usePricingAdmin (CRUD UI Settings → Tarification)
// ============================================================================

/**
 * Charge les 5 grilles tarifaires (zones, types, rates, discounts, extras) y
 * compris les rows inactives — pour l'UI d'admin. Expose aussi toutes les
 * mutations CRUD scopées sur l'org courante.
 */
export function usePricingAdmin() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: pricingKeys.all(orgId) });
  }, [queryClient, orgId]);

  const zonesQuery = useQuery({
    queryKey: pricingKeys.zones(orgId),
    queryFn: async () => {
      const r = await pricingService.getZones(orgId, { activeOnly: false });
      if (r.error) throw r.error;
      return r.data;
    },
    enabled: !!orgId,
  });

  const equipmentTypesQuery = useQuery({
    queryKey: pricingKeys.equipmentTypes(orgId),
    queryFn: async () => {
      const r = await pricingService.getEquipmentTypes(orgId, { activeOnly: false });
      if (r.error) throw r.error;
      return r.data;
    },
    enabled: !!orgId,
  });

  const ratesQuery = useQuery({
    queryKey: pricingKeys.rates(orgId),
    queryFn: async () => {
      const r = await pricingService.getRates(orgId);
      if (r.error) throw r.error;
      return r.data;
    },
    enabled: !!orgId,
  });

  const discountsQuery = useQuery({
    queryKey: pricingKeys.discounts(orgId),
    queryFn: async () => {
      const r = await pricingService.getDiscounts(orgId, { activeOnly: false });
      if (r.error) throw r.error;
      return r.data;
    },
    enabled: !!orgId,
  });

  const extrasQuery = useQuery({
    queryKey: pricingKeys.extras(orgId),
    queryFn: async () => {
      const r = await pricingService.getExtras(orgId, { activeOnly: false });
      if (r.error) throw r.error;
      return r.data;
    },
    enabled: !!orgId,
  });

  // Helper qui transforme une réponse { data, error } du service en valeur résolvable
  const unwrap = async (promise) => {
    const r = await promise;
    if (r.error) throw r.error;
    return r.data ?? null;
  };
  const mutationOptions = { onSuccess: invalidateAll };

  const createZone = useMutation({
    mutationFn: (payload) => unwrap(pricingService.createZone(orgId, payload)),
    ...mutationOptions,
  });
  const updateZone = useMutation({
    mutationFn: ({ id, payload }) => unwrap(pricingService.updateZone(id, payload)),
    ...mutationOptions,
  });
  const deleteZone = useMutation({
    mutationFn: (id) => unwrap(pricingService.deleteZone(id)),
    ...mutationOptions,
  });

  const createEquipmentType = useMutation({
    mutationFn: (payload) => unwrap(pricingService.createEquipmentType(orgId, payload)),
    ...mutationOptions,
  });
  const updateEquipmentType = useMutation({
    mutationFn: ({ id, payload }) => unwrap(pricingService.updateEquipmentType(id, payload)),
    ...mutationOptions,
  });
  const deleteEquipmentType = useMutation({
    mutationFn: (id) => unwrap(pricingService.deleteEquipmentType(id)),
    ...mutationOptions,
  });

  const upsertRate = useMutation({
    mutationFn: (payload) => unwrap(pricingService.upsertRate(orgId, payload)),
    ...mutationOptions,
  });
  const deleteRate = useMutation({
    mutationFn: (id) => unwrap(pricingService.deleteRate(id)),
    ...mutationOptions,
  });

  const createExtra = useMutation({
    mutationFn: (payload) => unwrap(pricingService.createExtra(orgId, payload)),
    ...mutationOptions,
  });
  const updateExtra = useMutation({
    mutationFn: ({ id, payload }) => unwrap(pricingService.updateExtra(id, payload)),
    ...mutationOptions,
  });
  const deleteExtra = useMutation({
    mutationFn: (id) => unwrap(pricingService.deleteExtra(id)),
    ...mutationOptions,
  });

  const createDiscount = useMutation({
    mutationFn: (payload) => unwrap(pricingService.createDiscount(orgId, payload)),
    ...mutationOptions,
  });
  const updateDiscount = useMutation({
    mutationFn: ({ id, payload }) => unwrap(pricingService.updateDiscount(id, payload)),
    ...mutationOptions,
  });
  const deleteDiscount = useMutation({
    mutationFn: (id) => unwrap(pricingService.deleteDiscount(id)),
    ...mutationOptions,
  });

  return {
    orgId,
    zones: zonesQuery.data || [],
    equipmentTypes: equipmentTypesQuery.data || [],
    rates: ratesQuery.data || [],
    discounts: discountsQuery.data || [],
    extras: extrasQuery.data || [],
    isLoading:
      zonesQuery.isLoading ||
      equipmentTypesQuery.isLoading ||
      ratesQuery.isLoading ||
      discountsQuery.isLoading ||
      extrasQuery.isLoading,
    error:
      zonesQuery.error ||
      equipmentTypesQuery.error ||
      ratesQuery.error ||
      discountsQuery.error ||
      extrasQuery.error,
    createZone, updateZone, deleteZone,
    createEquipmentType, updateEquipmentType, deleteEquipmentType,
    upsertRate, deleteRate,
    createExtra, updateExtra, deleteExtra,
    createDiscount, updateDiscount, deleteDiscount,
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
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { data: items, isLoading, error, refetch } = useQuery({
    queryKey: pricingKeys.contractItems(orgId, contractId),
    queryFn: async () => {
      const result = await pricingService.getContractPricingItems(contractId);
      if (result.error) throw result.error;
      return result.data;
    },
    enabled: !!orgId && !!contractId,
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
      queryClient.invalidateQueries({ queryKey: pricingKeys.contractItems(orgId, contractId) });
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
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
// HOOK - useContractLineOverrides (prix forcés par ligne d'équipement)
// ============================================================================

/**
 * Charge les prix forcés par ligne d'un contrat (map equipment_id → prix) +
 * mutations set/clear. Convention : 1 entrée `contract_pricing_items` avec
 * `equipment_id` NON NULL par équipement forcé (cf. pricingService).
 *
 * @param {string} contractId
 * @returns {Object} { overrides, isLoading, setOverride, clearOverride, isSaving }
 */
export function useContractLineOverrides(contractId) {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { data: overrides, isLoading } = useQuery({
    queryKey: pricingKeys.contractOverrides(orgId, contractId),
    queryFn: async () => {
      const result = await pricingService.getContractLineOverrides(contractId);
      if (result.error) throw result.error;
      return result.data;
    },
    enabled: !!orgId && !!contractId,
    staleTime: 30_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: pricingKeys.contractOverrides(orgId, contractId) });
    queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
  }, [queryClient, orgId, contractId]);

  const setMutation = useMutation({
    mutationFn: async ({ line, forcedPrice }) => {
      const result = await pricingService.setContractLineOverride(contractId, line, forcedPrice);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });

  const clearMutation = useMutation({
    mutationFn: async (equipmentId) => {
      const result = await pricingService.clearContractLineOverride(contractId, equipmentId);
      if (result.error) throw result.error;
      return true;
    },
    onSuccess: invalidate,
  });

  const setOverride = useCallback(
    (line, forcedPrice) => setMutation.mutateAsync({ line, forcedPrice }),
    [setMutation]
  );
  const clearOverride = useCallback(
    (equipmentId) => clearMutation.mutateAsync(equipmentId),
    [clearMutation]
  );

  return {
    overrides: overrides || {},
    isLoading,
    setOverride,
    clearOverride,
    isSaving: setMutation.isPending || clearMutation.isPending,
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
  // P0.19 — siège org pour calcul temps de trajet (null si non configuré)
  const { organization } = useAuth();
  const orgHq = useMemo(
    () => getOrgHeadquarters(organization?.settings),
    [organization?.settings],
  );

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
        const result = await detectZoneForAddress(address, postalCode, city, zones, orgHq);
        setAsyncZone(result.zone);
        setDurationMinutes(result.durationMinutes);
      } catch (err) {
        console.warn('[usePricingCalculator] Zone detection error:', err);
      } finally {
        setIsDetectingZone(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [clientAddress.address, clientAddress.postalCode, clientAddress.city, zones, orgHq]);

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
  const zoneSupplement = parseFloat(activeZone?.supplement || 0);
  const computedItems = useMemo(() => {
    if (!activeZone) return selectedItems;
    return selectedItems.map((item) => {
      const rate = getRate(activeZone.id, item.equipmentTypeId);
      const equipType = equipmentTypes?.find((et) => et.id === item.equipmentTypeId);
      const lineTotal = calculateLineTotal(rate, equipType, item.quantity, zoneSupplement);
      return {
        ...item,
        rate,
        equipType,
        basePrice: rate ? parseFloat(rate.price) : 0,
        unitPrice: rate ? parseFloat(rate.unit_price) : 0,
        lineTotal,
      };
    });
  }, [selectedItems, activeZone, getRate, equipmentTypes, zoneSupplement]);

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
      equipmentTypeCode: item.equipmentTypeCode,
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
    hqLabel: orgHq?.label || null,

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
