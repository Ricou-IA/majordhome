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
 * `taille` : 'normale' (24 px) ou 'compacte' (20 px, cartes de Kanban : hauteur uniforme).
 * `icone` (facultatif) remplace le point par un pictogramme déjà dimensionné.
 */
export function StatusPill({ tone = 'neutre', taille = 'normale', icone = null, children, className }) {
  const compacte = taille === 'compacte';
  const classes = TONS_CLASSES[TONS.includes(tone) ? tone : 'neutre'];
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full font-semibold',
        compacte ? 'h-5 gap-1 px-2 text-caption' : 'h-6 gap-1.5 px-2.5 text-[12.5px]',
        classes.fond,
        className,
      )}
    >
      {icone || <span aria-hidden="true" className={cn('shrink-0 rounded-full', compacte ? 'h-[5px] w-[5px]' : 'h-1.5 w-1.5', classes.point)} />}
      {children}
    </span>
  );
}

export default StatusPill;
