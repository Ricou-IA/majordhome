/**
 * QuoteBlock.jsx — Majord'home Artisan
 * ============================================================================
 * Sous-composant pur de ChantierReceptionSection (multi-devis).
 * Affiche 1 devis Pennylane lié + son tableau de lignes inline + détails facultatifs.
 *
 * Pas d'état interne : toutes les données et tous les callbacks viennent du parent
 * (qui orchestre le state des drafts pour conserver une seule source de vérité).
 *
 * @version 1.0.0 — extraction depuis ChantierReceptionSection
 * ============================================================================
 */

import { Fragment } from 'react';
import {
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import { formatEuro, formatDateForInput } from '@/lib/utils';

export function QuoteBlock({
  pennylaneQuoteId,
  linkedQuote,
  quote,
  lines,
  isLoading,
  canEject,
  isEjecting,
  onEjectQuote,
  onValidateLine,
  onToggleDetails,
  qtyDrafts,
  setQtyDrafts,
  expandedDetailsLineId,
  detailsDraft,
  setDetailsDraft,
  disabled,
  isCreating,
}) {
  const qid = pennylaneQuoteId;
  const headerLabel = quote?.quote_number || linkedQuote?.quote_label || `#${qid}`;
  const amountHt = quote?.amount_ht ?? linkedQuote?.quote_amount_ht;

  return (
    <div className="space-y-2">
      {/* Bandeau devis */}
      <div className="px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-between text-sm gap-3">
        <div className="min-w-0 flex-1">
          <span className="font-medium text-gray-900">{headerLabel}</span>
          {quote?.subject && (
            <span className="text-gray-500 ml-2">· {quote.subject}</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {amountHt != null && (
            <span className="font-semibold text-gray-900">
              {formatEuro(Number(amountHt))}
            </span>
          )}
          {quote?.pdf_url && (
            <a
              href={quote.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              PDF
            </a>
          )}
          <button
            type="button"
            onClick={() => onEjectQuote(qid, quote?.quote_number)}
            disabled={!canEject || isEjecting}
            title={
              canEject
                ? 'Retirer ce devis du chantier'
                : 'Impossible : des réceptions existent déjà sur ce devis'
            }
            className="text-gray-400 hover:text-amber-600 transition-colors p-1 disabled:opacity-30 disabled:hover:text-gray-400 disabled:cursor-not-allowed"
            aria-label="Retirer ce devis"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tableau lignes */}
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        </div>
      ) : lines.length === 0 ? (
        <div className="text-center py-3 text-xs text-gray-500 bg-gray-50 rounded-lg">
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
              {lines.map((line) => {
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
                        <div className="font-medium">
                          {line.label || `Ligne #${line.id}`}
                        </div>
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
                                onClick={() => onValidateLine(line, qid)}
                                disabled={disabled || isCreating}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50"
                              >
                                Valider
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => onToggleDetails(line.id)}
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
    </div>
  );
}

export default QuoteBlock;
