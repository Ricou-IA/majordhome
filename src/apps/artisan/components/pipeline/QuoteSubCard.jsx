/**
 * QuoteSubCard.jsx — Majord'home Artisan (pipeline)
 * ============================================================================
 * Ligne devis dans le bloc expand d'une LeadCard.
 * Affichage compact 1-ligne : date · montant arrondi + lien PDF Pennylane.
 *
 * Pas d'icône statut : l'expand filtre déjà par statut pertinent pour la
 * colonne (Gagné = accepted, Devis envoyé = pending, Perdu = refused), donc
 * l'icône est redondante avec le contexte colonne.
 *
 * Pas de numéro de devis : l'espace de la carte Kanban est trop restreint.
 * Le lien externe ouvre directement le PDF Pennylane (q.public_file_url
 * synchronisé en DB via lead_attach_quotes_and_send + cron pennylane-sync-
 * quote-status). Si pdf_url non encore syncé (devis tout neuf, prochain
 * cycle cron < 15 min), le lien est désactivé avec tooltip.
 *
 * Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §7
 * ============================================================================
 */

import { ExternalLink } from 'lucide-react';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

export function QuoteSubCard({ quote }) {
  const baseClass = 'flex items-center justify-between gap-2 px-2 py-1 bg-white border border-gray-100 rounded text-xs transition-colors';
  const content = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        {quote.quote_date && (
          <span className="text-gray-500 shrink-0">{formatDateShortFR(quote.quote_date)}</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="font-semibold text-gray-900">
          {quote.quote_amount_ht != null ? formatEuro(Math.round(Number(quote.quote_amount_ht))) : '—'}
        </span>
        <ExternalLink className="w-3 h-3 text-gray-400" />
      </div>
    </>
  );

  if (!quote.pdf_url) {
    return (
      <div
        className={`${baseClass} opacity-60 cursor-not-allowed`}
        title="PDF non encore synchronisé (prochain cycle de sync sous 15 min)"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
    );
  }

  return (
    <a
      href={quote.pdf_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`${baseClass} hover:bg-gray-50`}
    >
      {content}
    </a>
  );
}

export default QuoteSubCard;
