/**
 * usePennylane.js — Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour l'intégration Pennylane.
 * - usePennylaneSync : état sync d'un devis + push
 * - useLedgerAccounts : comptes comptables disponibles
 * - usePennylaneInvoices : factures Pennylane d'un client
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pennylaneService } from '@services/pennylane.service';
import { pennylaneKeys, devisKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { pennylaneKeys } from '@hooks/cacheKeys';

// ============================================================================
// SYNC DEVIS
// ============================================================================

/**
 * Hook pour gérer la synchronisation Pennylane d'un devis.
 *
 * @param {string} quoteId — ID du devis Majordhome
 * @param {string} orgId — org_id core
 * @returns {{ syncRecord, isLoading, isPushing, pushQuote, syncStatus, pennylaneUrl }}
 */
export function usePennylaneSync(quoteId, orgId) {
  const queryClient = useQueryClient();

  // Query : état sync du devis
  const {
    data: syncRecord,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: pennylaneKeys.sync('quote', quoteId),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getSyncRecord(orgId, 'quote', quoteId);
      if (error) throw error;
      return data;
    },
    enabled: !!quoteId && !!orgId,
    staleTime: 60_000,
  });

  // Mutation : push devis vers Pennylane
  const pushMutation = useMutation({
    mutationFn: async ({ quote, lines, client }) => {
      const { data, error } = await pennylaneService.pushQuote(quote, lines, client, orgId);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.sync('quote', quoteId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.all });
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(quoteId) });
    },
  });

  return {
    syncRecord,
    isLoading,
    isPushing: pushMutation.isPending,
    pushError: pushMutation.error,
    pushQuote: useCallback(
      async (quote, lines, client) => pushMutation.mutateAsync({ quote, lines, client }),
      [pushMutation]
    ),
    refreshSync: refetch,
    syncStatus: syncRecord?.sync_status || null,
    pennylaneUrl: syncRecord?.metadata?.public_url || null,
    pennylaneNumber: syncRecord?.pennylane_number || null,
  };
}

// ============================================================================
// COMPTES COMPTABLES (LEDGER ACCOUNTS)
// ============================================================================

/**
 * Hook pour charger les comptes comptables Pennylane (706xxx).
 * Résultat mis en cache longue durée (les comptes changent rarement).
 */
export function useLedgerAccounts() {
  const {
    data: accounts,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: pennylaneKeys.ledgerAccounts(),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getLedgerAccounts();
      if (error) throw error;
      return data;
    },
    staleTime: 24 * 60 * 60_000, // 24h — les comptes comptables bougent rarement
  });

  return { accounts: accounts || [], isLoading, error, refetch };
}

// ============================================================================
// FACTURES PAR CLIENT
// ============================================================================

/**
 * Hook pour récupérer les factures Pennylane liées à un client.
 *
 * @param {string} clientId
 * @param {string} orgId
 */
export function usePennylaneInvoices(clientId, orgId) {
  const {
    data: invoices,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: pennylaneKeys.invoicesByClient(clientId),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getInvoicesByClient(clientId, orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && !!orgId,
    staleTime: 5 * 60_000, // 5 min
  });

  return { invoices: invoices || [], isLoading, error, refetch };
}

// ============================================================================
// DEVIS PL PAR CLIENT
// ============================================================================

/**
 * Hook pour récupérer les devis Pennylane d'un client (fetch live via proxy).
 *
 * @param {string} clientId
 * @param {string} orgId
 */
export function usePennylaneQuotes(clientId, orgId) {
  const {
    data: quotes,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: pennylaneKeys.quotesByClient(clientId),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getQuotesByClient(clientId, orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && !!orgId,
    staleTime: 5 * 60_000, // 5 min
  });

  return { quotes: quotes || [], isLoading, error, refetch };
}

// ============================================================================
// LIGNES D'UN DEVIS PL
// ============================================================================

/**
 * Hook pour récupérer les lignes d'un devis Pennylane (par pennylane_id du devis).
 * Retourne { quote, sections, lines } — voir pennylane.service.getQuoteLines.
 *
 * @param {number|string|null} pennylaneQuoteId
 */
export function usePennylaneQuoteLines(pennylaneQuoteId) {
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: pennylaneKeys.quoteLines(pennylaneQuoteId),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getQuoteLines(pennylaneQuoteId);
      if (error) throw error;
      return data;
    },
    enabled: !!pennylaneQuoteId,
    // Lignes d'un devis signé = quasi-immuables. Cache long pour éviter les
    // refetch inutiles quand on enchaîne les réceptions sur plusieurs chantiers.
    staleTime: 60 * 60_000,  // 1h : pas de refetch pendant ce délai
    gcTime: 60 * 60_000,     // 1h : garde en cache même après unmount du composant
  });

  return {
    quote: data?.quote || null,
    sections: data?.sections || [],
    lines: data?.lines || [],
    isLoading,
    error,
    refetch,
  };
}

// ============================================================================
// SYNC CLIENT (mutation ponctuelle)
// ============================================================================

/**
 * Hook mutation pour synchro manuelle d'un client vers Pennylane.
 */
export function usePennylaneSyncClient(orgId) {
  const queryClient = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: async (client) => {
      const { data, error } = await pennylaneService.syncClient(client, orgId);
      if (error) throw error;
      return data;
    },
    onSuccess: (_, client) => {
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.syncByClient(client.id) });
    },
  });

  return {
    syncClient: useCallback(
      async (client) => syncMutation.mutateAsync(client),
      [syncMutation]
    ),
    isSyncing: syncMutation.isPending,
    syncError: syncMutation.error,
  };
}
