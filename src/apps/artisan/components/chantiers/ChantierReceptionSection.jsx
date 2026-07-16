/**
 * ChantierReceptionSection.jsx — Majord'home Artisan
 * ============================================================================
 * Section "Gestion des Appro" dans la fiche chantier (multi-devis).
 *
 * 3 états :
 *  - Aucun devis rattaché → renvoi vers le pipeline (seul lieu de rattachement)
 *  - Devis rattachés mais aucun validé → même renvoi, + sous-liste repliée
 *  - ≥1 devis validé → header collapsible avec compteur détaillé par devis
 *                    + 1 bloc par devis (bandeau + tableau lignes inline)
 *                    + sous-liste repliée
 *
 * Source de vérité : vue majordhome_lead_pennylane_quotes (FK direct
 * leads.pennylane_quote_id ignoré côté UI), filtrée sur is_validated : le
 * chantier ne reprend que les devis validés dans Pennylane, même définition
 * que la colonne Gagné du pipeline.
 *
 * Les devis non validés restent listés (repliés, sans lignes ni réception) :
 * le cron pennylane-sync-quote-status rattache un nouveau devis PL au lead
 * « assigné le plus récemment », donc il peut viser le mauvais lead — et c'est
 * le seul cas que Pennylane ne peut pas corriger de lui-même. L'éjection est
 * l'unique recours, et le mauvais rattachement le plus probable est un devis
 * pending. Les masquer supprimerait le seul ✕ d'éjection de l'application.
 *
 * Pilote chantier_status via la RPC chantier_recompute_order_status :
 *  - Toutes les lignes de tous les devis 100% reçues → 'commande_recue'
 *  - Sinon → 'commande_a_faire' (uniquement si actuellement 'commande_recue')
 *
 * @version 3.0.0 — multi-devis par chantier
 * ============================================================================
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Package,
  FileText,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateShortFR, formatDateForInput, formatEuro } from '@/lib/utils';
import {
  useMultiplePennylaneQuoteLines,
  useLinkedPennylaneQuotes,
  useLinkedPennylaneQuotesMutations,
} from '@hooks/usePennylane';
import { useChantierReceptions } from '@hooks/useChantierReceptions';
import { QuoteBlock } from './QuoteBlock';

// Statuts Pennylane non validés (buckets 'pending' / 'refused' / 'other' de
// majordhome.quote_status_bucket) — les seuls à pouvoir atterrir dans la
// sous-liste, 'accepted'/'invoiced' étant filtrés en amont par is_validated.
const PL_STATUS_LABELS = {
  pending: 'En attente',
  draft: 'Brouillon',
  expired: 'Expiré',
  refused: 'Refusé',
  denied: 'Refusé',
  canceled: 'Annulé',
};

/**
 * Sous-liste repliée des devis rattachés au lead mais non validés dans PL.
 * Volontairement minimale : libellé, statut, montant, ✕ d'éjection. Pas de
 * lignes PL (elles ne sont pas chargées pour ces devis) ni de réception.
 */
