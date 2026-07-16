/**
 * usePennylane.js — Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour l'intégration Pennylane.
 * - usePennylaneSync : état sync d'un devis + push
 * - useLedgerAccounts : comptes comptables disponibles
 * - usePennylaneInvoices : factures Pennylane d'un client
 * ============================================================================
 */

import { useCallback, useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { pennylaneService } from '@services/pennylane.service';
import { leadsService } from '@services/leads.service';
import { pennylaneKeys, devisKeys, leadKeys, clientKeys, kanbanCardKeys } from '@hooks/cacheKeys';
import { useDebounce } from '@hooks/useDebounce';
import { useAuth } from '@contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { cleanPhone } from '@/lib/phoneUtils';

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
 * Retourne un prefetch (memoized) pour précharger les devis PL liés à un lead.
 * À appeler sur onMouseEnter d'une carte Kanban pour rendre l'expand instant.
 * No-op si leadId absent ou si la donnée est déjà fraîche en cache (staleTime géré).
 */
export function usePrefetchLinkedPennylaneQuotes() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  return useCallback(
    (leadId) => {
      if (!orgId || !leadId) return;
      queryClient.prefetchQuery({
        queryKey: pennylaneKeys.linkedQuotesByLead(orgId, leadId),
        queryFn: async () => {
          const { data, error } = await pennylaneService.getLinkedQuotesByLead(leadId);
          if (error) throw error;
          return data;
        },
        staleTime: 30_000,
      });
    },
    [queryClient, orgId],
  );
}

/**
 * Mutation d'éjection d'un devis Pennylane rattaché à un lead.
 * Invalide la liste des devis liés ET le statut chantier (la cascade côté UI).
 * Le pendant attach n'existe plus côté front (le rattachement se fait dans le
 * pipeline) : seules les edge functions appellent encore la RPC d'attache.
 */
export function useLinkedPennylaneQuotesMutations(orgId, leadId) {
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: pennylaneKeys.linkedQuotesByLead(orgId, leadId) });
    queryClient.invalidateQueries({ queryKey: ['chantiers'] });
    // La RPC peut basculer le lead en "Devis envoyé" + créer une lead_activity
    // → invalider tout le sous-arbre leadKeys (liste Kanban + détail + activities)
    queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    // Vue kanban_cards recalculée — placement et compteurs colonnes
    queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
  }, [queryClient, leadId, orgId]);

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
    ejectQuote: useCallback(
      (pennylaneQuoteId, reason) =>
        ejectMutation.mutateAsync({ pennylaneQuoteId, reason }),
      [ejectMutation]
    ),
    isEjecting: ejectMutation.isPending,
  };
}

// ============================================================================
// BRIDGE PIPELINE ↔ PENNYLANE (spec 2026-05-23 PR 4+)
// ============================================================================

/**
 * Devis PL candidats à un lead via fuzzy match (bridge fort + email + phone).
 * Consommé par QuoteCandidatesModal (PR 4b) pour la section "Suggestions".
 *
 * @param {string} leadId
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]
 * @returns {{ candidates, isLoading, error, refetch }}
 *   candidates : Array<{ quote, signals: string[], alreadyAttached: boolean }>
 */
