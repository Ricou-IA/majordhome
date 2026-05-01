/**
 * useChantierReceptions.js — Majord'home Artisan
 * ============================================================================
 * Hook React Query pour les réceptions ligne par ligne d'un chantier.
 *
 * - useChantierReceptions(chantierId) : liste + mutations (create, delete, recompute)
 *
 * Toute mutation invalide aussi le cache `chantierKeys.all` car le statut
 * chantier peut basculer (commande_a_faire ↔ commande_recue).
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chantierReceptionsService } from '@services/chantierReceptions.service';
import { chantierReceptionKeys, chantierKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { chantierReceptionKeys } from '@hooks/cacheKeys';

export function useChantierReceptions(chantierId) {
  const queryClient = useQueryClient();

  const {
    data: receptions,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: chantierReceptionKeys.byChantier(chantierId),
    queryFn: async () => {
      const { data, error } = await chantierReceptionsService.getByChantier(chantierId);
      if (error) throw error;
      return data;
    },
    enabled: !!chantierId,
    staleTime: 15_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: chantierReceptionKeys.byChantier(chantierId) });
    queryClient.invalidateQueries({ queryKey: chantierKeys.all });
  }, [queryClient, chantierId]);

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await chantierReceptionsService.create(payload);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (receptionId) => {
      const { data, error } = await chantierReceptionsService.delete(receptionId);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const recomputeMutation = useMutation({
    mutationFn: async (expectedLines) => {
      const { data, error } = await chantierReceptionsService.recomputeStatus(chantierId, expectedLines);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  return {
    receptions: receptions || [],
    isLoading,
    error,
    refresh: refetch,

    createReception: useCallback(
      (payload) => createMutation.mutateAsync(payload),
      [createMutation]
    ),
    deleteReception: useCallback(
      (receptionId) => deleteMutation.mutateAsync(receptionId),
      [deleteMutation]
    ),
    recomputeStatus: useCallback(
      (expectedLines) => recomputeMutation.mutateAsync(expectedLines),
      [recomputeMutation]
    ),

    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isRecomputing: recomputeMutation.isPending,
  };
}
