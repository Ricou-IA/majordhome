/**
 * useLeads.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour la gestion des leads du pipeline commercial.
 *
 * @version 1.0.0 - Sprint 4 Pipeline Commercial
 * ============================================================================
 */

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsService } from '@/shared/services/leads.service';

// ============================================================================
// CLÉS DE CACHE
// ============================================================================

export const leadKeys = {
  all: ['leads'],
  lists: () => [...leadKeys.all, 'list'],
  list: (orgId, filters) => [...leadKeys.lists(), orgId, filters],
  detail: (id) => [...leadKeys.all, 'detail', id],
  activities: (leadId) => [...leadKeys.all, 'activities', leadId],
  sources: () => [...leadKeys.all, 'sources'],
  statuses: () => [...leadKeys.all, 'statuses'],
  commercials: (orgId) => [...leadKeys.all, 'commercials', orgId],
  search: (orgId, query) => [...leadKeys.all, 'search', orgId, query],
};

// ============================================================================
// HOOK - useLeads (liste paginée avec filtres)
// ============================================================================

/**
 * Hook pour la liste des leads avec filtres et pagination
 *
 * @param {Object} options
 * @param {string} options.orgId - ID core.organizations
 * @param {number} options.limit - Nombre par page (défaut 25)
 *
 * @example
 * const { leads, isLoading, filters, setFilters, loadMore, hasMore } = useLeads({ orgId });
 */
export function useLeads({ orgId, limit = 25 } = {}) {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [allLeads, setAllLeads] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFiltersState] = useState({
    search: '',
    statusId: null,
    sourceId: null,
    assignedUserId: null,
    dateFrom: null,
    dateTo: null,
    orderBy: 'created_date',
    ascending: false,
  });

  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: leadKeys.list(orgId, { ...filters, offset, limit }),
    queryFn: async () => {
      const result = await leadsService.getLeads({
        orgId,
        filters,
        limit,
        offset,
      });
      return result;
    },
    enabled: !!orgId,
    staleTime: 15_000,
    keepPreviousData: true,
    onSuccess: (result) => {
      if (!result?.data) return;
      if (offset === 0) {
        setAllLeads(result.data);
      } else {
        setAllLeads(prev => [...prev, ...result.data]);
      }
      setTotalCount(result.count || 0);
    },
  });

  // Mise à jour des filtres (reset la pagination)
  const setFilters = useCallback((newFilters) => {
    setFiltersState(prev => {
      const updated = typeof newFilters === 'function' ? newFilters(prev) : { ...prev, ...newFilters };
      return updated;
    });
    setOffset(0);
    setAllLeads([]);
  }, []);

  // Recherche
  const setSearch = useCallback((search) => {
    setFilters(prev => ({ ...prev, search }));
  }, [setFilters]);

  // Reset filtres
  const resetFilters = useCallback(() => {
    setFiltersState({
      search: '',
      statusId: null,
      sourceId: null,
      assignedUserId: null,
      dateFrom: null,
      dateTo: null,
      orderBy: 'created_date',
      ascending: false,
    });
    setOffset(0);
    setAllLeads([]);
  }, []);

  // Charger plus
  const loadMore = useCallback(() => {
    setOffset(prev => prev + limit);
  }, [limit]);

  // Refresh complet
  const refresh = useCallback(() => {
    setOffset(0);
    setAllLeads([]);
    queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
  }, [queryClient]);

  const leads = allLeads.length > 0 ? allLeads : (data?.data || []);
  const hasMore = leads.length < totalCount;

  return {
    leads,
    totalCount,
    isLoading: isLoading && offset === 0,
    loadingMore: isFetching && offset > 0,
    hasMore,
    error,
    filters,
    setFilters,
    setSearch,
    resetFilters,
    loadMore,
    refresh,
  };
}

// ============================================================================
// HOOK - useLead (détail d'un lead)
// ============================================================================

/**
 * Hook pour un lead spécifique
 */
