/**
 * QuoteExplorerCard.jsx — carte d'un devis Pennylane dans l'explorateur.
 * Présentationnel : aucune logique métier, aucun appel réseau.
 */

import { FileText, Link2, Plus, EyeOff, Undo2, ExternalLink } from 'lucide-react';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

export function QuoteExplorerCard({
  row,
  selected = false,
  onToggleSelect,
  onAttach,
  onCreateLead,
  onDismiss,
  onRestore,
}) {
  const isOrphan = row.is_orphan && !row.is_dismissed;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-2">
        {isOrphan && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect?.(row.id); }}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 rounded border-gray-300"
            aria-label={`Sélectionner le devis ${row.quote_number || row.id}`}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm text-secondary-900 truncate">
              {row.customer_name || 'Client inconnu'}
            </p>
            <span className="text-sm font-semibold text-secondary-900 shrink-0">
              {formatEuro(row.amount_ht)}
            </span>
          </div>

          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {row.quote_number || `#${row.id}`}
            {row.date ? ` · ${formatDateShortFR(row.date)}` : ''}
          </p>

          {row.lead_id ? (
            <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">
              <Link2 className="w-3 h-3" />
              {row.lead_name || 'Lead rattaché'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700">
              <FileText className="w-3 h-3" />
              Non rattaché
            </span>
          )}

          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {row.pdf_url ? (
              <a
                href={row.pdf_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
              >
                <ExternalLink className="w-3 h-3" /> PDF
              </a>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-xs text-gray-300 cursor-not-allowed"
                title="PDF non synchronisé (prochain cycle < 15 min)"
              >
                <ExternalLink className="w-3 h-3" /> PDF
              </span>
            )}

            {isOrphan && (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); onAttach?.(row); }}
                  className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-secondary-50 text-secondary-700">
                  <Link2 className="w-3 h-3" /> Rattacher
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onCreateLead?.(row); }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-secondary-50 text-secondary-700">
                  <Plus className="w-3 h-3" /> Créer le lead
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onDismiss?.(row); }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-secondary-50 text-gray-500">
                  <EyeOff className="w-3 h-3" /> Écarter
                </button>
              </>
            )}

            {row.is_dismissed && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onRestore?.(row); }}
                className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-secondary-50 text-secondary-700">
                <Undo2 className="w-3 h-3" /> Réintégrer
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default QuoteExplorerCard;
