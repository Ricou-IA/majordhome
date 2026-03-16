/**
 * CardSkeleton.jsx — Skeleton de carte réutilisable
 * ============================================================================
 * Composant skeleton pour les cartes Kanban et listes pendant le chargement.
 * ============================================================================
 */

/**
 * @param {Object} [props]
 * @param {number} [props.lines=3] - Nombre de lignes skeleton
 * @param {string} [props.className] - Classes CSS additionnelles
 */
export function CardSkeleton({ lines = 3, className = '' }) {
  return (
    <div className={`bg-white rounded-lg border border-secondary-200 p-3 animate-pulse ${className}`}>
      <div className="h-4 bg-secondary-200 rounded w-3/4 mb-2" />
      {Array.from({ length: lines - 1 }).map((_, i) => (
        <div
          key={i}
          className="h-3 bg-secondary-100 rounded mb-1.5"
          style={{ width: `${60 + Math.random() * 30}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Grille de skeletons pour une liste/kanban en chargement
 * @param {Object} [props]
 * @param {number} [props.count=6] - Nombre de skeletons
 */
export function CardSkeletonGrid({ count = 6 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} lines={i % 2 === 0 ? 3 : 2} />
      ))}
    </div>
  );
}