export function useCandidateQuotesForLead(leadId, { enabled = true } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const query = useQuery({
    queryKey: pennylaneKeys.candidatesByLead(orgId, leadId),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getCandidateQuotesForLead(leadId, orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!leadId && enabled,
    // 2 min — devis PL créés en cours de session restent invalidables via
    // invalidateQueries(candidatesByLead) après attach
    staleTime: 2 * 60_000,
  });

  return {
    candidates: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Devis PL des N derniers jours sans rattachement actif (liste exploratoire).
 * Consommé par QuoteCandidatesModal (PR 4b) section "Explorer" + bonus
 * voyant détail (PR 8).
 *
 * @param {object} [opts]
 * @param {number} [opts.sinceDays=60]
 * @param {number} [opts.limit=100]
 * @param {boolean} [opts.enabled=true]
 */
export function useUnlinkedQuotes({ sinceDays = 60, limit = 100, enabled = true } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const query = useQuery({
    queryKey: pennylaneKeys.unlinkedQuotes(orgId, sinceDays),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getUnlinkedQuotes(orgId, { sinceDays, limit });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && enabled,
    // 5 min — les devis PL non rattachés bougent peu, invalidation manuelle
    // via invalidateQueries(unlinkedQuotes) sur attach/eject
    staleTime: 5 * 60_000,
  });

  return {
    unlinkedQuotes: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Compteur "devis PL non rattachés des N derniers jours".
 * Voyant de discipline (Dashboard + Pipeline header, org_admin only).
 * StaleTime long (5 min) — pas besoin de fraîcheur temps réel.
 */
export function useUnlinkedQuoteCount({ sinceDays = 30, enabled = true } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const query = useQuery({
    queryKey: pennylaneKeys.unlinkedQuotesCount(orgId, sinceDays),
    queryFn: async () => {
      const { data, error } = await pennylaneService.countUnlinkedQuotes(orgId, { sinceDays });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && enabled,
    staleTime: 5 * 60_000,
  });

  return {
    count: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Construit un patch lead = champs contact PL à reporter sur le lead.
 * Sémantique OVERWRITE (décision produit 2026-05-27) : une fois qu'un
 * devis PL est attaché, Pennylane est canonique pour l'identité — on
 * écrase MDH avec PL même si MDH avait une valeur. Le bandeau UI
 * "Données synchronisées depuis Pennylane — à modifier dans Pennylane"
 * prévient l'user. Si PL fournit une valeur vide, on ne touche pas
 * MDH (sécurité : NULLIF côté RPC `update_majordhome_lead`).
 *
 * @param {object} lead — lead courant (lu pour signature, non utilisé pour merge)
 * @param {object} customer — payload customer Pennylane V2
 * @returns {object} patch jsonb pour update_majordhome_lead
 */
function buildContactPatchFromCustomer(lead, customer) {
  if (!customer || !lead) return {};
  const patch = {};

  const { firstName, lastName } = pennylaneService.extractCustomerName(customer);
  const email = pennylaneService.extractCustomerEmail(customer);
  const phone = pennylaneService.extractCustomerPhone(customer);
  const { address, postalCode, city } = pennylaneService.extractCustomerAddress(customer);

  if (firstName) patch.first_name = firstName;
  if (lastName) patch.last_name = lastName;
  if (email) patch.email = email;
  if (phone) patch.phone = cleanPhone(phone);
  if (address) patch.address = address;
  if (postalCode) patch.postal_code = postalCode;
  if (city) patch.city = city;

  return patch;
}

/**
 * Post-attach : pré-remplit le contact du lead depuis le customer PL +
 * auto-create/auto-link client MDH si nécessaire.
 *
 * Logique :
 *   1. Lit le lead avec tous les fields contact
 *   2. Récupère le 1er customer_id PL des devis attachés
 *   3. Fetch /customers/{id} pour récupérer les coordonnées complètes
 *   4. Calcule un patch lead (champs vides seulement) → UPDATE
 *   5. Si lead pas encore lié à un client MDH :
 *      a. Cherche un mapping pennylane_sync → link au client existant si trouvé
 *      b. Sinon convertLeadToClient (qui copie les fields du lead — patché à
 *         l'étape 4 — vers le client créé)
 *   6. Pose mapping pennylane_sync + UPDATE lead_pennylane_quotes.pennylane_client_id
 *
 * Fire-and-forget côté caller : un échec n'invalide pas le succès de l'attach.
 *
 * @param {string} orgId
 * @param {string} leadId
 * @param {string} userId
 * @returns {Promise<{ client_id?, created_client?, contact_synced?, skipped? }>}
 */
async function ensureClientForLeadFromPennylane(orgId, leadId, userId) {
  // 1. Lire le lead avec tous les fields contact (élargi vs version précédente)
  // Lecture via la vue publique : le schema `majordhome` n'est PAS exposé via
  // PostgREST -> `.schema('majordhome').from(...)` renvoie 406. La lecture
  // plantait ici, faisant echouer en SILENCE tout le contact-sync post-attach
  // (email/adresse jamais repris depuis Pennylane). cf bug rapproche 2026-06-10.
  const { data: lead, error: leadErr } = await supabase
    .from('majordhome_leads')
    .select('id, client_id, first_name, last_name, email, phone, address, address_complement, postal_code, city')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return { skipped: 'lead_not_found' };

  // 2. Récupérer le 1er customer_id PL des devis attachés actifs
  const { data: links, error: linksErr } = await supabase
    .from('majordhome_lead_pennylane_quotes')
    .select('pennylane_customer_id')
    .eq('lead_id', leadId)
    .is('ejected_at', null)
    .not('pennylane_customer_id', 'is', null)
    .limit(1);
  if (linksErr) throw linksErr;
  const customerId = links?.[0]?.pennylane_customer_id;
  if (!customerId) {
    return lead.client_id
      ? { skipped: 'no_customer_id', client_id: lead.client_id }
      : { skipped: 'no_customer_id' };
  }

  // 3. Fetch customer PL pour pré-remplissage (bug #6) — best-effort, peut être null
  // orgId passé pour write-through cache D.5 (pennylane_customer_lookup)
  const { data: customer } = await pennylaneService.fetchCustomerById(customerId, orgId);
  const leadPatch = buildContactPatchFromCustomer(lead, customer);
  const hasLeadPatch = Object.keys(leadPatch).length > 0;

  // 4. Si lead a déjà un client_id → patch lead seul, pas de convert
  if (lead.client_id) {
    if (hasLeadPatch) {
      await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: { ...leadPatch, updated_at: new Date().toISOString() },
      });
    }
    return { skipped: 'already_linked', client_id: lead.client_id, contact_synced: hasLeadPatch };
  }

  // 5. Cherche un mapping existant dans pennylane_sync
  const { data: syncRow } = await supabase
    .from('majordhome_pennylane_sync')
    .select('local_id')
    .eq('org_id', orgId)
    .eq('entity_type', 'client')
    .eq('pennylane_id', customerId)
    .maybeSingle();

  let clientId = syncRow?.local_id || null;
  let createdClient = false;

  if (clientId) {
    // 5a. Mapping existe : link lead → client existant (+ patch lead s'il y a)
    const updates = { client_id: clientId, updated_at: new Date().toISOString(), ...leadPatch };
    const { error: updateErr } = await supabase.rpc('update_majordhome_lead', {
      p_lead_id: leadId,
      p_updates: updates,
    });
    if (updateErr) throw updateErr;
  } else {
    // 5b. Pas de mapping : appliquer patch lead AVANT convert (convertLeadToClient
    // copie les fields du lead vers le client créé — leads.service.js:730-746)
    if (hasLeadPatch) {
      const { error: patchErr } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: { ...leadPatch, updated_at: new Date().toISOString() },
      });
      if (patchErr) throw patchErr;
    }
    const conv = await leadsService.convertLeadToClient(leadId, orgId, userId);
    if (conv?.error) throw conv.error;
    clientId = conv?.data?.client?.id || null;
    createdClient = !!clientId;
    if (!clientId) return { skipped: 'convert_failed' };
  }

  // 6. Pose le mapping pennylane_sync (upsert idempotent)
  await supabase
    .from('majordhome_pennylane_sync')
    .upsert(
      {
        org_id: orgId,
        entity_type: 'client',
        local_id: clientId,
        pennylane_id: customerId,
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,entity_type,local_id' }
    );

  // 7. Update pennylane_client_id sur les liaisons de ce lead.
  // Via RPC : la vue `majordhome_lead_pennylane_quotes` n'est pas updatable
  // (et `.schema('majordhome')` renvoie 406 — schema non exposé).
  await supabase.rpc('lead_pennylane_quotes_link_client', {
    p_lead_id: leadId,
    p_org_id: orgId,
    p_client_id: clientId,
  });

  return { client_id: clientId, created_client: createdClient, contact_synced: hasLeadPatch };
}

/**
 * Mutation multi-attach + bascule lead → "Devis envoyé" (RPC PR 2).
 * Post-success : auto-create / auto-link client MDH si lead.client_id IS NULL
 * (cf ensureClientForLeadFromPennylane). Fire-and-forget : un échec du
 * post-process n'invalide pas le succès de l'attach principal.
 *
 * Invalide leadKeys (Kanban + détail + activities), linkedQuotes, candidates,
 * unlinked (compteur de discipline) + clientKeys si client créé.
 */
export function useAttachQuotesAndSend(orgId, leadId) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const mutation = useMutation({
    mutationFn: async (quotes) => {
      const { data, error } = await pennylaneService.attachQuotesAndSendLead(orgId, leadId, quotes);
      if (error) throw error;

      // Post-attach : auto-create / link client (fire-and-forget conceptuel,
      // mais on attend la résolution pour avoir l'UI à jour à la fermeture modale)
      let postResult = null;
      try {
        postResult = await ensureClientForLeadFromPennylane(orgId, leadId, userId);
      } catch (e) {

        console.warn('[useAttachQuotesAndSend] ensureClient failed:', e?.message || e);
      }
      return { ...data, _post: postResult };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.linkedQuotesByLead(orgId, leadId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.candidatesByLead(orgId, leadId) });
      queryClient.invalidateQueries({ queryKey: ['pennylane', orgId, 'unlinked-quotes'] });
      queryClient.invalidateQueries({ queryKey: ['pennylane', orgId, 'unlinked-quotes-count'] });
      queryClient.invalidateQueries({ queryKey: ['chantiers'] });
      // Client potentiellement créé → invalider listes clients
      queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
      // Vue kanban_cards recalculée (lead a basculé en Devis envoyé, ou MAJ count)
      queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
    },
  });

  return {
    attachQuotes: useCallback((quotes) => mutation.mutateAsync(quotes), [mutation]),
    isAttaching: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Mutation mark won côté MDH (RPC PR 3).
 * Invalide leadKeys + linkedQuotes + chantiers (chantier_status='gagne').
 */
export function useMarkLeadWonWithQuote(orgId, leadId) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (winningQuotePlId) => {
      const { data, error } = await pennylaneService.markLeadWonWithQuote(orgId, leadId, winningQuotePlId);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.linkedQuotesByLead(orgId, leadId) });
      queryClient.invalidateQueries({ queryKey: ['chantiers'] });
      // Vue kanban_cards recalculée (winning quote modifié → carte Gagné refresh)
      queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
    },
  });

  return {
    markWon: useCallback((winningQuotePlId) => mutation.mutateAsync(winningQuotePlId), [mutation]),
    isMarking: mutation.isPending,
    error: mutation.error,
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

// ============================================================================
// BUG #5 ROGERO — RECHERCHE CUSTOMER PENNYLANE + IMPORT MDH
// ============================================================================

/**
 * Hook de recherche de customers Pennylane (cache D.5 + fallback live PL).
 * API alignée avec `useClientSearch` pour intégration facile dans
 * `SectionClientLinking` (LeadFormSections.jsx).
 *
 * @param {object} [opts]
 * @param {number} [opts.debounceMs=300]
 * @param {number} [opts.minChars=2]
 * @returns {{ query, results, searching, search, clear }}
 *   results : Array<customer> avec champ `source: 'cache' | 'live'`
 */
export function usePennylaneClientSearch({ debounceMs = 300, minChars = 2 } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, debounceMs);

  const { data: results, isLoading: searching } = useQuery({
    queryKey: pennylaneKeys.customerSearch(orgId, debouncedQuery),
    queryFn: async () => {
      const { data, error } = await pennylaneService.searchPennylaneCustomers(debouncedQuery, orgId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && debouncedQuery.length >= minChars,
    // Stale 30s : laisse le cache se peupler à l'usage, refetch raisonnable
    staleTime: 30_000,
  });

  const search = useCallback((newQuery) => setQuery(newQuery), []);
  const clear = useCallback(() => setQuery(''), []);

  return {
    query,
    results: results || [],
    searching,
    search,
    clear,
  };
}

/**
 * Mutation : importe un customer Pennylane comme nouveau client MDH +
 * pose le mapping pennylane_sync. Idempotent (si déjà mappé → return
 * client existant).
 *
 * Invalide les caches clients pour que la liste/recherche reflète
 * l'import immédiatement.
 */
export function useImportPennylaneCustomer() {
  const queryClient = useQueryClient();
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;

  const mutation = useMutation({
    mutationFn: async (plCustomer) => {
      if (!orgId || !userId) throw new Error('orgId et userId requis');
      const { data, error } = await pennylaneService.importPennylaneCustomerToMdh(
        orgId, plCustomer, userId,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
    },
  });

  return {
    importCustomer: useCallback(
      (plCustomer) => mutation.mutateAsync(plCustomer),
      [mutation]
    ),
    isImporting: mutation.isPending,
    error: mutation.error,
  };
}
