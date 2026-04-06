/**
 * useCertificatEntretien.js - Majord'home Artisan
 * ============================================================================
 * Hooks TanStack React Query pour la gestion des certificats multi-équipements.
 *
 * - useCertificatChildren(parentId) → liste des interventions enfants
 * - useCertificatEntretienMutations() → mutations enfants + clôture parent
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { savService } from '@services/sav.service';
import { entretienSavKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK : LISTE ENFANTS
// ============================================================================

/**
 * Charge les interventions enfants d'un parent (1 par équipement)
 * @param {string} parentId - ID de l'intervention parent
 */
export function useCertificatChildren(parentId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: entretienSavKeys.children(parentId),
    queryFn: async () => {
      const { data, error } = await savService.getChildInterventions(parentId);
      if (error) throw error;
      return data;
    },
    enabled: !!parentId,
    staleTime: 15_000,
  });

  return {
    children: data || [],
    isLoading,
    error,
    refetch,
  };
}

// ============================================================================
// HOOK : MUTATIONS
// ============================================================================

export function useCertificatEntretienMutations() {
  const queryClient = useQueryClient();

  const invalidateAll = (parentId) => {
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.children(parentId) });
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.all });
  };

  // Créer les enfants (1 par équipement)
  const createChildrenMutation = useMutation({
    mutationFn: ({ parentId, equipments, ctx }) =>
      savService.createChildInterventions(parentId, equipments, ctx),
    onSuccess: (result, { parentId }) => {
      if (!result.error) {
        invalidateAll(parentId);
      }
    },
    onError: (err) => {
      console.error('[useCertificatEntretien] createChildren error:', err);
      toast.error('Erreur lors de la création des certificats');
    },
  });

  // Marquer NÉANT
  const markNeantMutation = useMutation({
    mutationFn: ({ childId }) => savService.markChildNeant(childId),
    onSuccess: (result, { parentId }) => {
      if (!result.error) {
        invalidateAll(parentId);
      }
    },
    onError: () => toast.error('Erreur lors du marquage néant'),
  });

  // Annuler NÉANT
  const unmarkNeantMutation = useMutation({
    mutationFn: ({ childId }) => savService.unmarkChildNeant(childId),
    onSuccess: (result, { parentId }) => {
      if (!result.error) {
        invalidateAll(parentId);
      }
    },
    onError: () => toast.error('Erreur lors de l\'annulation néant'),
  });

  // Clôturer le parent
  const completeParentMutation = useMutation({
    mutationFn: ({ parentId, orgId, reportNotes }) =>
      savService.completeParentEntretien(parentId, orgId, reportNotes),
    onSuccess: (result) => {
      if (result.error) {
        toast.error('Erreur lors de la clôture');
      } else if (result.data?.allDone) {
        toast.success('Entretien clôturé — visite enregistrée');
        queryClient.invalidateQueries({ queryKey: entretienSavKeys.all });
      }
    },
    onError: () => toast.error('Erreur lors de la clôture'),
  });

  return {
    createChildren: (parentId, equipments, ctx) =>
      createChildrenMutation.mutateAsync({ parentId, equipments, ctx }),
    markNeant: (childId, parentId) =>
      markNeantMutation.mutateAsync({ childId, parentId }),
    unmarkNeant: (childId, parentId) =>
      unmarkNeantMutation.mutateAsync({ childId, parentId }),
    completeParent: (parentId, orgId, reportNotes) =>
      completeParentMutation.mutateAsync({ parentId, orgId, reportNotes }),
    isCreating: createChildrenMutation.isPending,
    isCompleting: completeParentMutation.isPending,
  };
}
