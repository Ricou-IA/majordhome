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
import { interventionsService } from '@services/interventions.service';
import { chantierKeys, interventionKeys } from '@hooks/cacheKeys';

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

  const invalidateChantiers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: chantierKeys.all });
  }, [queryClient]);

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

  // Mutation : créer intervention parent
  const createInterventionMutation = useMutation({
    mutationFn: (params) =>
      interventionsService.createChantierIntervention(params),
    onSuccess: (_, variables) => {
      invalidateChantiers();
      queryClient.invalidateQueries({
        queryKey: interventionKeys.byProject(variables.projectId),
      });
    },
  });

  // Mutation : créer un slot
  const createSlotMutation = useMutation({
    mutationFn: (params) =>
      interventionsService.createInterventionSlot(params),
    onSuccess: (_, variables) => {
      invalidateChantiers();
      queryClient.invalidateQueries({
        queryKey: interventionKeys.slots(variables.parentId),
      });
    },
  });

  // Mutation : supprimer un slot
  const deleteSlotMutation = useMutation({
    mutationFn: (slotId) =>
      interventionsService.deleteInterventionSlot(slotId),
    onSuccess: () => {
      invalidateChantiers();
      queryClient.invalidateQueries({ queryKey: interventionKeys.all });
    },
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
    createChantierIntervention: useCallback(
      (params) => createInterventionMutation.mutateAsync(params),
      [createInterventionMutation]
    ),
    createSlot: useCallback(
      (params) => createSlotMutation.mutateAsync(params),
      [createSlotMutation]
    ),
    deleteSlot: useCallback(
      (slotId) => deleteSlotMutation.mutateAsync(slotId),
      [deleteSlotMutation]
    ),
    uploadPvReception: useCallback(
      (leadId, file) => pvMutation.mutateAsync({ leadId, file }),
      [pvMutation]
    ),

    // États
    isUpdatingStatus: statusMutation.isPending,
    isUpdatingOrder: orderMutation.isPending,
    isCreatingIntervention: createInterventionMutation.isPending,
    isCreatingSlot: createSlotMutation.isPending,
    isUploadingPv: pvMutation.isPending,

    invalidate: invalidateChantiers,
  };
}

// ============================================================================
// HOOK - useInterventionSlots
// ============================================================================

export function useInterventionSlots(parentId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: interventionKeys.slots(parentId),
    queryFn: async () => {
      const { data, error } = await interventionsService.getInterventionSlots(parentId);
      if (error) throw error;
      return data;
    },
    enabled: !!parentId,
    staleTime: 15_000,
  });

  return {
    slots: data || [],
    isLoading,
    error,
    refresh: refetch,
  };
}
