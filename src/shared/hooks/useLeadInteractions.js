/**
 * useLeadInteractions.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour la timeline d'interactions MT-LT et le suivi
 * des projets long-terme.
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadInteractionsService } from '@services/leadInteractions.service';
import { leadsService } from '@services/leads.service';
import { leadInteractionKeys, leadKeys } from '@hooks/cacheKeys';

export { leadInteractionKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK - useLeadInteractions (timeline d'un lead)
// ============================================================================

export function useLeadInteractions(leadId) {
  const {
    data: interactions,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: leadInteractionKeys.byLead(leadId),
    queryFn: () => leadInteractionsService.getByLeadId(leadId),
    enabled: !!leadId,
    staleTime: 15_000,
    select: (result) => result?.data || [],
  });

  return {
    interactions: interactions || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useLeadInteractionMutations
// ============================================================================

export function useLeadInteractionMutations() {
  const queryClient = useQueryClient();

  const invalidateForLead = (leadId) => {
    queryClient.invalidateQueries({ queryKey: leadInteractionKeys.byLead(leadId) });
    // last_interaction_at est calculé dans la vue leads → invalider les listes
    queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
  };

  const createMutation = useMutation({
    mutationFn: (input) => leadInteractionsService.create(input),
    onSuccess: (_, variables) => invalidateForLead(variables.leadId),
  });

  const updateMutation = useMutation({
    mutationFn: ({ interactionId, updates, leadId }) =>
      leadInteractionsService.update(interactionId, updates).then((res) => ({ ...res, leadId })),
    onSuccess: (result) => {
      if (result?.leadId) invalidateForLead(result.leadId);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ interactionId, leadId }) =>
      leadInteractionsService.delete(interactionId).then((res) => ({ ...res, leadId })),
    onSuccess: (result) => {
      if (result?.leadId) invalidateForLead(result.leadId);
    },
  });

  return {
    createInteraction: createMutation.mutateAsync,
    updateInteraction: updateMutation.mutateAsync,
    deleteInteraction: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

// ============================================================================
// HOOK - useLongTermLeads (liste MT-LT)
// ============================================================================

export function useLongTermLeads({ orgId, filters = {}, limit = 200 } = {}) {
  const queryClient = useQueryClient();

  const finalFilters = {
    ...filters,
    isLongTermProject: true,
    orderBy: filters.orderBy || 'long_term_started_at',
    ascending: filters.ascending ?? true,
  };

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: leadKeys.longTerm(orgId, finalFilters),
    queryFn: async () => leadsService.getLeads({ orgId, filters: finalFilters, limit, offset: 0 }),
    enabled: !!orgId,
    staleTime: 15_000,
  });

  const leads = data?.data || [];
  const totalCount = data?.count || 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: leadKeys.all });
    return refetch();
  };

  return {
    leads,
    totalCount,
    isLoading,
    error,
    refresh,
  };
}

// ============================================================================
// HOOK - useLongTermMutations (move / reactivate)
// ============================================================================

export function useLongTermMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: leadKeys.all });
  };

  const moveMutation = useMutation({
    mutationFn: ({ leadId, notes }) => leadsService.moveToLongTerm(leadId, notes),
    onSuccess: invalidate,
  });

  const reactivateMutation = useMutation({
    mutationFn: ({ leadId }) => leadsService.reactivateFromLongTerm(leadId),
    onSuccess: invalidate,
  });

  return {
    moveToLongTerm: moveMutation.mutateAsync,
    reactivateFromLongTerm: reactivateMutation.mutateAsync,
    isMoving: moveMutation.isPending,
    isReactivating: reactivateMutation.isPending,
  };
}
