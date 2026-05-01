/**
 * ChantierReceptionSection.jsx — Majord'home Artisan
 * ============================================================================
 * Section "Réception marchandise" dans la fiche chantier.
 *
 * 2 états :
 *  - Pas de devis Pennylane lié → bouton "Lier un devis Pennylane"
 *  - Devis lié → header collapsible + bandeau devis + tableau lignes inline
 *               (saisie qty + bouton Valider directement sur la ligne,
 *                "+ détails" pour date/notes optionnels) + historique
 *
 * Pilote chantier_status via la RPC chantier_recompute_order_status :
 *  - Toutes les lignes 100% reçues → 'commande_recue'
 *  - Sinon → 'commande_a_faire' (uniquement si actuellement 'commande_recue')
 *
 * @version 2.0.0 — refonte UX (collapse global + inline edit)
 * ============================================================================
 */

import { Fragment, useState, useMemo } from 'react';
import {
  Package,
  FileText,
  ExternalLink,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Link2,
  AlertCircle,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatEuro, formatDateShortFR, formatDateForInput } from '@/lib/utils';
import { usePennylaneQuoteLines } from '@hooks/usePennylane';
import { useChantierReceptions } from '@hooks/useChantierReceptions';
import { LinkPennylaneQuoteModal } from './LinkPennylaneQuoteModal';

