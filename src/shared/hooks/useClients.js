/**
 * useClients.js - Majord'home Artisan
 * ============================================================================
 * Hooks React pour la gestion des clients.
 * Utilise TanStack React Query pour le cache, la pagination et les mutations.
 *
 * @version 6.0.0 - Refonte : cacheKeys centralisées, usePaginatedList, useDebounce
 * ============================================================================
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsService } from '@services/clients.service';
import { clientKeys, contractKeys } from '@hooks/cacheKeys';
import { usePaginatedList } from '@hooks/usePaginatedList';
import { useDebounce } from '@hooks/useDebounce';

// Re-export for backward compatibility
export { clientKeys } from '@hooks/cacheKeys';

// ============================================================================
// CONSTANTES
// ============================================================================

const DEFAULT_LIMIT = 25;

const DEFAULT_FILTERS = {
  search: '',
  clientCategory: null,
  postalCode: null,
  city: null,
  hasContract: null,
  equipmentCategory: null,
  showArchived: false,
  onlyArchived: false,
  orderBy: 'display_name',
  ascending: true,
};

// ============================================================================
// HOOK PRINCIPAL - useClients (liste)
// ============================================================================

/**
 * Hook pour la liste des clients avec pagination et filtres
 *
 * @param {Object} options
 * @param {string} options.orgId - ID de l'organisation (requis)
 * @param {number} [options.limit=25] - Éléments par page
 *
 * @returns {Object} État et méthodes
 *
 * @example
 * const { clients, isLoading, filters, setFilters, loadMore, hasMore } = useClients({ orgId });
 */
export function useClients({ orgId, limit = DEFAULT_LIMIT } = {}) {
  const {
    items,
    totalCount,
    isLoading,
    loadingMore,
    error,
    hasMore,
    filters,
    setFilters,
    setSearch,
    loadMore,
    refresh,
    reset,
  } = usePaginatedList({
    queryKeyFn: (filters) => clientKeys.list(orgId, filters),
    fetchFn: (filters, limit, offset) =>
      clientsService.getClients({ orgId, ...filters, limit, offset }),
    enabled: !!orgId,
    defaultFilters: DEFAULT_FILTERS,
    limit,
    staleTime: 30_000,
  });

  return {
    clients: items,
    isLoading,
    loadingMore,
    error,
    totalCount,
    hasMore,
    filters,
    setFilters,
    setSearch,
    loadMore,
    refresh,
    reset,
  };
}

// ============================================================================
// HOOK - useClient (détail d'un client)
// ============================================================================

/**
 * Hook pour charger les détails d'un client
 *
 * @param {string} clientId - UUID du client (majordhome.clients.id)
 * @returns {Object} État et méthodes
 *
 * @example
 * const { client, isLoading, updateClient, refresh } = useClient(clientId);
 */
