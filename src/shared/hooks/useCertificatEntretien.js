/**
 * useCertificatEntretien.js - Majord'home Artisan
 * ============================================================================
 * Hooks TanStack React Query pour la gestion des certificats multi-équipements.
 *
 * - useCertificatChildren(parentId) → liste des interventions enfants
 * - useCertificatEntretienMutations() → mutations enfants + clôture parent
 *
 * @version 1.0.0
 * @version 1.1.0 - Contrat unique des mutations : mutateAsync résout avec la
 *   donnée et REJETTE sur refus (unwrapResult). Les toasts d'erreur vivent dans
 *   `onError` (qui ne se déclenchait jamais tant que le service ne throwait pas).
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { savService } from '@services/sav.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { entretienSavKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';

// ============================================================================
// HOOK : LISTE ENFANTS
// ============================================================================

/**
 * Charge les interventions enfants d'un parent (1 par équipement)
 * @param {string} parentId - ID de l'intervention parent
 */
export function useCertificatChildren(parentId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: entretienSavKeys.children(orgId, parentId),
    queryFn: async () => {
      const { data, error } = await savService.getChildInterventions(parentId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!parentId,
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
  const { organization } = useAuth();
  const orgId = organization?.id;

  const invalidateAll = (parentId) => {
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.children(orgId, parentId) });
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
  };

  // Créer les enfants (1 par équipement)
  const createChildrenMutation = useMutation({
    mutationFn: ({ parentId, equipments, ctx }) =>
      unwrapResult(savService.createChildInterventions(parentId, equipments, ctx)),
    onSuccess: (_children, { parentId }) => invalidateAll(parentId),
    onError: (err) => {
      console.error('[useCertificatEntretien] createChildren error:', err);
      toast.error('Erreur lors de la création des certificats');
    },
  });

  // Marquer NÉANT
  const markNeantMutation = useMutation({
    mutationFn: ({ childId }) => unwrapResult(savService.markChildNeant(childId)),
    onSuccess: (_child, { parentId }) => invalidateAll(parentId),
    onError: () => toast.error('Erreur lors du marquage néant'),
  });

  // Annuler NÉANT
  const unmarkNeantMutation = useMutation({
    mutationFn: ({ childId }) => unwrapResult(savService.unmarkChildNeant(childId)),
    onSuccess: (_child, { parentId }) => invalidateAll(parentId),
    onError: () => toast.error('Erreur lors de l\'annulation néant'),
  });

  // Clôturer le parent
  // Résout avec { allDone } : false = il reste des enfants à traiter, rien à annoncer
  const completeParentMutation = useMutation({
    mutationFn: ({ parentId, orgId: completeOrgId, reportNotes }) =>
      unwrapResult(savService.completeParentEntretien(parentId, completeOrgId, reportNotes)),
    onSuccess: (result) => {
      if (result?.allDone) {
        toast.success('Entretien clôturé — visite enregistrée');
        queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
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
