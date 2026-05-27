/**
 * LinkedQuotesPanel.jsx — Majord'home Artisan (pipeline)
 * ============================================================================
 * Affichage lecture-seule des devis Pennylane attachés à un lead.
 * Une ligne par devis : numéro (D-YYYY-XXXX) + date PL + badge Gagnant si
 * applicable + chip statut (Refusé/Expiré) + montant HT + lien externe.
 *
 * Source de vérité = Pennylane (date, status, montant) ; l'affichage ici est
 * informatif pour permettre d'identifier les devis sans ouvrir PL.
 * ============================================================================
 */

import { Link2, ExternalLink, Trophy } from 'lucide-react';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

// Chips minimalistes : on n'affiche QUE "Refusé" (denied/refused PL).
// Expired et autres statuts intermediaires ne sont pas suivis cote metier
// (decision produit 2026-05-27). Le badge Gagnant signale les accepted.
const QUOTE_STATUS_CHIP = {
  denied: { label: 'Refusé', color: '#4b5563', bg: '#e5e7eb' },
  refused: { label: 'Refusé', color: '#4b5563', bg: '#e5e7eb' },
};

/**
 * @param {Object} props
 * @param {Array} props.quotes — lead_pennylane_quotes enrichis (quote_number_pl)
 * @param {boolean} [props.isLoading]
 */
export function LinkedQuotesPanel({ quotes, isLoading }) {
  if (isLoading) return null;
  if (!quotes || quotes.length === 0) return null;

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 mb-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700 mb-2">
        <Link2 className="w-3.5 h-3.5" />
        Devis ({quotes.length})
      </div>
      <ul className="space-y-1.5">
        {quotes.map((q) => {
          const displayNumber = q.quote_number_pl
            || q.quote_label
            || `#${q.pennylane_quote_id}`;
          const statusChip = QUOTE_STATUS_CHIP[q.quote_status];
          return (
            <li
              key={q.id}
              className="flex items-center justify-between gap-3 px-2 py-1.5 bg-white rounded border border-blue-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-gray-900 text-sm truncate">
                    {displayNumber}
                  </span>
                  {q.quote_date && (
                    <span className="text-[10px] text-gray-500 leading-none mt-0.5">
                      {formatDateShortFR(q.quote_date)}
                    </span>
                  )}
                </div>
                {q.is_winning_quote && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium inline-flex items-center gap-0.5 shrink-0">
                    <Trophy className="w-3 h-3" />
                    Gagnant
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {statusChip && !q.is_winning_quote && (
                  <span
                    className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                    style={{ color: statusChip.color, backgroundColor: statusChip.bg }}
                  >
                    {statusChip.label}
                  </span>
                )}
                <span className="text-sm font-semibold text-gray-900 tabular-nums">
                  {q.quote_amount_ht != null
                    ? formatEuro(Number(q.quote_amount_ht))
                    : '—'}
                </span>
                {q.pdf_url ? (
                  <a
                    href={q.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 text-xs"
                    title="Ouvrir le PDF Pennylane"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span
                    className="text-gray-300 inline-flex items-center gap-1 text-xs cursor-not-allowed"
                    title="PDF non encore synchronisé (prochain cycle sous 15 min)"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default LinkedQuotesPanel;
