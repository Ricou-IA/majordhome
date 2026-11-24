import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { Button } from './button';
import { cn } from '@lib/utils';

/**
 * Menu « … » (DA § 6 : une action destructrice n'est jamais collée à l'action principale,
 * elle va dans le menu « … »). Une entrée falsy est ignorée, ce qui permet `[droit && { … }]`.
 * Une entrée `danger` s'écrit en rouge ; c'est son `onClick` qui ouvre la confirmation.
 * Une entrée `{ separateur: true }` trace une ligne (actions courantes au-dessus, dangereuses
 * en dessous) ; un séparateur en tête, en fin ou doublé n'est pas dessiné.
 * Le menu s'ouvre au-dessus de toute fenêtre (`z-[90]`, comme les listes) : il sert aussi
 * dans les pieds de fenêtre (RDV, demande).
 *
 * @param {Object} props
 * @param {string} [props.libelle]  nom du bouton pour un lecteur d'écran
 * @param {'start'|'center'|'end'} [props.align]  alignement du menu sur le bouton
 * @param {Array<{ label: string, icon?: React.ComponentType, onClick: Function, danger?: boolean, disabled?: boolean }|{ separateur: true }|false|null>} props.actions
 */
export function MenuActions({ libelle = "Plus d'actions", actions = [], align = 'end', className }) {
  const [ouvert, setOuvert] = useState(false);
  const liste = sansSeparateursInutiles(actions.filter(Boolean));
  if (liste.length === 0) return null;

  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={libelle} title={libelle} className={className}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="z-[90] w-60 p-1">
        <ul role="menu" aria-label={libelle} className="flex flex-col">
          {liste.map((action, i) => {
            if (action.separateur) {
              return <li key={`sep-${i}`} role="separator" className="my-1 h-px bg-secondary-200" />;
            }
            const Icone = action.icon;
            return (
              <li key={action.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => { setOuvert(false); action.onClick?.(); }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-body-sm hover:bg-secondary-100 focus-visible:bg-secondary-100 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
                    action.danger ? 'text-st-alerte' : 'text-secondary-800',
                  )}
                >
                  {Icone && <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  {action.label}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Retire les séparateurs en tête, en fin et en double. */
function sansSeparateursInutiles(liste) {
  const sortie = [];
  for (const entree of liste) {
    if (entree.separateur && (sortie.length === 0 || sortie[sortie.length - 1].separateur)) continue;
    sortie.push(entree);
  }
  while (sortie.length && sortie[sortie.length - 1].separateur) sortie.pop();
  return sortie;
}

export default MenuActions;
