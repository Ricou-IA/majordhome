/**
 * LinkedQuotesPanel.jsx — Majord'home Artisan (pipeline)
 * ============================================================================
 * Affichage lecture-seule des devis Pennylane attachés à un lead.
 * Spec : docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md
 *
 * Une ligne par devis avec :
 *   - Numéro (D-2026-XXX) + statut (chip deutan-friendly)
 *   - Badge "Gagnant" si is_winning_quote=true
 *   - Date du devis
 *   - Montant HT
 *   - Lien externe Pennylane
 *
 * Pas d'action de modification depuis ce panel (read-only). Pour rattacher
 * un devis : QuoteCandidatesModal. Pour bouger le winning : MarkWonQuoteModal.
 * ============================================================================
 */

import { Link2, ExternalLink, Trophy } from 'lucide-react';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

// Même palette que QuoteCandidatesModal / MarkWonQuoteModal (deutan-friendly)
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

/**
 * @param {Object} props
 * @param {Array} props.quotes — liste de lead_pennylane_quotes (vue publique)
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
          const cfg = getQuoteStatusConfig(q.quote_status);
          return (
            <li
              key={q.id}
              className="flex items-center justify-between gap-3 px-2 py-1.5 bg-white rounded border border-blue-50"
            >
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="font-medium text-gray-900 text-sm">
                  {q.quote_label || `#${q.pennylane_quote_id}`}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ color: cfg.color, backgroundColor: cfg.bgColor }}
                >
                  {cfg.label}
                </span>
                {q.is_winning_quote && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium inline-flex items-center gap-0.5">
                    <Trophy className="w-3 h-3" />
                    Gagnant
                  </span>
                )}
                {q.quote_date && (
                  <span className="text-xs text-gray-500">
                    {formatDateShortFR(q.quote_date)}
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
