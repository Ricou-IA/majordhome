/**
 * useEntretienSAV.js - Majord'home Artisan
 * ============================================================================
 * Hooks TanStack React Query pour le module Entretien & SAV (Kanban unifié).
 *
 * Pattern identique à useChantiers.js :
 * - useEntretienSAV(orgId) → liste items
 * - useEntretienSAVMutations() → mutations + invalidation
 * - useEntretienSAVStats(orgId) → stats dashboard
 *
 * @version 1.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { savService } from '@services/sav.service';
import { entretienSavKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { entretienSavKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK : LISTE ITEMS (KANBAN)
// ============================================================================

/**
 * Charge tous les items entretien + SAV d'une organisation
 * @param {string} orgId
 * @returns {{ items: Array, isLoading: boolean, error: Error, refresh: Function }}
 */
export function useEntretienSAV(orgId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: entretienSavKeys.list(orgId),
    queryFn: async () => {
      const { data, error } = await savService.getEntretiensSAV({ orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 15_000,
  });

  return {
    items: data || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK : STATS DASHBOARD
// ============================================================================

/**
 * Charge les statistiques entretien + SAV
 * @param {string} orgId
 * @returns {{ stats: Object, isLoading: boolean, error: Error }}
 */
export function useEntretienSAVStats(orgId) {
  const { data, isLoading, error } = useQuery({
    queryKey: entretienSavKeys.stats(orgId),
    queryFn: async () => {
      const { data, error } = await savService.getStats(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  return {
    stats: data || null,
    isLoading,
    error,
  };
}

// ============================================================================
// HOOK : MUTATIONS
// ============================================================================

/**
 * Mutations pour le kanban Entretien & SAV
 * @returns {Object} Mutation functions + loading states
 */
export function useEntretienSAVMutations() {
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.all });
  }, [queryClient]);

  // --- Création entretien ---
  const createEntretienMutation = useMutation({
    mutationFn: (params) => savService.createEntretien(params),
    onSuccess: () => {
      invalidateAll();
      toast.success('Entretien programmé');
    },
    onError: (err) => {
      console.error('[useEntretienSAV] createEntretien error:', err);
      toast.error('Erreur lors de la création');
    },
  });

  // --- Création SAV ---
  const createSAVMutation = useMutation({
    mutationFn: (params) => savService.createSAV(params),
    onSuccess: () => {
      invalidateAll();
      toast.success('Demande SAV créée');
    },
    onError: (err) => {
      console.error('[useEntretienSAV] createSAV error:', err);
      toast.error('Erreur lors de la création SAV');
    },
  });

  // --- Transition workflow ---
  const statusMutation = useMutation({
    mutationFn: ({ interventionId, newStatus }) =>
      savService.updateWorkflowStatus(interventionId, newStatus),
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err) => {
      console.error('[useEntretienSAV] updateWorkflowStatus error:', err);
      toast.error('Erreur de transition');
    },
  });

  // --- Commande pièces ---
  const partsOrderMutation = useMutation({
    mutationFn: ({ interventionId, status }) =>
      savService.updatePartsOrderStatus(interventionId, status),
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err) => {
      console.error('[useEntretienSAV] updatePartsOrder error:', err);
      toast.error('Erreur mise à jour commande');
    },
  });

  // --- Devis ---
  const devisMutation = useMutation({
    mutationFn: ({ interventionId, amount, status }) =>
      savService.updateDevis(interventionId, { amount, status }),
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err) => {
      console.error('[useEntretienSAV] updateDevis error:', err);
      toast.error('Erreur mise à jour devis');
    },
  });

  // --- Notes ---
  const notesMutation = useMutation({
    mutationFn: ({ interventionId, notes }) =>
      savService.updateNotes(interventionId, notes),
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err) => {
      console.error('[useEntretienSAV] updateNotes error:', err);
      toast.error('Erreur sauvegarde notes');
    },
  });

  // --- Description SAV ---
  const descriptionMutation = useMutation({
    mutationFn: ({ interventionId, description }) =>
      savService.updateSavDescription(interventionId, description),
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err) => {
      console.error('[useEntretienSAV] updateDescription error:', err);
      toast.error('Erreur sauvegarde description');
    },
  });

  // --- Sauvegarde groupée (bouton Enregistrer) ---
  const updateFieldsMutation = useMutation({
    mutationFn: ({ interventionId, fields }) =>
      savService.updateFields(interventionId, fields),
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err) => {
      console.error('[useEntretienSAV] updateFields error:', err);
      toast.error('Erreur sauvegarde');
    },
  });

  return {
    // Création
    createEntretien: (params) => createEntretienMutation.mutateAsync(params),
    createSAV: (params) => createSAVMutation.mutateAsync(params),

    // Transitions
    updateWorkflowStatus: (interventionId, newStatus) =>
      statusMutation.mutateAsync({ interventionId, newStatus }),

    // SAV fields
    updatePartsOrder: (interventionId, status) =>
      partsOrderMutation.mutateAsync({ interventionId, status }),
    updateDevis: (interventionId, amount, status) =>
      devisMutation.mutateAsync({ interventionId, amount, status }),

    // Common
    updateNotes: (interventionId, notes) =>
      notesMutation.mutateAsync({ interventionId, notes }),
    updateDescription: (interventionId, description) =>
      descriptionMutation.mutateAsync({ interventionId, description }),

    // Grouped save
    updateFields: (interventionId, fields) =>
      updateFieldsMutation.mutateAsync({ interventionId, fields }),

    // Loading states
    isCreatingEntretien: createEntretienMutation.isPending,
    isCreatingSAV: createSAVMutation.isPending,
    isUpdatingStatus: statusMutation.isPending,
    isUpdatingPartsOrder: partsOrderMutation.isPending,
    isUpdatingDevis: devisMutation.isPending,
    isSavingNotes: notesMutation.isPending,
    isSavingFields: updateFieldsMutation.isPending,

    // Invalidation manuelle
    invalidateAll,
  };
}
