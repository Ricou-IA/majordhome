/**
 * useChantiers.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour le Kanban chantiers (workflow post-vente).
 *
 * @version 1.0.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chantiersService } from '@services/chantiers.service';
import { chantierKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';

// Re-export for backward compatibility
export { chantierKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK - useChantiers (liste pour le Kanban)
// ============================================================================

export function useChantiers(orgId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: chantierKeys.list(orgId),
    queryFn: async () => {
      const { data, error } = await chantiersService.getChantiers({ orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 15_000,
  });

  return {
    chantiers: data || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useChantierMutations
// ============================================================================

export function useChantierMutations() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const invalidateChantiers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: chantierKeys.all(orgId) });
  }, [queryClient, orgId]);

  // Mutation : changer le statut chantier
  const statusMutation = useMutation({
    mutationFn: ({ leadId, newStatus }) =>
      chantiersService.updateChantierStatus(leadId, newStatus),
    onSuccess: invalidateChantiers,
  });

  // Mutation : mettre à jour les commandes (équipement + matériaux)
  const orderMutation = useMutation({
    mutationFn: ({ leadId, ...params }) =>
      chantiersService.updateOrderStatus(leadId, params),
    onSuccess: invalidateChantiers,
  });

  // Mutation : date estimative
  const dateMutation = useMutation({
    mutationFn: ({ leadId, estimatedDate }) =>
      chantiersService.updateEstimatedDate(leadId, estimatedDate),
    onSuccess: invalidateChantiers,
  });

  // Mutation : notes
  const notesMutation = useMutation({
    mutationFn: ({ leadId, notes }) =>
      chantiersService.updateChantierNotes(leadId, notes),
    onSuccess: invalidateChantiers,
  });

  // Mutation : upload PV de réception
  const pvMutation = useMutation({
    mutationFn: ({ leadId, file }) =>
      chantiersService.uploadPvReception(leadId, file),
    onSuccess: invalidateChantiers,
  });

  return {
    updateChantierStatus: useCallback(
      (leadId, newStatus) => statusMutation.mutateAsync({ leadId, newStatus }),
      [statusMutation]
    ),
    updateOrderStatus: useCallback(
      (leadId, params) => orderMutation.mutateAsync({ leadId, ...params }),
      [orderMutation]
    ),
    updateEstimatedDate: useCallback(
      (leadId, estimatedDate) => dateMutation.mutateAsync({ leadId, estimatedDate }),
      [dateMutation]
    ),
    updateChantierNotes: useCallback(
      (leadId, notes) => notesMutation.mutateAsync({ leadId, notes }),
      [notesMutation]
    ),
    uploadPvReception: useCallback(
      (leadId, file) => pvMutation.mutateAsync({ leadId, file }),
      [pvMutation]
    ),

    // États
    isUpdatingStatus: statusMutation.isPending,
    isUpdatingOrder: orderMutation.isPending,
    isUploadingPv: pvMutation.isPending,

    invalidate: invalidateChantiers,
  };
}
