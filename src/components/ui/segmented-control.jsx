import { useRef } from 'react';
import { cn } from '@lib/utils';

/**
 * Contrôle segmenté (DA § 7 : 2 à 4 choix exclusifs). Piste `secondary-100`, segment
 * actif blanc avec ombre douce, segments au rayon de 6 px (piste à 8 px, concentrique).
 * Groupe de boutons radio : Tab entre dans le groupe sur le segment choisi, les flèches
 * (et Début / Fin) passent d'un segment à l'autre et le choisissent.
 * Un clic appelle toujours `onChange`, même sur le segment déjà choisi.
 *
 * @param {Object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {Array<{ value: string, label: React.ReactNode, count?: number }>} props.options
 * @param {string} [props.label]  nom du groupe pour les lecteurs d'écran
 */
export function SegmentedControl({ value, onChange, options, label, className }) {
  const refs = useRef([]);
  const indexActif = options.findIndex((o) => o.value === value);

  const choisir = (index) => {
    const option = options[index];
    if (!option) return;
    refs.current[index]?.focus();
    onChange(option.value);
  };

  const onKeyDown = (event, index) => {
    const dernier = options.length - 1;
    let cible = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') cible = index === dernier ? 0 : index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') cible = index === 0 ? dernier : index - 1;
    else if (event.key === 'Home') cible = 0;
    else if (event.key === 'End') cible = dernier;
    if (cible === null) return;
    event.preventDefault();
    choisir(cible);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex items-center rounded-lg bg-secondary-100 p-0.5', className)}
    >
      {options.map((option, index) => {
        const actif = option.value === value;
        // Sans segment choisi, le premier reçoit le focus du Tab.
        const focusable = actif || (indexActif === -1 && index === 0);
        return (
          <button
            key={option.value}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={actif}
            tabIndex={focusable ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'mdh-segment inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-ring',
              actif ? 'bg-white text-secondary-900 shadow-sm' : 'text-secondary-600 hover:text-secondary-900',
            )}
          >
            {option.label}
            {option.count != null && (
              <span className="text-caption tabular-nums text-secondary-500">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
