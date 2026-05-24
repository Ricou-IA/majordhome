/**
 * QuoteCandidatesModal.jsx — Majord'home Artisan (pipeline)
 * ============================================================================
 * Multi-attach de devis Pennylane à un lead au pivot "Devis envoyé".
 * Spec : docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md §9
 *
 * Structure :
 *   - Section Suggestions : devis matchés par fuzzy (bridge fort + email + phone)
 *   - Bouton "Explorer les devis non rattachés (60j)" → révèle Section Exploration
 *   - Multi-sélection (checkboxes)
 *   - Bouton "Attacher la sélection (N)" désactivé si 0 cochés (strict blocage)
 *   - Message d'aide si 0 suggestion ET Exploration non révélée
 *
 * Différences vs LinkPennylaneQuoteModal (chantier post-vente) :
 *   - Multi-select au lieu de single (1 click = 1 attach)
 *   - Bascule lead → "Devis envoyé" via RPC PR 2 (transactionnel)
 *   - Strict : impossible de fermer sans attacher au moins 1 devis
 * ============================================================================
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  X, Loader2, AlertCircle, Search, Link2, Mail, Phone,
  CheckCircle2, ExternalLink, FileText, ChevronDown, ChevronUp,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useCandidateQuotesForLead,
  useUnlinkedQuotes,
  useAttachQuotesAndSend,
} from '@hooks/usePennylane';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

// ============================================================================
// Statuts Pennylane (palette deutan-friendly — pas de rouge/vert)
// ============================================================================

const QUOTE_STATUS_CONFIG = {
  accepted: { label: 'Accepté', color: '#1d4ed8', bgColor: '#dbeafe' },
  pending: { label: 'En attente', color: '#b45309', bgColor: '#fef3c7' },
  draft: { label: 'Brouillon', color: '#6b7280', bgColor: '#f3f4f6' },
  denied: { label: 'Refusé', color: '#4b5563', bgColor: '#e5e7eb' },
  refused: { label: 'Refusé', color: '#4b5563', bgColor: '#e5e7eb' },
  expired: { label: 'Expiré', color: '#4b5563', bgColor: '#e5e7eb' },
};

function getQuoteStatusConfig(status) {
  return QUOTE_STATUS_CONFIG[status] || {
    label: status || 'Inconnu',
    color: '#6b7280',
    bgColor: '#f3f4f6',
  };
}

// ============================================================================
// Signaux fuzzy (chips)
// ============================================================================

const SIGNAL_CONFIG = {
  pennylane_sync: { label: 'Bridge', icon: Link2, color: '#1d4ed8', bg: '#dbeafe' },
  email: { label: 'Email', icon: Mail, color: '#7c3aed', bg: '#ede9fe' },
  phone: { label: 'Tél.', icon: Phone, color: '#0891b2', bg: '#cffafe' },
};

function SignalChip({ signal }) {
  const cfg = SIGNAL_CONFIG[signal];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
      title={`Match via ${cfg.label}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ============================================================================
// Une ligne devis (réutilisée pour Suggestions + Exploration)
// ============================================================================

function QuoteRow({
  quote,
  signals = [],
  alreadyAttached = false,
  checked,
  onToggle,
  disabled,
}) {
  const cfg = getQuoteStatusConfig(quote.status);
  return (
    <li className="py-3">
      <label className={`flex items-start gap-3 cursor-pointer ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => !disabled && onToggle(quote.id)}
          disabled={disabled}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">
              {quote.quote_number || quote.label || `#${quote.id}`}
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ color: cfg.color, backgroundColor: cfg.bgColor }}
            >
              {cfg.label}
            </span>
            {alreadyAttached && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Déjà attaché
              </span>
            )}
            {signals.map(s => <SignalChip key={s} signal={s} />)}
          </div>
          {quote.customer_name && (
            <div className="flex items-center gap-1 mt-1 text-xs text-gray-700 font-medium">
              <User className="w-3 h-3 text-gray-400" />
              <span className="truncate">{quote.customer_name}</span>
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
            {quote.date && <span>{formatDateShortFR(quote.date)}</span>}
            {quote.subject && <span className="truncate max-w-md">{quote.subject}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold text-gray-900">
            {quote.amount_ht != null ? formatEuro(Number(quote.amount_ht)) : '—'}
          </div>
          {quote.pdf_url && (
            <a
              href={quote.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 mt-1"
            >
              <ExternalLink className="w-3 h-3" />
              PDF
            </a>
          )}
        </div>
      </label>
    </li>
  );
}

// ============================================================================
// Composant principal
// ============================================================================

/**
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {Function} props.onClose
 * @param {string} props.leadId
 * @param {string} props.orgId
 * @param {Function} [props.onBeforeAttach] - callback async appelé juste avant
 *   l'attach RPC (utile pour sauver le formulaire LeadModal en parent + sync
 *   client). Si throw → l'attach est annulé.
 * @param {Function} [props.onAttached] - callback après attach réussi
 */