function NonValidatedQuotesList({
  quotes,
  open,
  onToggle,
  canEjectQuote,
  isEjecting,
  onEjectQuote,
}) {
  if (!quotes.length) return null;

  return (
    <details open={open} onToggle={onToggle} className="text-xs">
      <summary className="cursor-pointer text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 list-none select-none">
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
        Devis non validés ({quotes.length})
      </summary>
      <ul className="mt-2 space-y-1 pl-4">
        {quotes.map((q) => {
          const qid = q.pennylane_quote_id;
          const label = q.quote_label || `#${qid}`;
          const canEject = canEjectQuote(qid);
          return (
            <li
              key={qid}
              className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 last:border-b-0"
            >
              <div className="flex-1 min-w-0">
                <span className="font-medium text-gray-700">{label}</span>
                <span className="text-gray-400">
                  {' '}
                  · {PL_STATUS_LABELS[q.quote_status] || q.quote_status || '—'}
                </span>
              </div>
              {q.quote_amount_ht != null && (
                <span className="text-gray-500 tabular-nums shrink-0">
                  {formatEuro(Number(q.quote_amount_ht))}
                </span>
              )}
              <button
                type="button"
                onClick={() => onEjectQuote(qid, q.quote_label)}
                disabled={!canEject || isEjecting}
                title={
                  canEject
                    ? 'Retirer ce devis du chantier'
                    : 'Impossible : des réceptions existent déjà sur ce devis'
                }
                className="text-gray-400 hover:text-amber-600 transition-colors p-1 disabled:opacity-30 disabled:hover:text-gray-400 disabled:cursor-not-allowed shrink-0"
                aria-label={`Retirer le devis ${label}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function ChantierReceptionSection({ chantier, onUpdated, disabled = false }) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const [historyOpen, setHistoryOpen] = useState(false);
  const [nonValidatedOpen, setNonValidatedOpen] = useState(false);
  const [globalExpanded, setGlobalExpanded] = useState(false);

  // Inline edit state — qty drafts par ligne PL + détails (date/notes) sur 1 ligne max
  const [qtyDrafts, setQtyDrafts] = useState({}); // { [lineId]: '12' }
  const [expandedDetailsLineId, setExpandedDetailsLineId] = useState(null);
  const [detailsDraft, setDetailsDraft] = useState({
    date: formatDateForInput(new Date()),
    notes: '',
  });

  // Devis liés au chantier (source de vérité = pivot lead_pennylane_quotes)
  const {
    linkedQuotes: allLinkedQuotes,
    isLoading: isLoadingLinks,
  } = useLinkedPennylaneQuotes(chantier?.id);

  // Le chantier ne reprend que les devis validés par le client dans Pennylane
  // (is_validated = quote_status_bucket() côté DB — même définition que la
  // colonne Gagné du pipeline). Les autres restent dans le pivot : on filtre à
  // l'affichage, on n'éjecte pas, pour ne pas déplacer la carte pipeline.
  const linkedQuotes = useMemo(
    () => (allLinkedQuotes || []).filter((q) => q.is_validated),
    [allLinkedQuotes]
  );

  const nonValidatedQuotes = useMemo(
    () => (allLinkedQuotes || []).filter((q) => !q.is_validated),
    [allLinkedQuotes]
  );

  const { ejectQuote, isEjecting } = useLinkedPennylaneQuotesMutations(orgId, chantier?.id);

  // Charge en parallèle les lignes de tous les devis liés
  const linkedQuoteIds = useMemo(
    () => (linkedQuotes || []).map((q) => q.pennylane_quote_id),
    [linkedQuotes]
  );
  const {
    resultsById: linesByQuote,
    isError: linesError,
  } = useMultiplePennylaneQuoteLines(linkedQuoteIds);

  const {
    receptions,
    createReception,
    deleteReception,
    recomputeStatus,
    isCreating,
    isDeleting,
  } = useChantierReceptions(chantier?.id);

  // Un devis n'est éjectable que si aucune réception ne s'y rattache — un devis
  // accepté puis passé en refusé côté PL peut porter des réceptions, il bascule
  // alors dans la sous-liste non validée sans devenir éjectable pour autant.
  const canEjectQuote = useCallback(
    (pennylaneQuoteId) =>
      !disabled &&
      !(receptions || []).some(
        (r) => Number(r.pennylane_quote_id) === Number(pennylaneQuoteId)
      ),
    [disabled, receptions]
  );

  // Snapshot global des lignes attendues (toutes lignes de tous les devis)
  // pour la RPC recompute. La RPC ne filtre PAS par quote_id, donc on passe l'union.
  const expectedLinesPayload = useMemo(() => {
    const out = [];
    Object.values(linesByQuote).forEach((res) => {
      (res.lines || []).forEach((l) => {
        out.push({ line_id: l.id, qty_total: Number(l.quantity) || 0 });
      });
    });
    return out;
  }, [linesByQuote]);

  // Pour chaque devis, lignes enrichies (qty reçue + reste)
  // Filtre les réceptions par pennylane_quote_id ET pennylane_line_id (safety
  // au cas où des line_ids se chevaucheraient entre devis — peu probable mais propre).
  const enrichedByQuote = useMemo(() => {
    const out = {};
    (linkedQuotes || []).forEach((lq) => {
      const qid = lq.pennylane_quote_id;
      const lines = linesByQuote[qid]?.lines || [];
      out[qid] = lines.map((line) => {
        const lineReceptions = (receptions || []).filter(
          (r) =>
            Number(r.pennylane_quote_id) === Number(qid) &&
            Number(r.pennylane_line_id) === Number(line.id)
        );
        const received = lineReceptions.reduce(
          (sum, r) => sum + Number(r.quantity_received || 0),
          0
        );
        const total = Number(line.quantity) || 0;
        return {
          ...line,
          received,
          remaining: Math.max(0, total - received),
          is_complete: total > 0 && received >= total,
        };
      });
    });
    return out;
  }, [linkedQuotes, linesByQuote, receptions]);

  // Compteur header par devis : "D-04107 · 5/8 · D-04106 · 7/11"
  const headerSummary = useMemo(() => {
    if (!linkedQuotes?.length) return '';
    return linkedQuotes
      .map((lq) => {
        const lines = enrichedByQuote[lq.pennylane_quote_id] || [];
        const total = lines.length;
        const complete = lines.filter((l) => l.is_complete).length;
        const meta = linesByQuote[lq.pennylane_quote_id];
        const num = meta?.quote?.quote_number || `#${lq.pennylane_quote_id}`;
        return `${num} · ${complete}/${total}`;
      })
      .join(' · ');
  }, [linkedQuotes, enrichedByQuote, linesByQuote]);

  const totalReceptions = (receptions || []).length;

  // ============================================================================
  // CHARGEMENT
  // ============================================================================

  if (isLoadingLinks) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
          <Package className="w-4 h-4" />
          Gestion des Appro
        </h3>
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  // ============================================================================
  // HANDLERS (définis avant les retours : la sous-liste « non validés » a
  // besoin de handleEjectQuote y compris quand aucun devis n'est validé)
  // ============================================================================

  const handleValidateLine = async (line, pennylaneQuoteId) => {
    const draftQty = qtyDrafts[line.id];
    const qty = draftQty != null && draftQty !== '' ? Number(draftQty) : line.remaining;

    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('La quantité doit être > 0');
      return;
    }
    if (qty > line.remaining) {
      toast.error(`Quantité max : ${line.remaining}`);
      return;
    }

    const today = formatDateForInput(new Date());
    const isDetailsOpen = expandedDetailsLineId === line.id;
    if (isDetailsOpen && detailsDraft.date && detailsDraft.date > today) {
      toast.error('La date de réception ne peut pas être dans le futur');
      return;
    }
    const receivedAt = isDetailsOpen ? detailsDraft.date || today : today;
    const notes = isDetailsOpen ? detailsDraft.notes?.trim() || null : null;

    try {
      await createReception({
        chantierId: chantier.id,
        pennylaneQuoteId: Number(pennylaneQuoteId),
        pennylaneLineId: Number(line.id),
        lineLabel: line.label,
        lineUnitPriceHt: line.unit_price_ht,
        lineVatRate: line.vat_rate,
        lineQuantityTotal: Number(line.quantity),
        quantityReceived: qty,
        receivedAt,
        notes,
      });
      await recomputeStatus(expectedLinesPayload);

      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      if (isDetailsOpen) {
        setExpandedDetailsLineId(null);
        setDetailsDraft({ date: formatDateForInput(new Date()), notes: '' });
      }

      onUpdated?.();
      toast.success('Réception enregistrée');
    } catch (e) {
      toast.error(e?.message || 'Erreur enregistrement réception');
    }
  };

  const handleToggleDetails = (lineId) => {
    if (expandedDetailsLineId === lineId) {
      setExpandedDetailsLineId(null);
    } else {
      setExpandedDetailsLineId(lineId);
      setDetailsDraft({ date: formatDateForInput(new Date()), notes: '' });
    }
  };

  const handleDeleteReception = async (reception) => {
    if (!window.confirm(
      `Supprimer la réception du ${formatDateShortFR(reception.received_at)} (qty ${reception.quantity_received}) ?`
    )) return;
    try {
      await deleteReception(reception.id);
      await recomputeStatus(expectedLinesPayload);
      onUpdated?.();
      toast.success('Réception supprimée');
    } catch {
      toast.error('Erreur suppression');
    }
  };

  const handleEjectQuote = async (pennylaneQuoteId, quoteNumber) => {
    if (!window.confirm(
      `Retirer le devis ${quoteNumber || `#${pennylaneQuoteId}`} de ce chantier ?`
    )) return;
    try {
      await ejectQuote(pennylaneQuoteId, 'manual_ui');
      await recomputeStatus(expectedLinesPayload);
      onUpdated?.();
      toast.success('Devis retiré du chantier');
    } catch (e) {
      toast.error(e?.message || 'Erreur retrait du devis');
    }
  };

  const nonValidatedList = (
    <NonValidatedQuotesList
      quotes={nonValidatedQuotes}
      open={nonValidatedOpen}
      onToggle={(e) => setNonValidatedOpen(e.currentTarget.open)}
      canEjectQuote={canEjectQuote}
      isEjecting={isEjecting}
      onEjectQuote={handleEjectQuote}
    />
  );

  // ============================================================================
  // ÉTAT SANS DEVIS VALIDÉ
  // « aucun devis rattaché » et « des devis rattachés, aucun validé » sont deux
  // situations distinctes : la seconde doit montrer les devis (et leur ✕), sans
  // quoi un mauvais rattachement du cron reste invisible ET inéjectable.
  // ============================================================================

  if (linkedQuotes.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
          <Package className="w-4 h-4" />
          Gestion des Appro
        </h3>
        <div className="text-center py-6 px-4 bg-gray-50 border border-gray-200 rounded-lg">
          <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          {nonValidatedQuotes.length > 0 ? (
            <>
              <p className="text-sm text-gray-600">
                Aucun devis validé sur ce chantier
              </p>
              <p className="text-xs text-gray-400 mt-2 max-w-sm mx-auto">
                {nonValidatedQuotes.length === 1
                  ? '1 devis est rattaché mais n’est pas validé dans Pennylane.'
                  : `${nonValidatedQuotes.length} devis sont rattachés mais aucun n’est validé dans Pennylane.`}{' '}
                Les lignes apparaîtront ici dès l’acceptation.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Aucun devis rattaché à ce chantier
              </p>
              <p className="text-xs text-gray-400 mt-2 max-w-sm mx-auto">
                Le chantier reprend les devis acceptés dans Pennylane. Le rattachement
                se fait depuis le pipeline.
              </p>
            </>
          )}
        </div>
        {nonValidatedList}
      </div>
    );
  }

  // ============================================================================
  // ÉTAT LIÉ (≥1 devis validé)
  // ============================================================================

  return (
    <div className="space-y-3">
      {/* Header collapsible */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setGlobalExpanded((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left group"
          aria-expanded={globalExpanded}
        >
          {globalExpanded ? (
            <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-gray-600 transition-colors" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-gray-600 transition-colors" />
          )}
          <Package className="w-4 h-4 shrink-0 text-secondary-500" />
          <span className="text-sm font-semibold text-secondary-500 uppercase tracking-wider group-hover:text-gray-700 transition-colors">
            Gestion des Appro
          </span>
          {headerSummary && (
            <span className="text-xs font-normal normal-case tracking-normal text-gray-500 truncate">
              · {headerSummary}
            </span>
          )}
        </button>
      </div>

      {globalExpanded && (
        <>
          {linesError && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1">Impossible de charger certaines lignes Pennylane.</span>
            </div>
          )}

          {/* 1 bloc par devis lié */}
          {linkedQuotes.map((lq) => {
            const qid = lq.pennylane_quote_id;
            const meta = linesByQuote[qid];
            const canEject = canEjectQuote(qid);

            return (
              <QuoteBlock
                key={qid}
                pennylaneQuoteId={qid}
                linkedQuote={lq}
                quote={meta?.quote}
                lines={enrichedByQuote[qid] || []}
                isLoading={meta?.isLoading}
                canEject={canEject}
                isEjecting={isEjecting}
                onEjectQuote={handleEjectQuote}
                onValidateLine={handleValidateLine}
                onToggleDetails={handleToggleDetails}
                qtyDrafts={qtyDrafts}
                setQtyDrafts={setQtyDrafts}
                expandedDetailsLineId={expandedDetailsLineId}
                detailsDraft={detailsDraft}
                setDetailsDraft={setDetailsDraft}
                disabled={disabled}
                isCreating={isCreating}
              />
            );
          })}

          {/* Devis rattachés mais non validés — ✕ d'éjection conservé */}
          {nonValidatedList}

          {/* Historique */}
          {totalReceptions > 0 && (
            <details
              open={historyOpen}
              onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
              className="text-xs"
            >
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 list-none select-none">
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${historyOpen ? '' : '-rotate-90'}`}
                />
                Historique des réceptions ({totalReceptions})
              </summary>
              <ul className="mt-2 space-y-1 pl-4">
                {receptions.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-gray-700">
                        {formatDateShortFR(r.received_at)} ·{' '}
                        <span className="font-medium">{r.line_label}</span> · qty{' '}
                        {Number(r.quantity_received)}
                      </span>
                      {r.notes && (
                        <div className="text-gray-400 italic truncate">« {r.notes} »</div>
                      )}
                    </div>
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => handleDeleteReception(r)}
                        disabled={isDeleting}
                        className="text-gray-400 hover:text-amber-600 transition-colors p-1 disabled:opacity-50"
                        aria-label="Supprimer cette réception"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export default ChantierReceptionSection;
