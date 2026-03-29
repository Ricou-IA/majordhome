/**
 * useProspects.js — Hooks React Query pour le module Prospection
 * ============================================================================
 * Hooks TanStack React Query v5 pour prospects (Cédants + Commercial).
 * Pattern identique à useClients.js.
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { prospectsService } from '@services/prospects.service';
import { prospectKeys, clientKeys } from '@hooks/cacheKeys';
import { usePaginatedList } from '@hooks/usePaginatedList';

// Re-export pour les consumers existants
export { prospectKeys } from '@hooks/cacheKeys';

// ============================================================================
// CONSTANTES
// ============================================================================

const DEFAULT_LIMIT = 25;

const DEFAULT_FILTERS = {
  search: '',
  statut: null,
  departement: null,
  priorite: null,
  scoreMin: null,
  scoreMax: null,
  orderBy: 'created_at',
  ascending: false,
};

// ============================================================================
// HOOK — useProspects (liste)
// ============================================================================

export function useProspects({ orgId, module, limit = DEFAULT_LIMIT } = {}) {
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
    queryKeyFn: (filters) => prospectKeys.list(orgId, module, filters),
    fetchFn: (filters, limit, offset) =>
      prospectsService.getProspects({ orgId, module, ...filters, limit, offset }),
    enabled: !!orgId && !!module,
    defaultFilters: DEFAULT_FILTERS,
    limit,
    staleTime: 30_000,
  });

  return {
    prospects: items,
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
// HOOK — useProspect (detail)
// ============================================================================

export function useProspect(prospectId) {
  const queryClient = useQueryClient();

  const {
    data: prospect,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: prospectKeys.detail(prospectId),
    queryFn: async () => {
      const { data, error } = await prospectsService.getProspectById(prospectId);
      if (error) throw error;
      return data;
    },
    enabled: !!prospectId,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (updates) => prospectsService.updateProspect(prospectId, updates),
    onSuccess: (result) => {
      if (result?.data) {
        queryClient.setQueryData(prospectKeys.detail(prospectId), result.data);
        queryClient.invalidateQueries({ queryKey: prospectKeys.lists() });
      }
    },
  });

  const updateProspect = useCallback(
    async (updates) => {
      try {
        return await updateMutation.mutateAsync(updates);
      } catch (err) {
        return { data: null, error: err };
      }
    },
    [updateMutation]
  );

  return {
    prospect,
    isLoading,
    error,
    updateProspect,
    isUpdating: updateMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK — useProspectInteractions (timeline)
// ============================================================================

export function useProspectInteractions(prospectId) {
  const queryClient = useQueryClient();

  const {
    data: interactions,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: prospectKeys.interactions(prospectId),
    queryFn: async () => {
      const { data, error } = await prospectsService.getInteractions(prospectId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!prospectId,
    staleTime: 15_000,
  });

  const addMutation = useMutation({
    mutationFn: (interactionData) =>
      prospectsService.addInteraction(prospectId, interactionData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: prospectKeys.interactions(prospectId) });
    },
  });

  return {
    interactions: interactions || [],
    isLoading,
    error,
    addInteraction: addMutation.mutateAsync,
    isAdding: addMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK — useProspectStats (KPIs)
// ============================================================================

export function useProspectStats(orgId, module) {
  const {
    data: stats,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: prospectKeys.stats(orgId, module),
    queryFn: async () => {
      const { data, error } = await prospectsService.getStats(orgId, module);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!module,
    staleTime: 60_000,
  });

  return { stats, isLoading, error, refresh: refetch };
}

// ============================================================================
// HOOK — useProspectMutations (create/delete/status/convert)
// ============================================================================

export function useProspectMutations() {
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: prospectKeys.all });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data) => prospectsService.createProspect(data),
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: (prospectId) => prospectsService.deleteProspect(prospectId),
    onSuccess: invalidateAll,
  });

  const statusMutation = useMutation({
    mutationFn: ({ prospectId, newStatus, userId, contenu }) =>
      prospectsService.updateStatus(prospectId, newStatus, userId, { contenu }),
    onSuccess: (_, { prospectId }) => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: prospectKeys.interactions(prospectId) });
    },
  });

  const convertMutation = useMutation({
    mutationFn: ({ prospectId, orgId, userId }) =>
      prospectsService.convertToClient(prospectId, orgId, userId),
    onSuccess: () => {
      invalidateAll();
      // Invalider aussi la liste clients
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });

  return {
    createProspect: useCallback(
      (data) => createMutation.mutateAsync(data),
      [createMutation]
    ),
    isCreating: createMutation.isPending,

    deleteProspect: useCallback(
      (prospectId) => deleteMutation.mutateAsync(prospectId),
      [deleteMutation]
    ),
    isDeleting: deleteMutation.isPending,

    updateStatus: useCallback(
      (prospectId, newStatus, userId, contenu) =>
        statusMutation.mutateAsync({ prospectId, newStatus, userId, contenu }),
      [statusMutation]
    ),
    isUpdatingStatus: statusMutation.isPending,

    convertToClient: useCallback(
      (prospectId, orgId, userId) =>
        convertMutation.mutateAsync({ prospectId, orgId, userId }),
      [convertMutation]
    ),
    isConverting: convertMutation.isPending,

    invalidate: invalidateAll,
  };
}

// ============================================================================
// HOOK — useExistingSirens (pour le screener, check doublons batch)
// ============================================================================

export function useExistingSirens(orgId, module, sirens) {
  const { data, isLoading } = useQuery({
    queryKey: [...prospectKeys.sirens(orgId, module), sirens],
    queryFn: async () => {
      const { data, error } = await prospectsService.getExistingSirens(orgId, module, sirens);
      if (error) throw error;
      return new Set(data);
    },
    enabled: !!orgId && !!module && sirens?.length > 0,
    staleTime: 10_000,
  });

  return { existingSirens: data || new Set(), isChecking: isLoading };
}