export function QuoteCandidatesModal({
  isOpen,
  onClose,
  leadId,
  orgId,
  onBeforeAttach,
  onAttached,
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showExploration, setShowExploration] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const {
    candidates,
    isLoading: loadingCandidates,
  } = useCandidateQuotesForLead(leadId, { enabled: isOpen });

  const {
    unlinkedQuotes,
    isLoading: loadingUnlinked,
  } = useUnlinkedQuotes({ sinceDays: 60, limit: 100, enabled: isOpen && showExploration });

  const { attachQuotes, isAttaching } = useAttachQuotesAndSend(orgId, leadId);

  // Construire l'ensemble des IDs déjà attachés à CE lead (pré-cochés et verrouillés)
  const alreadyAttachedIds = useMemo(
    () => new Set(candidates.filter(c => c.alreadyAttached).map(c => c.quote.id)),
    [candidates]
  );

  // Ouverture / chargement candidates : pré-cocher les déjà attachés (verrouillés)
  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      alreadyAttachedIds.forEach(id => next.add(id));
      return next;
    });
  }, [isOpen, alreadyAttachedIds]);

  // Set des IDs candidats suggérés (pour éviter doublons dans Exploration)
  const candidateIds = useMemo(
    () => new Set(candidates.map(c => c.quote.id)),
    [candidates]
  );

  // Normalise pour comparaison insensible casse/accents
  // (range ̀-ͯ = combining marks Unicode après NFD)
  const normalizeForSearch = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();

  const normalizedQuery = useMemo(() => normalizeForSearch(searchQuery), [searchQuery]);

  const explorationQuotes = useMemo(() => {
    const baseList = unlinkedQuotes.filter(q => !candidateIds.has(q.id));
    if (!normalizedQuery) return baseList;
    return baseList.filter(q => {
      const haystack = normalizeForSearch(
        [q.customer_name, q.quote_number, q.label, q.subject]
          .filter(Boolean)
          .join(' ')
      );
      return haystack.includes(normalizedQuery);
    });
  }, [unlinkedQuotes, candidateIds, normalizedQuery]);

  // Map id → quote pour reconstituer le payload au submit
  const quotesById = useMemo(() => {
    const m = new Map();
    candidates.forEach(c => m.set(c.quote.id, c.quote));
    explorationQuotes.forEach(q => m.set(q.id, q));
    return m;
  }, [candidates, explorationQuotes]);

  // Nb sélectionnés (en excluant les déjà attachés — déjà comptabilisés en DB)
  const newSelectionsCount = useMemo(() => {
    let n = 0;
    selectedIds.forEach(id => {
      if (!alreadyAttachedIds.has(id)) n++;
    });
    return n;
  }, [selectedIds, alreadyAttachedIds]);

  const toggleQuote = useCallback((quoteId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(quoteId)) next.delete(quoteId);
      else next.add(quoteId);
      return next;
    });
  }, []);

  const handleClose = useCallback(() => {
    if (isAttaching) return;
    setSelectedIds(new Set());
    setShowExploration(false);
    setSearchQuery('');
    onClose();
  }, [isAttaching, onClose]);

  const handleSubmit = useCallback(async () => {
    if (newSelectionsCount === 0) return;

    try {
      if (onBeforeAttach) await onBeforeAttach();
    } catch (err) {
      console.error('[QuoteCandidatesModal] onBeforeAttach failed:', err);
      toast.error('Erreur en sauvegardant le lead avant attachement');
      return;
    }

    // Construit le payload : on n'envoie QUE les nouvelles sélections.
    // Les "déjà attachés" sont préservés tels quels en DB (la RPC fait UPDATE
    // idempotent dessus si on les renvoie, mais autant éviter de payloader pour rien).
    const newQuotes = Array.from(selectedIds)
      .filter(id => !alreadyAttachedIds.has(id))
      .map(id => {
        const q = quotesById.get(id);
        if (!q) return null;
        return {
          quote_pl_id: q.id,
          customer_id: q.customer_id ?? null,
          amount_ht: q.amount_ht ?? null,
          // Priorité quote_number (D-YYYY-XXXX) sur subject (titre long)
          label: q.quote_number || q.label || q.subject || null,
          date: q.date || null,
          status: q.status || null,
        };
      })
      .filter(Boolean);

    try {
      const result = await attachQuotes(newQuotes);
      const n = result?.attached ?? newQuotes.length;
      const statusMsg = result?.lead_status_changed
        ? ' — lead passé en "Devis envoyé"'
        : '';
      toast.success(`${n} devis Pennylane attaché${n > 1 ? 's' : ''}${statusMsg}`);
      onAttached?.(result);
      handleClose();
    } catch (err) {
      console.error('[QuoteCandidatesModal] attach error:', err);
      toast.error(err?.message || 'Erreur lors de l\'attachement des devis');
    }
  }, [
    newSelectionsCount, onBeforeAttach, selectedIds, alreadyAttachedIds,
    quotesById, attachQuotes, onAttached, handleClose,
  ]);

  if (!isOpen) return null;

  const hasSuggestions = candidates.length > 0;
  const showEmptySuggestionsHint = !loadingCandidates && !hasSuggestions && !showExploration;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-8 pb-8">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-4rem)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3">
            <Link2 className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Passer en « Devis envoyé »
              </h2>
              <p className="text-xs text-gray-500">
                Sélectionne le(s) devis Pennylane à attacher au lead (variantes possibles)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isAttaching}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors disabled:opacity-50"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Section Suggestions */}
          <section className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Suggestions pour ce client
            </h3>

            {loadingCandidates ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : hasSuggestions ? (
              <ul className="divide-y divide-gray-100">
                {candidates.map(({ quote, signals, alreadyAttached }) => (
                  <QuoteRow
                    key={quote.id}
                    quote={quote}
                    signals={signals}
                    alreadyAttached={alreadyAttached}
                    checked={selectedIds.has(quote.id)}
                    onToggle={toggleQuote}
                    disabled={alreadyAttached}
                  />
                ))}
              </ul>
            ) : (
              <div className="text-center py-6 text-sm text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                Aucun devis Pennylane trouvé pour ce client.
              </div>
            )}
          </section>

          {/* Bouton expand Exploration */}
          <button
            type="button"
            onClick={() => setShowExploration(!showExploration)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-500" />
              Explorer les devis non rattachés (60 derniers jours)
            </span>
            {showExploration
              ? <ChevronUp className="w-4 h-4 text-gray-500" />
              : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </button>

          {/* Section Exploration */}
          {showExploration && (
            <section className="mt-3">
              {/* Champ de recherche full text (client + numéro + subject) */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher (nom client, numéro devis…)"
                  className="w-full pl-9 pr-9 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    aria-label="Effacer la recherche"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {loadingUnlinked ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : explorationQuotes.length > 0 ? (
                <>
                  <p className="text-xs text-gray-500 mb-2">
                    {explorationQuotes.length} devis
                    {normalizedQuery ? ` correspondant à « ${searchQuery} »` : ' sans rattachement actif'}
                  </p>
                  <ul className="divide-y divide-gray-100">
                    {explorationQuotes.map(quote => (
                      <QuoteRow
                        key={quote.id}
                        quote={quote}
                        signals={[]}
                        alreadyAttached={false}
                        checked={selectedIds.has(quote.id)}
                        onToggle={toggleQuote}
                      />
                    ))}
                  </ul>
                </>
              ) : (
                <div className="text-center py-6 text-sm text-gray-500">
                  {normalizedQuery
                    ? `Aucun devis ne correspond à « ${searchQuery} ».`
                    : 'Aucun devis disponible dans la fenêtre de 60 jours.'}
                </div>
              )}
            </section>
          )}

          {/* Hint si 0 suggestion ET Exploration pas ouverte */}
          {showEmptySuggestionsHint && (
            <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Aucun devis Pennylane trouvé pour ce client.
                Crée-le d&apos;abord dans Pennylane, ou explore les devis non rattachés ci-dessus.
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t bg-gray-50">
          <span className="text-xs text-gray-500">
            {newSelectionsCount > 0
              ? `${newSelectionsCount} nouveau${newSelectionsCount > 1 ? 'x' : ''} devis à attacher`
              : 'Aucun devis sélectionné'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isAttaching}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={newSelectionsCount === 0 || isAttaching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAttaching ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Attachement…
                </>
              ) : (
                `Attacher la sélection${newSelectionsCount > 0 ? ` (${newSelectionsCount})` : ''}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default QuoteCandidatesModal;