export function useClient(clientId) {
  const queryClient = useQueryClient();

  const {
    data: queryData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: clientKeys.detail(clientId),
    queryFn: () => clientsService.getClientById(clientId),
    enabled: !!clientId,
    staleTime: 30_000,
    select: (result) => result?.data || null,
  });

  // Mutation de mise à jour
  const updateMutation = useMutation({
    mutationFn: (updates) => clientsService.updateClient(clientId, updates),
    onSuccess: (result) => {
      if (result?.data) {
        // Mettre à jour le cache du détail
        queryClient.setQueryData(clientKeys.detail(clientId), (old) => ({
          ...old,
          data: { ...(old?.data || {}), ...result.data },
        }));
        // Invalider la liste pour que les changements se reflètent
        queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      }
    },
  });

  // Mutation d'archivage
  const archiveMutation = useMutation({
    mutationFn: () => clientsService.archiveClient(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      queryClient.invalidateQueries({ queryKey: clientKeys.stats() });
    },
  });

  // Mutation de désarchivage
  const unarchiveMutation = useMutation({
    mutationFn: () => clientsService.unarchiveClient(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      queryClient.invalidateQueries({ queryKey: clientKeys.stats() });
    },
  });

  const updateClient = useCallback(
    async (updates) => {
      try {
        const result = await updateMutation.mutateAsync(updates);
        return result;
      } catch (err) {
        return { data: null, error: err };
      }
    },
    [updateMutation]
  );

  const archiveClient = useCallback(async () => {
    try {
      const result = await archiveMutation.mutateAsync();
      return result;
    } catch (err) {
      return { success: false, error: err };
    }
  }, [archiveMutation]);

  const unarchiveClient = useCallback(async () => {
    try {
      const result = await unarchiveMutation.mutateAsync();
      return result;
    } catch (err) {
      return { success: false, error: err };
    }
  }, [unarchiveMutation]);

  return {
    client: queryData,
    isLoading,
    error: error || queryData?.error,
    updateClient,
    isUpdating: updateMutation.isPending,
    archiveClient,
    isArchiving: archiveMutation.isPending,
    unarchiveClient,
    isUnarchiving: unarchiveMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useClientEquipments
// ============================================================================

/**
 * Hook pour gérer les équipements d'un client
 *
 * @param {string} clientId - UUID du client
 * @returns {Object} État et méthodes
 */
export function useClientEquipments(clientId) {
  const queryClient = useQueryClient();

  const {
    data: equipments,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: clientKeys.equipments(clientId),
    queryFn: async () => {
      const { data, error } = await clientsService.getClientEquipments(clientId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: (equipmentData) => clientsService.addEquipment(clientId, equipmentData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.equipments(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
      // Invalider aussi le cache contrats (liaison contract_equipments)
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ equipmentId, updates }) => clientsService.updateEquipment(equipmentId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.equipments(clientId) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (equipmentId) => clientsService.deleteEquipment(equipmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.equipments(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
    },
  });

  return {
    equipments: equipments || [],
    isLoading,
    error,
    addEquipment: addMutation.mutateAsync,
    updateEquipment: (equipmentId, updates) => updateMutation.mutateAsync({ equipmentId, updates }),
    deleteEquipment: deleteMutation.mutateAsync,
    isAdding: addMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useEquipmentBrands (marques d'équipements)
// ============================================================================

/**
 * Hook pour les marques d'équipements (données quasi-statiques)
 * @returns {{ brands: Array, isLoading: boolean, error: Error|null }}
 */
export function useEquipmentBrands() {
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: clientKeys.brands(),
    queryFn: async () => {
      const { data, error } = await clientsService.getBrands();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 min — données quasi-statiques
  });

  return { brands: data || [], isLoading, error };
}

// ============================================================================
// HOOK - usePricingEquipmentTypes
// ============================================================================

/**
 * Hook pour les types d'équipements pricing (grille tarifaire)
 * Utilisé dans le formulaire d'ajout d'équipement pour le dropdown "Type"
 *
 * @returns {{ equipmentTypes: Array, isLoading: boolean, error: Error|null }}
 */
export function usePricingEquipmentTypes() {
  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: clientKeys.pricingTypes(),
    queryFn: async () => {
      const { data, error } = await clientsService.getPricingEquipmentTypes();
      if (error) throw error;
      return data;
    },
    staleTime: 10 * 60 * 1000, // 10 min — données quasi-statiques
  });

  return { equipmentTypes: data || [], isLoading, error };
}

// ============================================================================
// HOOK - useClientActivities (timeline)
// ============================================================================

/**
 * Hook pour la timeline d'un client
 *
 * @param {string} clientId - UUID du client
 * @returns {Object} État et méthodes
 */
export function useClientActivities(clientId) {
  const queryClient = useQueryClient();

  const {
    data: activities,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: clientKeys.activities(clientId),
    queryFn: async () => {
      const { data, error } = await clientsService.getClientActivities(clientId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId,
    staleTime: 15_000, // 15s - timeline change souvent
  });

  const addNoteMutation = useMutation({
    mutationFn: (noteData) => clientsService.addClientNote({ clientId, ...noteData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.activities(clientId) });
    },
  });

  return {
    activities: activities || [],
    isLoading,
    error,
    addNote: addNoteMutation.mutateAsync,
    isAddingNote: addNoteMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useClientStats
// ============================================================================

/**
 * Hook pour les statistiques clients
 *
 * @param {string} orgId - ID de l'organisation
 * @returns {Object} État et méthodes
 */
export function useClientStats(orgId) {
  const {
    data: stats,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: clientKeys.stats(orgId),
    queryFn: async () => {
      const { data, error } = await clientsService.getClientStats(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 60_000, // 1min
  });

  return {
    stats,
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useClientSearch (autocomplete)
// ============================================================================

/**
 * Hook pour la recherche rapide de clients (autocomplete)
 *
 * @param {string} orgId - ID de l'organisation
 * @param {Object} [options]
 * @param {number} [options.debounceMs=300] - Délai debounce
 * @param {number} [options.minChars=2] - Caractères minimum
 */
export function useClientSearch(orgId, { debounceMs = 300, minChars = 2 } = {}) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, debounceMs);

  const { data: results, isLoading: searching } = useQuery({
    queryKey: clientKeys.search(orgId, debouncedQuery),
    queryFn: async () => {
      const { data, error } = await clientsService.searchClients(orgId, debouncedQuery);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && debouncedQuery.length >= minChars,
    staleTime: 10_000,
  });

  const search = useCallback((newQuery) => setQuery(newQuery), []);
  const clear = useCallback(() => {
    setQuery('');
  }, []);

  return {
    query,
    results: results || [],
    searching,
    search,
    clear,
  };
}

// ============================================================================
// HOOK - useDuplicateCheck (détection doublons)
// ============================================================================

/**
 * Hook pour la détection de doublons client par nom + code postal
 * Utilisé lors de la création d'un nouveau client (CreateContractModal)
 *
 * @param {string} orgId - ID de l'organisation
 * @param {string} lastName - Nom de famille à vérifier
 * @param {string} postalCode - Code postal (optionnel, affine la recherche)
 * @returns {{ duplicates: Array, isChecking: boolean }}
 */
export function useDuplicateCheck(orgId, lastName, postalCode) {
  const debouncedLastName = useDebounce(lastName || '', 500);
  const debouncedPostalCode = useDebounce(postalCode || '', 500);

  const { data: duplicates, isLoading } = useQuery({
    queryKey: clientKeys.duplicates(orgId, debouncedLastName, debouncedPostalCode),
    queryFn: async () => {
      const { data, error } = await clientsService.checkDuplicates(orgId, debouncedLastName, debouncedPostalCode);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && debouncedLastName.length >= 2,
    staleTime: 15_000,
  });

  return { duplicates: duplicates || [], isChecking: isLoading };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useClients;
