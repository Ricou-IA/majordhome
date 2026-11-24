/**
 * squelette.jsx — blocs gris de chargement (brief UX, règle 5 : jamais d'écran blanc, de
 * « … » ni de « Chargement… » sans structure). La forme annonce ce qui arrive : des lignes
 * de liste, ou un nombre à la place d'un compteur.
 */
import { cn } from '@lib/utils';

/** Bloc gris pulsé ; `className` donne la taille (ex. `h-7 w-12` pour un nombre). */
export function Squelette({ className }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded bg-secondary-100', className)} />;
}

/**
 * Lignes d'une liste en cours de chargement.
 * @param {{ nombre?: number, libelle?: string, className?: string }} props
 *   `libelle` est lu par un lecteur d'écran (« Chargement des devis »).
 */
export function LignesSquelette({ nombre = 3, libelle = 'Chargement', className }) {
  return (
    <div role="status" aria-label={libelle} className={cn('space-y-3', className)}>
      {Array.from({ length: nombre }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Squelette className="h-4 w-24 shrink-0" />
          <Squelette className="h-4 flex-1" />
          <Squelette className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default LignesSquelette;
