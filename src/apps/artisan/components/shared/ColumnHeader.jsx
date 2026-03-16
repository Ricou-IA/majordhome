/**
 * ColumnHeader.jsx — En-tête de colonne Kanban
 * ============================================================================
 * Composant partagé pour les headers de colonnes Kanban.
 * Affiche : pastille couleur + label + count + montant optionnel.
 * ============================================================================
 */

import { formatEuro } from '@/lib/utils';

/**
 * @param {Object} props
 * @param {string} props.label - Nom de la colonne
 * @param {string} props.color - Couleur hex de la pastille
 * @param {number} props.count - Nombre d'éléments dans la colonne
 * @param {number} [props.amount] - Montant total optionnel (affiché en euros)
 * @param {React.ReactNode} [props.extra] - Contenu supplémentaire à droite
 */
export function ColumnHeader({ label, color, count, amount, extra }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-secondary-50 rounded-t-lg border-b border-secondary-200">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm font-medium text-secondary-700 truncate">{label}</span>
        <span className="text-xs font-medium text-secondary-500 bg-secondary-200 rounded-full px-1.5 py-0.5 flex-shrink-0">
          {count}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {amount != null && amount > 0 && (
          <span className="text-xs font-medium text-secondary-500">
            {formatEuro(amount)}
          </span>
        )}
        {extra}
      </div>
    </div>
  );
}
