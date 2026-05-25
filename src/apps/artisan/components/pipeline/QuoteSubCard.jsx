/**
 * QuoteSubCard.jsx — Majord'home Artisan (pipeline)
 * ============================================================================
 * Ligne devis dans le bloc expand d'une LeadCard.
 * Affichage compact 1-ligne : numéro devis · statut · date · montant + lien externe PL.
 * Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §7
 * ============================================================================
 */

import { ExternalLink } from 'lucide-react';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

const QUOTE_STATUS_CONFIG = {
  accepted: { label: '✓', color: '#1d4ed8', bgColor: '#dbeafe' },
  pending: { label: '⏳', color: '#b45309', bgColor: '#fef3c7' },
  draft: { label: '✎', color: '#6b7280', bgColor: '#f3f4f6' },
  denied: { label: '✗', color: '#4b5563', bgColor: '#e5e7eb' },
  refused: { label: '✗', color: '#4b5563', bgColor: '#e5e7eb' },
  expired: { label: '⌛', color: '#4b5563', bgColor: '#e5e7eb' },
  canceled: { label: '⊘', color: '#4b5563', bgColor: '#e5e7eb' },
};

function statusConfig(status) {
  return QUOTE_STATUS_CONFIG[status] || { label: '?', color: '#6b7280', bgColor: '#f3f4f6' };
}

export function QuoteSubCard({ quote }) {
  const cfg = statusConfig(quote.quote_status);
  return (
    <a
      href={`https://app.pennylane.com/quotes/${quote.pennylane_quote_id}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center justify-between gap-2 px-2 py-1 bg-white hover:bg-gray-50 border border-gray-100 rounded text-xs transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0"
          style={{ color: cfg.color, backgroundColor: cfg.bgColor }}
          title={quote.quote_status}
        >
          {cfg.label}
        </span>
        <span className="font-medium text-gray-700 truncate">
          {quote.quote_number_pl || quote.quote_label || `#${quote.pennylane_quote_id}`}
        </span>
        {quote.quote_date && (
          <span className="text-gray-400 shrink-0">{formatDateShortFR(quote.quote_date)}</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="font-semibold text-gray-900">
          {quote.quote_amount_ht != null ? formatEuro(Number(quote.quote_amount_ht)) : '—'}
        </span>
        <ExternalLink className="w-3 h-3 text-gray-400" />
      </div>
    </a>
  );
}

export default QuoteSubCard;
