/**
 * InteractionTimeline.jsx - Majord'home Artisan
 * ============================================================================
 * Timeline d'interactions pour un lead MT-LT (chrono inverse).
 * Affichage uniquement — l'ajout est délégué à AddInteractionModal.
 *
 * @version 1.0.0
 * ============================================================================
 */

import { Trash2, ArrowRight, Loader2 } from 'lucide-react';
import { getChannelConfig, formatInteractionDate, formatShortDate } from './longTermUtils';

export function InteractionTimeline({
  interactions = [],
  isLoading = false,
  onDelete,
  isDeletingId = null,
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!interactions.length) {
    return (
      <p className="text-sm text-gray-400 italic py-6 text-center">
        Aucune interaction enregistrée pour ce projet.
      </p>
    );
  }

  return (
    <div className="relative">
      {/* Ligne verticale */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200" />

      <div className="space-y-4">
        {interactions.map((it) => {
          const cfg = getChannelConfig(it.channel);
          const Icon = cfg.icon;
          const isDeleting = isDeletingId === it.id;

          return (
            <div key={it.id} className="relative flex gap-3 pl-1 group">
              {/* Point sur la timeline */}
              <div className={`relative z-10 flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${cfg.color}`}>
                <Icon className="h-4 w-4" />
              </div>

              {/* Contenu */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                    {it.summary}
                  </p>
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(it.id)}
                      disabled={isDeleting}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-red-500 rounded shrink-0"
                      title="Supprimer cette interaction"
                    >
                      {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  )}
                </div>

                {/* Prochaine action */}
                {it.next_action && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded inline-block w-fit">
                    <ArrowRight className="h-3 w-3" />
                    <span>{it.next_action}</span>
                    {it.next_action_date && (
                      <span className="text-blue-500">
                        — {formatShortDate(it.next_action_date)}
                      </span>
                    )}
                  </div>
                )}

                <p className="text-xs text-gray-400 mt-1">
                  {formatInteractionDate(it.created_at)}
                  {it.created_by_name && (
                    <span className="ml-1.5 text-gray-300">— {it.created_by_name}</span>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default InteractionTimeline;
