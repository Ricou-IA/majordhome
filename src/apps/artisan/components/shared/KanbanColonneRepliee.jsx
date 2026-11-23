/**
 * KanbanColonneRepliee.jsx - Majord'home Artisan
 * ============================================================================
 * Colonne de Kanban repliée (Gagné et Perdu du pipeline des leads) : une bande
 * de 72 px avec la pastille, le nombre de cartes, le titre et le montant, et un
 * bouton « Déplier ». Les cartes n'y sont pas dessinées.
 *
 * Elle reste une zone de dépôt : KanbanBoard la monte dans le même `Droppable`
 * (même `droppableId`) que la colonne dépliée, donc déposer une carte ici
 * produit exactement la même transition. L'emplacement réservé pendant le
 * glisser est rendu dans un conteneur de hauteur nulle : la bande ne grandit
 * pas quand une carte la survole.
 * ============================================================================
 */

import { ChevronsLeftRight } from 'lucide-react';
import { formatEuroCeil, cn } from '@/lib/utils';
import { Tag } from '@/components/ui/tag';

/**
 * @param {Object} props
 * @param {{ id: string, label: string, color?: string }} props.column
 * @param {number} props.count - cartes de la colonne (après la recherche)
 * @param {number|null} props.amount - montant de la colonne, null = pas de montant
 * @param {boolean} props.recherche - une recherche est en cours
 * @param {Function} props.onDeplier
 * @param {Object} [props.droppableProvided] - présent en mode glisser-déposer
 * @param {boolean} [props.isDraggingOver]
 */
export function KanbanColonneRepliee({
  column,
  count,
  amount,
  recherche,
  onDeplier,
  droppableProvided,
  isDraggingOver = false,
}) {
  return (
    <div
      ref={droppableProvided?.innerRef}
      {...(droppableProvided?.droppableProps || {})}
      className={cn(
        'mdh-kanban-repliee flex flex-none w-[72px] flex-col items-center gap-2 rounded-2xl border px-1 py-3 min-h-[160px] transition-colors',
        // Zone de dépôt survolée : même teinte que les autres colonnes (sélection, jamais un statut)
        isDraggingOver ? 'border-primary-300 bg-primary-50' : 'border-transparent bg-secondary-100',
      )}
    >
      <button
        type="button"
        onClick={onDeplier}
        aria-expanded={false}
        aria-label={`Déplier ${column.label}`}
        title={`Déplier ${column.label}`}
        className="p-1.5 rounded-lg text-secondary-500 hover:bg-white hover:text-secondary-800 focus-visible:shadow-ring outline-none transition-colors"
      >
        <ChevronsLeftRight className="h-4 w-4" />
      </button>

      {/* Pastille : la couleur de l'étape, pas un statut */}
      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: column.color }} />
      <Tag className="shrink-0 bg-white tabular-nums">{count}</Tag>
      {recherche && count > 0 && (
        <span className="text-xs font-semibold text-secondary-700 text-center leading-tight">
          trouvé{count > 1 ? 's' : ''}
        </span>
      )}

      <div className="flex min-h-0 flex-col items-center gap-2 [writing-mode:vertical-rl]">
        <h3 className="text-label font-semibold text-secondary-800 whitespace-nowrap">
          {column.label}
        </h3>
        {amount !== null && (
          <p className={cn('text-xs tabular-nums whitespace-nowrap', amount > 0 ? 'text-secondary-500' : 'text-secondary-300')}>
            {formatEuroCeil(amount)}
          </p>
        )}
      </div>

      {droppableProvided && (
        <div aria-hidden="true" className="h-0 w-full overflow-hidden">
          {droppableProvided.placeholder}
        </div>
      )}
    </div>
  );
}

export default KanbanColonneRepliee;
