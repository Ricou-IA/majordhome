import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { Button } from './button';
import { cn } from '@lib/utils';

/**
 * Menu « … » (DA § 6 : une action destructrice n'est jamais collée à l'action principale,
 * elle va dans le menu « … »). Une entrée falsy est ignorée, ce qui permet `[droit && { … }]`.
 * Une entrée `danger` s'écrit en rouge ; c'est son `onClick` qui ouvre la confirmation.
 *
 * @param {Object} props
 * @param {string} [props.libelle]  nom du bouton pour un lecteur d'écran
 * @param {Array<{ label: string, icon?: React.ComponentType, onClick: Function, danger?: boolean, disabled?: boolean }|false|null>} props.actions
 */
export function MenuActions({ libelle = "Plus d'actions", actions = [], className }) {
  const [ouvert, setOuvert] = useState(false);
  const liste = actions.filter(Boolean);
  if (liste.length === 0) return null;

  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={libelle} title={libelle} className={className}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <ul role="menu" aria-label={libelle} className="flex flex-col">
          {liste.map((action) => {
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

export default MenuActions;
