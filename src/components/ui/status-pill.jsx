import { cn } from '@lib/utils';
import { TONS } from '@/lib/tonsStatut';

// Classes écrites en toutes lettres : Tailwind ne génère pas une classe construite par interpolation.
const TONS_CLASSES = {
  neutre: { fond: 'bg-st-neutre-bg text-st-neutre', point: 'bg-st-neutre' },
  info: { fond: 'bg-st-info-bg text-st-info', point: 'bg-st-info' },
  ok: { fond: 'bg-st-ok-bg text-st-ok', point: 'bg-st-ok' },
  attente: { fond: 'bg-st-attente-bg text-st-attente', point: 'bg-st-attente' },
  alerte: { fond: 'bg-st-alerte-bg text-st-alerte', point: 'bg-st-alerte' },
};

/**
 * Pastille de statut : point de couleur + mot entier (jamais abrégé, la couleur seule ne dit rien).
 * Le ton vient de `toneFor(domaine, valeur)` (src/lib/tonsStatut.js) ; un ton inconnu se lit « neutre ».
 * `icone` (facultatif) remplace le point par un pictogramme déjà dimensionné.
 */
export function StatusPill({ tone = 'neutre', icone = null, children, className }) {
  const classes = TONS_CLASSES[TONS.includes(tone) ? tone : 'neutre'];
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-semibold',
        classes.fond,
        className,
      )}
    >
      {icone || <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', classes.point)} />}
      {children}
    </span>
  );
}

export default StatusPill;
