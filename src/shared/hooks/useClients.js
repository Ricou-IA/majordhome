/**
 * useClients.js - Majord'home Artisan
 * ============================================================================
 * Hooks React pour la gestion des clients.
 * Utilise TanStack React Query pour le cache, la pagination et les mutations.
 *
 * @version 6.0.0 - Refonte : cacheKeys centralisées, usePaginatedList, useDebounce
 * @version 6.1.0 - P0.11 : propagation orgId dans toutes les cache keys
 * ============================================================================
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsService } from '@services/clients.service';
import { clientKeys, contractKeys, appointmentKeys, interventionKeys } from '@hooks/cacheKeys';
import { usePaginatedList } from '@hooks/usePaginatedList';
import { useDebounce } from '@hooks/useDebounce';
import { useAuth } from '@contexts/AuthContext';

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

export function useClient(clientId) {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const {
    data: queryData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: clientKeys.detail(orgId, clientId),
    queryFn: () => clientsService.getClientById(clientId),
    enabled: !!orgId && !!clientId,
    staleTime: 30_000,
    select: (result) => result?.data || null,
  });

  // Mutation de mise à jour
  const updateMutation = useMutation({
    mutationFn: (updates) => clientsService.updateClient(clientId, updates),
    onSuccess: (result) => {
      if (result?.data) {
        queryClient.setQueryData(clientKeys.detail(orgId, clientId), (old) => ({
          ...old,
          data: { ...(old?.data || {}), ...result.data },
        }));
        queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
      }
    },
  });

  // Mutation d'archivage
  const archiveMutation = useMutation({
    mutationFn: () => clientsService.archiveClient(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.stats(orgId) });
    },
  });

  // Mutation de désarchivage
  const unarchiveMutation = useMutation({
    mutationFn: () => clientsService.unarchiveClient(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.stats(orgId) });
    },
  });

  // Mutation hard delete (org_admin only) — god mode, nettoyage de base.
  // Supprime contrats/interventions/certificats + détache leads/RDV → invalidation croisée large.
  const hardDeleteMutation = useMutation({
    mutationFn: () => clientsService.hardDeleteClient(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: interventionKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all(orgId) });
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

  const hardDeleteClient = useCallback(
    async () => hardDeleteMutation.mutateAsync(),
    [hardDeleteMutation]
  );

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
    hardDeleteClient,
    isHardDeleting: hardDeleteMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useClientEquipments
// ============================================================================

export function useClientEquipments(clientId) {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const {
    data: equipments,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: clientKeys.equipments(orgId, clientId),
    queryFn: async () => {
      const { data, error } = await clientsService.getClientEquipments(clientId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && !!clientId,
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: (equipmentData) => clientsService.addEquipment(clientId, equipmentData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.equipments(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      // Invalider aussi le cache contrats (liaison contract_equipments)
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ equipmentId, updates }) => clientsService.updateEquipment(equipmentId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.equipments(orgId, clientId) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (equipmentId) => clientsService.deleteEquipment(equipmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.equipments(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
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

export function useEquipmentBrands() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: clientKeys.brands(orgId),
    queryFn: async () => {
      const { data, error } = await clientsService.getBrands();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // 5 min — données quasi-statiques
  });

  return { brands: data || [], isLoading, error };
}

// ============================================================================
// HOOK - usePricingEquipmentTypes
// ============================================================================

export function usePricingEquipmentTypes() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: clientKeys.pricingTypes(orgId),
    queryFn: async () => {
      const { data, error } = await clientsService.getPricingEquipmentTypes();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 10 * 60 * 1000, // 10 min — données quasi-statiques
  });

  return { equipmentTypes: data || [], isLoading, error };
}

// ============================================================================
// HOOK - useClientActivities (timeline)
// ============================================================================

export function useClientActivities(clientId) {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const {
    data: activities,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: clientKeys.activities(orgId, clientId),
    queryFn: async () => {
      const { data, error } = await clientsService.getClientActivities(clientId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && !!clientId,
    staleTime: 15_000, // 15s - timeline change souvent
  });

  const addNoteMutation = useMutation({
    mutationFn: (noteData) => clientsService.addClientNote({ clientId, ...noteData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.activities(orgId, clientId) });
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
// HOOK - useLinkedClients (propriétaire / locataire)
// ============================================================================

export function useLinkedClients(clientId, orgId) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: clientKeys.linked(orgId, clientId),
    queryFn: async () => {
      const { data, error } = await clientsService.getLinkedClients(clientId, orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && !!orgId,
    staleTime: 30_000,
  });

  const invalidateLinked = useCallback((ids) => {
    ids.forEach(id => {
      if (id) queryClient.invalidateQueries({ queryKey: clientKeys.linked(orgId, id) });
    });
    queryClient.invalidateQueries({ queryKey: clientKeys.details(orgId) });
  }, [queryClient, orgId]);

  const linkMutation = useMutation({
    mutationFn: ({ tenantId, ownerId }) => clientsService.linkClientAsOwner(tenantId, ownerId),
    onSuccess: (_, { tenantId, ownerId }) => invalidateLinked([tenantId, ownerId]),
  });

  const unlinkMutation = useMutation({
    mutationFn: (targetClientId) => clientsService.unlinkClient(targetClientId),
    onSuccess: () => invalidateLinked([clientId, data?.owner?.id]),
  });

  return {
    owner: data?.owner || null,
    tenants: data?.tenants || [],
    isLoading,
    linkClient: linkMutation.mutateAsync,
    unlinkClient: unlinkMutation.mutateAsync,
    isLinking: linkMutation.isPending,
    isUnlinking: unlinkMutation.isPending,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useClients;
