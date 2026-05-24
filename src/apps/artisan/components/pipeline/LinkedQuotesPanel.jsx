/**
 * LinkedQuotesPanel.jsx — Majord'home Artisan (pipeline)
 * ============================================================================
 * Affichage lecture-seule des devis Pennylane attachés à un lead.
 * Une ligne par devis : numéro (D-YYYY-XXXX) + badge Gagnant si applicable
 * + montant HT + lien externe Pennylane.
 *
 * Volontairement épuré (pas de chip statut ni de date) — la pertinence est
 * de pointer vers le devis Pennylane qui détient la source de vérité.
 * ============================================================================
 */

import { Link2, ExternalLink, Trophy } from 'lucide-react';
import { formatEuro } from '@/lib/utils';

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
        Devis Pennylane attachés ({quotes.length})
      </div>
      <ul className="space-y-1.5">
        {quotes.map((q) => {
          // Priorité : quote_number_pl (fetché depuis Pennylane) > quote_label
          // > fallback pennylane_quote_id formaté
          const displayNumber = q.quote_number_pl
            || q.quote_label
            || `#${q.pennylane_quote_id}`;
          return (
            <li
              key={q.id}
              className="flex items-center justify-between gap-3 px-2 py-1.5 bg-white rounded border border-blue-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-gray-900 text-sm truncate">
                  {displayNumber}
                </span>
                {q.is_winning_quote && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium inline-flex items-center gap-0.5 shrink-0">
                    <Trophy className="w-3 h-3" />
                    Gagnant
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold text-gray-900">
                  {q.quote_amount_ht != null
                    ? formatEuro(Number(q.quote_amount_ht))
                    : '—'}
                </span>
                <a
                  href={`https://app.pennylane.com/quotes/${q.pennylane_quote_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 text-xs"
                  title="Ouvrir dans Pennylane"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default LinkedQuotesPanel;
