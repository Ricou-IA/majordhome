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
import { chantierKeys, appointmentKeys, pennylaneKeys, leadKeys, kanbanCardKeys } from '@hooks/cacheKeys';
import { unwrapResult } from '@/lib/serviceHelpers';
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
  // Grouper / détacher / supprimer déplacent devis et RDV : invalidation croisée.
  const invalidateCroisee = useCallback(() => {
    invalidateChantiers();
    queryClient.invalidateQueries({ queryKey: appointmentKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: pennylaneKeys.linkedQuotes(orgId) });
    queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
  }, [invalidateChantiers, queryClient, orgId]);

  // Mutation : changer le statut chantier
  const statusMutation = useMutation({
    mutationFn: ({ chantierId, newStatus }) =>
      unwrapResult(chantiersService.updateChantierStatus(orgId, chantierId, newStatus)),
    onSuccess: invalidateChantiers,
  });

  // Mutation : mettre à jour les commandes (équipement + matériaux).
  // Exception au contrat unwrapResult : garde le retour composite
  // { data, error, autoTransitioned }, lu tel quel par ChantierReceptionSection.
  // Déballage à la main : le service porte `autoTransitioned` / `newChantierStatus`
  // hors `data` (contrat des mutations, cf. CLAUDE.md → Hooks). Rejette sur { error }.
  const orderMutation = useMutation({
    mutationFn: async ({ chantierId, ...params }) => {
      const { data, error, autoTransitioned, newChantierStatus } =
        await chantiersService.updateOrderStatus(orgId, chantierId, params);
      if (error) throw error;
      return { chantier: data, autoTransitioned, newChantierStatus };
    },
    onSuccess: invalidateChantiers,
  });

  // Mutation : notes
  const notesMutation = useMutation({
    mutationFn: ({ chantierId, notes }) =>
      unwrapResult(chantiersService.updateChantierNotes(orgId, chantierId, notes)),
    onSuccess: invalidateChantiers,
  });

  // Mutation : intitulé du chantier
  const labelMutation = useMutation({
    mutationFn: ({ chantierId, label }) =>
      unwrapResult(chantiersService.updateLabel(orgId, chantierId, label)),
    onSuccess: invalidateChantiers,
  });

  // Mutation : commande « personnes × jours » (spec 2026-09-21)
  const plannedOrderMutation = useMutation({
    mutationFn: ({ chantierId, teamSize, days }) =>
      unwrapResult(chantiersService.updatePlannedOrder(orgId, chantierId, { teamSize, days })),
    onSuccess: invalidateChantiers,
  });

  // Mutation : upload PV de réception
  const pvMutation = useMutation({
    mutationFn: ({ chantierId, file }) =>
      unwrapResult(chantiersService.uploadPvReception(orgId, chantierId, file)),
    onSuccess: invalidateChantiers,
  });

  // Gestes (RPC) : regrouper, détacher, supprimer un chantier
  const groupMutation = useMutation({
    mutationFn: ({ targetId, sourceIds }) =>
      unwrapResult(chantiersService.groupChantiers(targetId, sourceIds)),
    onSuccess: invalidateCroisee,
  });

  const detachMutation = useMutation({
    mutationFn: (params) => unwrapResult(chantiersService.detachChantier(params)),
    onSuccess: invalidateCroisee,
  });

  const deleteMutation = useMutation({
    mutationFn: (chantierId) => unwrapResult(chantiersService.deleteChantier(chantierId)),
    onSuccess: invalidateCroisee,
  });

  return {
    updateChantierStatus: useCallback(
      (chantierId, newStatus) => statusMutation.mutateAsync({ chantierId, newStatus }),
      [statusMutation]
    ),
    updateOrderStatus: useCallback(
      (chantierId, params) => orderMutation.mutateAsync({ chantierId, ...params }),
      [orderMutation]
    ),
    updateChantierNotes: useCallback(
      (chantierId, notes) => notesMutation.mutateAsync({ chantierId, notes }),
      [notesMutation]
    ),
    updateLabel: useCallback(
      (chantierId, label) => labelMutation.mutateAsync({ chantierId, label }),
      [labelMutation]
    ),
    uploadPvReception: useCallback(
      (chantierId, file) => pvMutation.mutateAsync({ chantierId, file }),
      [pvMutation]
    ),
    updatePlannedOrder: useCallback(
      (chantierId, { teamSize, days }) => plannedOrderMutation.mutateAsync({ chantierId, teamSize, days }),
      [plannedOrderMutation]
    ),
    groupChantiers: useCallback(
      (targetId, sourceIds) => groupMutation.mutateAsync({ targetId, sourceIds }),
      [groupMutation]
    ),
    detachChantier: useCallback(
      (params) => detachMutation.mutateAsync(params),
      [detachMutation]
    ),
    deleteChantier: useCallback(
      (chantierId) => deleteMutation.mutateAsync(chantierId),
      [deleteMutation]
    ),

    // États
    isUpdatingStatus: statusMutation.isPending,
    isUpdatingOrder: orderMutation.isPending,
    isUploadingPv: pvMutation.isPending,
    isGrouping: groupMutation.isPending,
    isDetaching: detachMutation.isPending,
    isDeleting: deleteMutation.isPending,

    invalidate: invalidateChantiers,
  };
}