export function useLead(leadId) {
  const {
    data: lead,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: leadKeys.detail(leadId),
    queryFn: () => leadsService.getLeadById(leadId),
    enabled: !!leadId,
    staleTime: 30_000,
    select: (result) => result?.data || null,
  });

  return {
    lead,
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useLeadActivities (timeline)
// ============================================================================

/**
 * Hook pour les activités d'un lead
 */
export function useLeadActivities(leadId) {
  const {
    data: activities,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: leadKeys.activities(leadId),
    queryFn: () => leadsService.getLeadActivities(leadId),
    enabled: !!leadId,
    staleTime: 15_000,
    select: (result) => result?.data || [],
  });

  return {
    activities: activities || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useLeadSources (données de référence)
// ============================================================================

export function useLeadSources() {
  const {
    data: sources,
    isLoading,
    error,
  } = useQuery({
    queryKey: leadKeys.sources(),
    queryFn: () => leadsService.getSources(),
    staleTime: 5 * 60_000, // 5 minutes
    select: (result) => result?.data || [],
  });

  return { sources: sources || [], isLoading, error };
}

// ============================================================================
// HOOK - useLeadStatuses (données de référence)
// ============================================================================

export function useLeadStatuses() {
  const {
    data: statuses,
    isLoading,
    error,
  } = useQuery({
    queryKey: leadKeys.statuses(),
    queryFn: () => leadsService.getStatuses(),
    staleTime: 5 * 60_000,
    select: (result) => result?.data || [],
  });

  return { statuses: statuses || [], isLoading, error };
}

// ============================================================================
// HOOK - useLeadCommercials (assignation)
// ============================================================================

export function useLeadCommercials(orgId) {
  const {
    data: commercials,
    isLoading,
    error,
  } = useQuery({
    queryKey: leadKeys.commercials(orgId),
    queryFn: () => leadsService.getCommercials(orgId),
    staleTime: 5 * 60_000,
    enabled: !!orgId,
    select: (result) => result?.data || [],
  });

  return { commercials: commercials || [], isLoading, error };
}

// ============================================================================
// HOOK - useLeadMutations
// ============================================================================

/**
 * Hook regroupant toutes les mutations leads
 */
export function useLeadMutations() {
  const queryClient = useQueryClient();

  const invalidateLeads = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: leadKeys.all });
  }, [queryClient]);

  // Créer un lead
  const createMutation = useMutation({
    mutationFn: (data) => leadsService.createLead(data),
    onSuccess: invalidateLeads,
  });

  // Mettre à jour un lead
  const updateMutation = useMutation({
    mutationFn: ({ leadId, updates }) => leadsService.updateLead(leadId, updates),
    onSuccess: invalidateLeads,
  });

  // Soft delete un lead
  const deleteMutation = useMutation({
    mutationFn: (leadId) => leadsService.softDeleteLead(leadId),
    onSuccess: invalidateLeads,
  });

  // Changer le statut
  const statusMutation = useMutation({
    mutationFn: ({ leadId, statusId, userId, extra }) =>
      leadsService.updateLeadStatus(leadId, statusId, userId, extra),
    onSuccess: invalidateLeads,
  });

  // Assigner un lead
  const assignMutation = useMutation({
    mutationFn: ({ leadId, assignedUserId, currentUserId }) =>
      leadsService.assignLead(leadId, assignedUserId, currentUserId),
    onSuccess: invalidateLeads,
  });

  // Convertir en client
  const convertMutation = useMutation({
    mutationFn: ({ leadId, orgId, userId }) =>
      leadsService.convertLeadToClient(leadId, orgId, userId),
    onSuccess: () => {
      invalidateLeads();
      // Invalider aussi le cache clients
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });

  // Ajouter une note
  const addNoteMutation = useMutation({
    mutationFn: ({ leadId, orgId, userId, description }) =>
      leadsService.addLeadNote(leadId, { orgId, userId, description }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: leadKeys.activities(variables.leadId) });
    },
  });

  // Enregistrer un appel
  const logCallMutation = useMutation({
    mutationFn: ({ leadId, orgId, userId, description }) =>
      leadsService.logCall(leadId, { orgId, userId, description }),
    onSuccess: invalidateLeads,
  });

  // Helpers wrappés
  const createLead = useCallback(async (data) => createMutation.mutateAsync(data), [createMutation]);
  const updateLead = useCallback(async (leadId, updates) => updateMutation.mutateAsync({ leadId, updates }), [updateMutation]);
  const deleteLead = useCallback(async (leadId) => deleteMutation.mutateAsync(leadId), [deleteMutation]);
  const updateLeadStatus = useCallback(async (leadId, statusId, userId, extra) => statusMutation.mutateAsync({ leadId, statusId, userId, extra }), [statusMutation]);
  const assignLead = useCallback(async (leadId, assignedUserId, currentUserId) => assignMutation.mutateAsync({ leadId, assignedUserId, currentUserId }), [assignMutation]);
  const convertLead = useCallback(async (leadId, orgId, userId) => convertMutation.mutateAsync({ leadId, orgId, userId }), [convertMutation]);
  const addNote = useCallback(async (leadId, orgId, userId, description) => addNoteMutation.mutateAsync({ leadId, orgId, userId, description }), [addNoteMutation]);
  const logCall = useCallback(async (leadId, orgId, userId, description) => logCallMutation.mutateAsync({ leadId, orgId, userId, description }), [logCallMutation]);

  return {
    createLead,
    updateLead,
    deleteLead,
    updateLeadStatus,
    assignLead,
    convertLead,
    addNote,
    logCall,

    // États
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isChangingStatus: statusMutation.isPending,
    isAssigning: assignMutation.isPending,
    isConverting: convertMutation.isPending,
    isAddingNote: addNoteMutation.isPending,
    isLoggingCall: logCallMutation.isPending,
  };
}

// ============================================================================
// HOOK - useLeadSearch (recherche légère pour EventModal)
// ============================================================================

export function useLeadSearch(orgId, { debounceMs = 300, minChars = 2 } = {}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  const { data: results, isLoading: searching } = useQuery({
    queryKey: leadKeys.search(orgId, debouncedQuery),
    queryFn: async () => {
      const { data, error } = await leadsService.searchLeads(orgId, debouncedQuery);
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
// EXPORTS
// ============================================================================

export default useLeads;
