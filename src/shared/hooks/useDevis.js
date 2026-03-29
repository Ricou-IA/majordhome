/**
 * useDevis.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour la gestion des devis (quotes).
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { devisService } from '@services/devis.service';
import { devisKeys, leadKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { devisKeys } from '@hooks/cacheKeys';

// ============================================================================
// LECTURE
// ============================================================================

/**
 * Devis liés à un lead
 */
export function useDevisByLead(leadId) {
  const {
    data: quotes,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: devisKeys.byLead(leadId),
    queryFn: async () => {
      const { data, error } = await devisService.getQuotesByLead(leadId);
      if (error) throw error;
      return data;
    },
    enabled: !!leadId,
    staleTime: 30_000,
  });

  return { quotes: quotes || [], isLoading, error, refetch };
}

/**
 * Devis liés à un client
 */
export function useDevisByClient(clientId) {
  const {
    data: quotes,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: devisKeys.byClient(clientId),
    queryFn: async () => {
      const { data, error } = await devisService.getQuotesByClient(clientId);
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
    staleTime: 30_000,
  });

  return { quotes: quotes || [], isLoading, error, refetch };
}

/**
 * Détail d'un devis (header)
 */
export function useDevisDetail(quoteId) {
  const {
    data: quote,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: devisKeys.detail(quoteId),
    queryFn: async () => {
      const { data, error } = await devisService.getQuoteById(quoteId);
      if (error) throw error;
      return data;
    },
    enabled: !!quoteId,
    staleTime: 30_000,
  });

  return { quote, isLoading, error, refetch };
}

/**
 * Lignes d'un devis
 */
export function useDevisLines(quoteId) {
  const {
    data: lines,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: devisKeys.lines(quoteId),
    queryFn: async () => {
      const { data, error } = await devisService.getQuoteLines(quoteId);
      if (error) throw error;
      return data;
    },
    enabled: !!quoteId,
    staleTime: 30_000,
  });

  return { lines: lines || [], isLoading, error, refetch };
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Mutations CRUD devis + transitions statut
 */
export function useDevisMutations(leadId) {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: devisKeys.all });
    if (leadId) {
      queryClient.invalidateQueries({ queryKey: devisKeys.byLead(leadId) });
      queryClient.invalidateQueries({ queryKey: leadKeys.detail(leadId) });
    }
  };

  // Créer un devis
  const createMutation = useMutation({
    mutationFn: (data) => devisService.createQuote(data),
    onSuccess: invalidateAll,
  });

  // Mettre à jour un devis
  const updateMutation = useMutation({
    mutationFn: ({ quoteId, updates }) => devisService.updateQuote(quoteId, updates),
    onSuccess: (_, { quoteId }) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(quoteId) });
      invalidateAll();
    },
  });

  // Mettre à jour les lignes
  const upsertLinesMutation = useMutation({
    mutationFn: ({ quoteId, lines, globalDiscountPercent }) =>
      devisService.upsertQuoteLines(quoteId, lines, globalDiscountPercent),
    onSuccess: (_, { quoteId }) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.lines(quoteId) });
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(quoteId) });
      invalidateAll();
    },
  });

  // Supprimer un devis
  const deleteMutation = useMutation({
    mutationFn: (quoteId) => devisService.deleteQuote(quoteId),
    onSuccess: invalidateAll,
  });

  // Envoyer
  const sendMutation = useMutation({
    mutationFn: (quoteId) => devisService.sendQuote(quoteId),
    onSuccess: (_, quoteId) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(quoteId) });
      invalidateAll();
    },
  });

  // Accepter
  const acceptMutation = useMutation({
    mutationFn: (quoteId) => devisService.acceptQuote(quoteId),
    onSuccess: (_, quoteId) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(quoteId) });
      invalidateAll();
    },
  });

  // Refuser
  const refuseMutation = useMutation({
    mutationFn: (quoteId) => devisService.refuseQuote(quoteId),
    onSuccess: (_, quoteId) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(quoteId) });
      invalidateAll();
    },
  });

  // Dupliquer
  const duplicateMutation = useMutation({
    mutationFn: ({ quoteId, orgId }) => devisService.duplicateQuote(quoteId, orgId),
    onSuccess: invalidateAll,
  });

  return {
    createQuote: useCallback(async (data) => createMutation.mutateAsync(data), [createMutation]),
    updateQuote: useCallback(async (quoteId, updates) => updateMutation.mutateAsync({ quoteId, updates }), [updateMutation]),
    upsertLines: useCallback(async (quoteId, lines, globalDiscountPercent) => upsertLinesMutation.mutateAsync({ quoteId, lines, globalDiscountPercent }), [upsertLinesMutation]),
    deleteQuote: useCallback(async (quoteId) => deleteMutation.mutateAsync(quoteId), [deleteMutation]),
    sendQuote: useCallback(async (quoteId) => sendMutation.mutateAsync(quoteId), [sendMutation]),
    acceptQuote: useCallback(async (quoteId) => acceptMutation.mutateAsync(quoteId), [acceptMutation]),
    refuseQuote: useCallback(async (quoteId) => refuseMutation.mutateAsync(quoteId), [refuseMutation]),
    duplicateQuote: useCallback(async (quoteId, orgId) => duplicateMutation.mutateAsync({ quoteId, orgId }), [duplicateMutation]),
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isSending: sendMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
