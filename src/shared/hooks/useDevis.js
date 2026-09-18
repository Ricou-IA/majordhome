/**
 * useDevis.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour la gestion des devis (quotes).
 *
 * Contrat unique des mutations : `mutateAsync` résout avec la donnée et REJETTE
 * sur refus (unwrapResult) — l'appelant fait try/catch + toast, jamais de
 * lecture de { error }.
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { devisService } from '@services/devis.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { devisKeys, leadKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';

// Re-export for backward compatibility
export { devisKeys } from '@hooks/cacheKeys';

// ============================================================================
// LECTURE
// ============================================================================

/**
 * Devis liés à un lead
 */
export function useDevisByLead(leadId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data: quotes,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: devisKeys.byLead(orgId, leadId),
    queryFn: async () => {
      const { data, error } = await devisService.getQuotesByLead(leadId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!leadId,
    staleTime: 30_000,
  });

  return { quotes: quotes || [], isLoading, error, refetch };
}

/**
 * Devis liés à un client
 */
export function useDevisByClient(clientId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data: quotes,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: devisKeys.byClient(orgId, clientId),
    queryFn: async () => {
      const { data, error } = await devisService.getQuotesByClient(clientId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!clientId,
    staleTime: 30_000,
  });

  return { quotes: quotes || [], isLoading, error, refetch };
}

/**
 * Détail d'un devis (header)
 */
export function useDevisDetail(quoteId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data: quote,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: devisKeys.detail(orgId, quoteId),
    queryFn: async () => {
      const { data, error } = await devisService.getQuoteById(quoteId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!quoteId,
    staleTime: 30_000,
  });

  return { quote, isLoading, error, refetch };
}

/**
 * Lignes d'un devis
 */
export function useDevisLines(quoteId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data: lines,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: devisKeys.lines(orgId, quoteId),
    queryFn: async () => {
      const { data, error } = await devisService.getQuoteLines(quoteId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!quoteId,
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
  const { organization } = useAuth();
  const orgId = organization?.id;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: devisKeys.all(orgId) });
    if (leadId) {
      queryClient.invalidateQueries({ queryKey: devisKeys.byLead(orgId, leadId) });
      queryClient.invalidateQueries({ queryKey: leadKeys.detail(orgId, leadId) });
    }
  };

  // Créer un devis
  const createMutation = useMutation({
    mutationFn: (data) => unwrapResult(devisService.createQuote(data)),
    onSuccess: invalidateAll,
  });

  // Mettre à jour un devis
  const updateMutation = useMutation({
    mutationFn: ({ quoteId, updates }) => unwrapResult(devisService.updateQuote(quoteId, updates)),
    onSuccess: (_, { quoteId }) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(orgId, quoteId) });
      invalidateAll();
    },
  });

  // Mettre à jour les lignes
  const upsertLinesMutation = useMutation({
    mutationFn: ({ quoteId, lines, globalDiscountPercent }) =>
      unwrapResult(devisService.upsertQuoteLines(quoteId, lines, globalDiscountPercent)),
    onSuccess: (_, { quoteId }) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.lines(orgId, quoteId) });
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(orgId, quoteId) });
      invalidateAll();
    },
  });

  // Supprimer un devis
  const deleteMutation = useMutation({
    mutationFn: (quoteId) => unwrapResult(devisService.deleteQuote(quoteId)),
    onSuccess: invalidateAll,
  });

  // Envoyer
  const sendMutation = useMutation({
    mutationFn: (quoteId) => unwrapResult(devisService.sendQuote(quoteId)),
    onSuccess: (_, quoteId) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(orgId, quoteId) });
      invalidateAll();
    },
  });

  // Accepter
  const acceptMutation = useMutation({
    mutationFn: (quoteId) => unwrapResult(devisService.acceptQuote(quoteId)),
    onSuccess: (_, quoteId) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(orgId, quoteId) });
      invalidateAll();
    },
  });

  // Refuser
  const refuseMutation = useMutation({
    mutationFn: (quoteId) => unwrapResult(devisService.refuseQuote(quoteId)),
    onSuccess: (_, quoteId) => {
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(orgId, quoteId) });
      invalidateAll();
    },
  });

  // Dupliquer
  const duplicateMutation = useMutation({
    mutationFn: ({ quoteId, orgId }) => unwrapResult(devisService.duplicateQuote(quoteId, orgId)),
    onSuccess: invalidateAll,
  });

  return {
    createQuote: createMutation.mutateAsync,
    updateQuote: useCallback((quoteId, updates) => updateMutation.mutateAsync({ quoteId, updates }), [updateMutation]),
    upsertLines: useCallback((quoteId, lines, globalDiscountPercent) => upsertLinesMutation.mutateAsync({ quoteId, lines, globalDiscountPercent }), [upsertLinesMutation]),
    deleteQuote: deleteMutation.mutateAsync,
    sendQuote: sendMutation.mutateAsync,
    acceptQuote: acceptMutation.mutateAsync,
    refuseQuote: refuseMutation.mutateAsync,
    duplicateQuote: useCallback((quoteId, orgId) => duplicateMutation.mutateAsync({ quoteId, orgId }), [duplicateMutation]),
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isSending: sendMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
