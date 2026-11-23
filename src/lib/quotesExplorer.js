/**
 * quotesExplorer.js — logique PURE de l'explorateur de devis Pennylane
 * ============================================================================
 * Aucun import React / Supabase : testable via `node --test`.
 * Le service ne fait que l'I/O, tout le tri/filtrage/tagging vit ici.
 * ============================================================================
 */

/**
 * Statuts Pennylane qui matérialisent une opportunité commerciale réelle.
 *
 * ⚠️ CE N'EST PAS une copie de `majordhome.quote_status_bucket()`. Les buckets DB
 * répondent à « ce devis est-il validé / en cours / refusé ? ». Cette allowlist-ci
 * répond à « ce devis aurait-il dû être rattaché à un lead ? ».
 * `draft` appartient au bucket `pending` côté DB mais est EXCLU ici : un brouillon
 * jamais envoyé au client n'est pas une anomalie de rapprochement.
 * La divergence est VOULUE — ne pas « corriger » en réintroduisant draft.
 */
import { SEUIL_RELANCE_JOURS } from './pipelineDashboard.js';

export const EXPLORER_QUOTE_STATUSES = ['pending', 'expired', 'accepted', 'invoiced'];

export const EXPLORER_VIEWS = {
  ORPHANS: 'orphans',
  ALL: 'all',
  DISMISSED: 'dismissed',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Joint les devis PL bruts avec leurs rattachements et leurs écartements,
 * applique les filtres métier, trie par date décroissante.
 *
 * @param {object} params
 * @param {Array}  params.quotes          - devis PL déjà formatés par le service
 * @param {Map}    [params.linkByQuoteId] - Map<number, {lead_id, lead_name}>
 * @param {Set}    [params.dismissedIds]  - Set<number> des devis écartés
 * @param {number} params.minAmountHt     - seuil pipeline (PIPELINE_MIN_AMOUNT_HT)
 * @param {number} params.sinceDays       - fenêtre glissante
 * @param {number} params.nowMs           - horodatage de référence (injecté pour les tests)
 * @returns {Array} lignes enrichies
 */
export function buildExplorerRows({
  quotes = [],
  linkByQuoteId = new Map(),
  dismissedIds = new Set(),
  minAmountHt = 0,
  sinceDays = 90,
  nowMs = Date.now(),
}) {
  const cutoffMs = nowMs - sinceDays * DAY_MS;

  const rows = [];
  for (const q of quotes) {
    if (!EXPLORER_QUOTE_STATUSES.includes(q.status)) continue;

    // `Number(null) === 0` (pas NaN) : un montant absent ne doit JAMAIS être
    // traité comme un devis à 0 €, quel que soit minAmountHt (y compris 0).
    if (q.amount_ht === null || q.amount_ht === undefined) continue;

    const amountHt = Number(q.amount_ht);
    if (!Number.isFinite(amountHt) || amountHt < minAmountHt) continue;

    if (q.date) {
      const d = Date.parse(q.date);
      if (!Number.isNaN(d) && d < cutoffMs) continue;
    }

    const link = linkByQuoteId.get(q.id) || null;
    rows.push({
      ...q,
      amount_ht: amountHt,
      lead_id: link?.lead_id ?? null,
      lead_name: link?.lead_name ?? null,
      is_orphan: !link,
      is_dismissed: dismissedIds.has(q.id),
    });
  }

  rows.sort((a, b) => {
    const da = a.date ? Date.parse(a.date) : 0;
    const db = b.date ? Date.parse(b.date) : 0;
    return db - da;
  });

  return rows;
}

/**
 * Applique la vue active. Les écartés ne sortent QUE dans la vue DISMISSED.
 */
export function filterExplorerRows(rows, view) {
  switch (view) {
    case EXPLORER_VIEWS.DISMISSED:
      return rows.filter(r => r.is_dismissed);
    case EXPLORER_VIEWS.ALL:
      return rows.filter(r => !r.is_dismissed);
    case EXPLORER_VIEWS.ORPHANS:
    default:
      return rows.filter(r => !r.is_dismissed && r.is_orphan);
  }
}

/** Nombre de devis de chaque vue, mêmes règles que filterExplorerRows (compteurs des onglets). */
export function compterVues(rows = []) {
  return {
    [EXPLORER_VIEWS.ORPHANS]: filterExplorerRows(rows, EXPLORER_VIEWS.ORPHANS).length,
    [EXPLORER_VIEWS.ALL]: filterExplorerRows(rows, EXPLORER_VIEWS.ALL).length,
    [EXPLORER_VIEWS.DISMISSED]: filterExplorerRows(rows, EXPLORER_VIEWS.DISMISSED).length,
  };
}

/** Statuts d'un devis qui attend encore la réponse du client. */
const EN_ATTENTE_DE_REPONSE = new Set(['pending', 'expired']);

/**
 * Devis envoyé resté sans réponse depuis plus de `jours` jours : en attente (ou expiré, donc
 * relançable) et daté. Un devis sans date n'est jamais compté : on ne sait pas depuis quand il attend.
 * @param {{ status?: string, date?: string|null }} ligne  ligne de l'explorateur (`date` = date du devis)
 * @param {string} aujourdhui  `YYYY-MM-DD`
 * @param {number} [jours]
 * @returns {boolean}
 */
export function sansReponseDepuis(ligne, aujourdhui, jours = SEUIL_RELANCE_JOURS) {
  if (!EN_ATTENTE_DE_REPONSE.has(ligne?.status) || !ligne?.date) return false;
  const debut = Date.parse(String(ligne.date).slice(0, 10));
  const fin = Date.parse(aujourdhui);
  if (Number.isNaN(debut) || Number.isNaN(fin)) return false;
  return Math.round((fin - debut) / DAY_MS) > jours;
}

/**
 * Payload RPC `lead_attach_quotes_and_send` d'une ligne de l'explorateur.
 * Forme unique partagée par le rattachement (AttachQuoteToLeadModal) et la
 * création de lead (CreateLeadFromQuoteModal).
 */
export function toAttachPayload(quote) {
  return {
    quote_pl_id: quote.id,
    customer_id: quote.customer_id ?? null,
    amount_ht: quote.amount_ht ?? null,
    label: quote.quote_number || quote.label || null,
    date: quote.date || null,
    status: quote.status || null,
    pdf_url: quote.pdf_url || null,
  };
}
