/**
 * QuoteSubCard.jsx — Majord'home Artisan (pipeline)
 * ============================================================================
 * Ligne devis dans le bloc expand d'une LeadCard.
 * Affichage compact 1-ligne : date · montant arrondi + lien externe PL.
 *
 * Pas d'icône statut : l'expand filtre déjà par statut pertinent pour la
 * colonne (Gagné = accepted, Devis envoyé = pending, Perdu = refused), donc
 * l'icône est redondante avec le contexte colonne.
 *
 * Pas de numéro de devis : l'espace de la carte Kanban est trop restreint
 * pour l'afficher proprement. Le lien externe (ExternalLink) donne accès au
 * devis Pennylane si le commercial a besoin du détail.
 *
 * Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §7
 * ============================================================================
 */

import { ExternalLink } from 'lucide-react';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

export function QuoteSubCard({ quote }) {
  return (
    <a
      href={`https://app.pennylane.com/quotes/${quote.pennylane_quote_id}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center justify-between gap-2 px-2 py-1 bg-white hover:bg-gray-50 border border-gray-100 rounded text-xs transition-colors"
    >
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
    </a>
  );
}

export default QuoteSubCard;