export function ChantierReceptionSection({ chantier, onUpdated, disabled = false }) {
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Collapse global du bloc (éphémère, reset à chaque ouverture du modal)
  const [globalExpanded, setGlobalExpanded] = useState(false);

  // Inline edit state — qty drafts par ligne + détails (date/notes) sur 1 ligne max
  const [qtyDrafts, setQtyDrafts] = useState({}); // { [lineId]: '12' }
  const [expandedDetailsLineId, setExpandedDetailsLineId] = useState(null);
  const [detailsDraft, setDetailsDraft] = useState({
    date: formatDateForInput(new Date()),
    notes: '',
  });

  const pennylaneQuoteId = chantier?.pennylane_quote_id ?? null;

  const {
    quote,
    lines,
    isLoading: isLoadingLines,
    error: linesError,
    refetch: refetchLines,
  } = usePennylaneQuoteLines(pennylaneQuoteId);

  const {
    receptions,
    createReception,
    deleteReception,
    recomputeStatus,
    isCreating,
    isDeleting,
  } = useChantierReceptions(chantier?.id);

  // Lignes enrichies avec qty reçue + reste
  const enrichedLines = useMemo(() => {
    return (lines || []).map((line) => {
      const lineReceptions = (receptions || []).filter(
        (r) => Number(r.pennylane_line_id) === Number(line.id)
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
  }, [lines, receptions]);

  // Snapshot pour la RPC recompute (line_id, qty_total)
  const expectedLinesPayload = useMemo(
    () => (lines || []).map((l) => ({ line_id: l.id, qty_total: Number(l.quantity) || 0 })),
    [lines]
  );

  const linesCount = enrichedLines.length;
  const completeCount = enrichedLines.filter((l) => l.is_complete).length;
  const totalReceptions = (receptions || []).length;

  // ============================================================================
  // ÉTAT NON LIÉ
  // ============================================================================

  if (!pennylaneQuoteId) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
          <Package className="w-4 h-4" />
          Gestion des Appro
        </h3>
        <div className="text-center py-6 px-4 bg-gray-50 border border-gray-200 rounded-lg">
          <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-600 mb-3">
            Aucun devis Pennylane lié à ce chantier
          </p>
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            <Link2 className="w-4 h-4" />
            Lier un devis Pennylane
          </button>
        </div>

        {linkModalOpen && (
          <LinkPennylaneQuoteModal
            isOpen={linkModalOpen}
            onClose={() => setLinkModalOpen(false)}
            chantierId={chantier.id}
            clientId={chantier.client_id}
            currentQuoteId={null}
            onLinked={() => onUpdated?.()}
          />
        )}
      </div>
    );
  }

  // ============================================================================
  // ÉTAT LIÉ
  // ============================================================================

  const handleValidateLine = async (line) => {
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

      // Reset state pour cette ligne
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
      // La RPC retourne un message déjà parlant (ex: "Quantite recue + déjà reçue dépasse...")
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

  // Sous-titre du collapse (teaser pour décider de déplier, pas un indicateur de progression)
  const subtitle = linesCount > 0
    ? `${linesCount} ligne${linesCount > 1 ? 's' : ''} (${completeCount} complète${completeCount > 1 ? 's' : ''})`
    : '';

  return (
    <div className="space-y-3">
      {/* Header collapsible — toggle global du bloc */}
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
          {subtitle && (
            <span className="text-xs font-normal normal-case tracking-normal text-gray-500 truncate">
              · {subtitle}
            </span>
          )}
        </button>
        {quote?.pdf_url && (
          <a
            href={quote.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" />
            PDF devis
          </a>
        )}
      </div>

      {globalExpanded && (
        <>
          {/* Bandeau devis lié */}
          {quote && (
            <div className="px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-between text-sm gap-3">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-gray-900">
                  {quote.quote_number || `#${quote.id}`}
                </span>
                {quote.subject && (
                  <span className="text-gray-500 ml-2">· {quote.subject}</span>
                )}
              </div>
              {quote.amount_ht != null && (
                <span className="font-semibold text-gray-900 shrink-0">
                  {formatEuro(Number(quote.amount_ht))}
                </span>
              )}
            </div>
          )}

          {/* Lignes */}
          {isLoadingLines ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : linesError ? (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1">Impossible de charger les lignes du devis Pennylane.</span>
              <button
                type="button"
                onClick={() => refetchLines()}
                className="text-xs underline hover:text-amber-900"
              >
                Réessayer
              </button>
            </div>
          ) : enrichedLines.length === 0 ? (
            <div className="text-center py-4 text-sm text-gray-500 bg-gray-50 rounded-lg">
              Aucune ligne dans ce devis.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Désignation</th>
                    <th className="text-right px-2 py-2 font-medium w-16">Qty</th>
                    <th className="text-right px-2 py-2 font-medium w-24">Reçu</th>
                    <th className="px-2 py-2 w-56"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {enrichedLines.map((line) => {
                    const detailsOpen = expandedDetailsLineId === line.id;
                    const draftQty = qtyDrafts[line.id];
                    const qtyValue =
                      draftQty != null
                        ? draftQty
                        : line.remaining > 0
                          ? String(line.remaining)
                          : '';
                    return (
                      <Fragment key={line.id}>
                        <tr className={line.is_complete ? 'bg-emerald-50/40' : ''}>
                          <td className="px-3 py-2 text-gray-900 align-top">
                            <div className="font-medium">{line.label || `Ligne #${line.id}`}</div>
                            {line.unit_price_ht > 0 && (
                              <div className="text-xs text-gray-500">
                                {formatEuro(line.unit_price_ht)} / {line.unit || 'unité'}
                                {line.vat_rate != null && ` · TVA ${line.vat_rate}%`}
                              </div>
                            )}
                          </td>
                          <td className="text-right px-2 py-2 text-gray-700 tabular-nums align-top">
                            {line.quantity}
                          </td>
                          <td className="text-right px-2 py-2 tabular-nums align-top">
                            <span
                              className={
                                line.is_complete
                                  ? 'text-emerald-700 font-semibold'
                                  : 'text-gray-700'
                              }
                            >
                              {line.received}
                              <span className="text-gray-400">/{line.quantity}</span>
                            </span>
                          </td>
                          <td className="px-2 py-2 align-top">
                            {line.is_complete ? (
                              <div className="text-right">
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                  <Check className="w-3.5 h-3.5" />
                                  Complète
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-end gap-1">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    max={line.remaining}
                                    value={qtyValue}
                                    onChange={(e) =>
                                      setQtyDrafts((prev) => ({
                                        ...prev,
                                        [line.id]: e.target.value,
                                      }))
                                    }
                                    disabled={disabled || isCreating}
                                    className="w-16 px-2 py-1 text-sm text-right border border-secondary-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent tabular-nums disabled:opacity-50"
                                    aria-label={`Quantité reçue pour ${line.label}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleValidateLine(line)}
                                    disabled={disabled || isCreating}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50"
                                  >
                                    Valider
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleToggleDetails(line.id)}
                                  disabled={disabled}
                                  className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-0.5 disabled:opacity-50"
                                >
                                  {detailsOpen ? (
                                    <ChevronDown className="w-3 h-3" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3" />
                                  )}
                                  détails
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {detailsOpen && !line.is_complete && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={4} className="px-3 py-3">
                              <div className="flex flex-wrap items-end gap-3">
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">
                                    Date de réception
                                  </label>
                                  <input
                                    type="date"
                                    value={detailsDraft.date}
                                    max={formatDateForInput(new Date())}
                                    onChange={(e) =>
                                      setDetailsDraft((prev) => ({
                                        ...prev,
                                        date: e.target.value,
                                      }))
                                    }
                                    className="px-2 py-1 text-sm border border-secondary-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <label className="block text-xs text-gray-500 mb-1">
                                    Notes (numéro BL, commentaire...)
                                  </label>
                                  <input
                                    type="text"
                                    value={detailsDraft.notes}
                                    onChange={(e) =>
                                      setDetailsDraft((prev) => ({
                                        ...prev,
                                        notes: e.target.value,
                                      }))
                                    }
                                    placeholder="ex: BL ALT-1234"
                                    className="w-full px-2 py-1 text-sm border border-secondary-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
