/**
 * useClients.js - Majord'home Artisan
 * ============================================================================
 * Hooks React pour la gestion des clients.
 * Utilise TanStack React Query pour le cache, la pagination et les mutations.
 *
 * @version 5.0.0 - Refonte avec React Query + table clients dédiée
 * ============================================================================
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsService } from '@/shared/services/clients.service';

// ============================================================================
// CLÉS DE CACHE
// ============================================================================

export const clientKeys = {
  all: ['clients'],
  lists: () => [...clientKeys.all, 'list'],
  list: (orgId, filters) => [...clientKeys.lists(), orgId, filters],
  details: () => [...clientKeys.all, 'detail'],
  detail: (id) => [...clientKeys.details(), id],
  stats: (orgId) => [...clientKeys.all, 'stats', orgId],
  search: (orgId, query) => [...clientKeys.all, 'search', orgId, query],
  activities: (clientId) => [...clientKeys.all, 'activities', clientId],
};

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
  const [filters, setFiltersState] = useState(DEFAULT_FILTERS);
  const [allClients, setAllClients] = useState([]);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Query pour la première page
  const {
    data: queryData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: clientKeys.list(orgId, filters),
    queryFn: () =>
      clientsService.getClients({
        orgId,
        search: filters.search,
        clientCategory: filters.clientCategory,
        postalCode: filters.postalCode,
        city: filters.city,
        hasContract: filters.hasContract,
        equipmentCategory: filters.equipmentCategory,
        showArchived: filters.showArchived,
        onlyArchived: filters.onlyArchived,
        orderBy: filters.orderBy,
        ascending: filters.ascending,
        limit,
        offset: 0,
      }),
    enabled: !!orgId,
    staleTime: 30_000, // 30s
    select: (result) => result, // Garder le format { data, count, error }
  });

  // Synchroniser les résultats de la première page
  useEffect(() => {
    if (queryData?.data) {
      setAllClients(queryData.data);
      setTotalCount(queryData.count || 0);
      setOffset(limit);
    }
  }, [queryData, limit]);

  const hasMore = useMemo(() => allClients.length < totalCount, [allClients.length, totalCount]);

  // Charger plus (pagination manuelle)
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !orgId) return;

    setLoadingMore(true);
    try {
      const { data } = await clientsService.getClients({
        orgId,
        search: filters.search,
        clientCategory: filters.clientCategory,
        postalCode: filters.postalCode,
        city: filters.city,
        hasContract: filters.hasContract,
        equipmentCategory: filters.equipmentCategory,
        showArchived: filters.showArchived,
        onlyArchived: filters.onlyArchived,
        orderBy: filters.orderBy,
        ascending: filters.ascending,
        limit,
        offset,
      });

      if (data) {
        setAllClients((prev) => [...prev, ...data]);
        setOffset((prev) => prev + limit);
      }
    } catch (err) {
      console.error('[useClients] loadMore error:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [orgId, filters, limit, offset, loadingMore, hasMore]);

  // Modifier les filtres (reset la pagination)
  const setFilters = useCallback((newFilters) => {
    setFiltersState((prev) => {
      const updated = typeof newFilters === 'function' ? newFilters(prev) : { ...prev, ...newFilters };
      return updated;
    });
    setOffset(0);
    setAllClients([]);
  }, []);

  // Raccourci recherche
  const setSearch = useCallback(
    (search) => {
      setFilters((prev) => ({ ...prev, search }));
    },
    [setFilters]
  );

  // Réinitialiser filtres
  const reset = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
    setOffset(0);
    setAllClients([]);
    setTotalCount(0);
  }, []);

  return {
    clients: allClients,
    isLoading,
    loadingMore,
    error: queryData?.error || error,
    totalCount,
    hasMore,
    filters,
    setFilters,
    setSearch,
    loadMore,
    refresh: refetch,
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
    queryKey: ['client-equipments', clientId],
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
      queryClient.invalidateQueries({ queryKey: ['client-equipments', clientId] });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
      // Invalider aussi le cache contrats (liaison contract_equipments)
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ equipmentId, updates }) => clientsService.updateEquipment(equipmentId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-equipments', clientId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (equipmentId) => clientsService.deleteEquipment(equipmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-equipments', clientId] });
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
    queryKey: ['equipment-brands'],
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
    queryKey: ['pricing-equipment-types'],
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
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

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
    setDebouncedQuery('');
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
  const [debouncedLastName, setDebouncedLastName] = useState('');
  const [debouncedPostalCode, setDebouncedPostalCode] = useState('');

  // Debounce 500ms pour éviter les requêtes pendant la frappe
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedLastName(lastName || '');
      setDebouncedPostalCode(postalCode || '');
    }, 500);
    return () => clearTimeout(timer);
  }, [lastName, postalCode]);

  const { data: duplicates, isLoading } = useQuery({
    queryKey: [...clientKeys.all, 'duplicates', orgId, debouncedLastName, debouncedPostalCode],
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
