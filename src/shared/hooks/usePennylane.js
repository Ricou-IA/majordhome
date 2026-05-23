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
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { pennylaneService } from '@services/pennylane.service';
import { pennylaneKeys, devisKeys, leadKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';

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
    queryKey: pennylaneKeys.sync(orgId, 'quote', quoteId),
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
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.sync(orgId, 'quote', quoteId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: devisKeys.detail(orgId, quoteId) });
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
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data: accounts,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: pennylaneKeys.ledgerAccounts(orgId),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getLedgerAccounts();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
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
    queryKey: pennylaneKeys.invoicesByClient(orgId, clientId),
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
    queryKey: pennylaneKeys.quotesByClient(orgId, clientId),
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
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: pennylaneKeys.quoteLines(orgId, pennylaneQuoteId),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getQuoteLines(pennylaneQuoteId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!pennylaneQuoteId,
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
// LIGNES DE PLUSIEURS DEVIS PL (multi-devis par chantier)
// ============================================================================

/**
 * Hook pour charger en parallèle les lignes de N devis Pennylane.
 * Utilise useQueries → réutilise le cache de usePennylaneQuoteLines (même queryKey).
 *
 * @param {Array<number|string>} pennylaneQuoteIds
 * @returns {{
 *   resultsById: Record<id, { quote, lines, sections, isLoading, error }>,
 *   isLoading: boolean,
 *   isError: boolean,
 *   allLines: Array — concat de toutes les lignes (utile pour recompute statut)
 * }}
 */
export function useMultiplePennylaneQuoteLines(pennylaneQuoteIds) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const ids = Array.isArray(pennylaneQuoteIds) ? pennylaneQuoteIds.filter(Boolean) : [];

  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: pennylaneKeys.quoteLines(orgId, id),
      queryFn: async () => {
        const { data, error } = await pennylaneService.getQuoteLines(id);
        if (error) throw error;
        return data;
      },
      enabled: !!orgId && !!id,
      staleTime: 60 * 60_000,
      gcTime: 60 * 60_000,
    })),
  });

  const resultsById = {};
  let isLoading = false;
  let isError = false;
  const allLines = [];

  ids.forEach((id, idx) => {
    const q = queries[idx];
    const data = q?.data;
    resultsById[id] = {
      quote: data?.quote || null,
      sections: data?.sections || [],
      lines: data?.lines || [],
      isLoading: q?.isLoading || false,
      error: q?.error || null,
    };
    if (q?.isLoading) isLoading = true;
    if (q?.isError) isError = true;
    if (data?.lines?.length) {
      allLines.push(...data.lines.map((l) => ({ ...l, _quote_pl_id: id })));
    }
  });

  return { resultsById, isLoading, isError, allLines };
}

// ============================================================================
// LIAISON LEAD ↔ DEVIS PL (multi-devis par chantier)
// ============================================================================

/**
 * Liste des devis Pennylane liés à un lead (chantier), actifs uniquement.
 * Source : vue majordhome_lead_pennylane_quotes (filtre ejected_at IS NULL côté service).
 */
export function useLinkedPennylaneQuotes(leadId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data: linkedQuotes,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: pennylaneKeys.linkedQuotesByLead(orgId, leadId),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getLinkedQuotesByLead(leadId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!leadId,
    staleTime: 30_000,
  });

  return { linkedQuotes: linkedQuotes || [], isLoading, error, refetch };
}

/**
 * Mutations attach/eject d'un devis Pennylane sur un lead.
 * Invalide la liste des devis liés ET le statut chantier (la cascade côté UI).
 */
export function useLinkedPennylaneQuotesMutations(orgId, leadId) {
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: pennylaneKeys.linkedQuotesByLead(orgId, leadId) });
    queryClient.invalidateQueries({ queryKey: ['chantiers'] });
    // La RPC peut basculer le lead en "Devis envoyé" + créer une lead_activity
    // → invalider tout le sous-arbre leadKeys (liste Kanban + détail + activities)
    queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
  }, [queryClient, leadId, orgId]);

  const assignMutation = useMutation({
    mutationFn: async ({ pennylaneQuoteId, quoteData }) => {
      const { data, error } = await pennylaneService.assignQuoteToLead(
        orgId,
        pennylaneQuoteId,
        leadId,
        quoteData
      );
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const ejectMutation = useMutation({
    mutationFn: async ({ pennylaneQuoteId, reason }) => {
      const { data, error } = await pennylaneService.ejectQuoteFromLead(
        orgId,
        pennylaneQuoteId,
        reason
      );
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  return {
    assignQuote: useCallback(
      (pennylaneQuoteId, quoteData) =>
        assignMutation.mutateAsync({ pennylaneQuoteId, quoteData }),
      [assignMutation]
    ),
    ejectQuote: useCallback(
      (pennylaneQuoteId, reason) =>
        ejectMutation.mutateAsync({ pennylaneQuoteId, reason }),
      [ejectMutation]
    ),
    isAssigning: assignMutation.isPending,
    isEjecting: ejectMutation.isPending,
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
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.syncByClient(orgId, client.id) });
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
