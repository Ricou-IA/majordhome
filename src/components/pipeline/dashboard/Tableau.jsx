/**
 * Tableau.jsx — briques de présentation des tableaux du Dashboard du pipeline :
 * panneau titré, en-tête, cellule. Dense, sans ombre, chiffres alignés à droite.
 */

import { cn } from '@lib/utils';

/** Panneau blanc à filet, avec titre, précision et zone d'actions à droite. */
export function Panneau({ titre, precision, actions, children, className }) {
  return (
    <section className={cn('overflow-hidden rounded-lg border border-secondary-200 bg-white', className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-secondary-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-secondary-900">{titre}</h2>
          {precision && <p className="mt-0.5 text-xs text-secondary-500">{precision}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Th({ children, gauche = false, className, title }) {
  return (
    <th
      scope="col"
      title={title}
      className={cn(
        'whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-secondary-500',
        gauche ? 'text-left' : 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, gauche = false, className, title }) {
  return (
    <td
      title={title}
      className={cn('whitespace-nowrap px-3 py-2 text-sm tabular-nums text-secondary-800', gauche ? 'text-left' : 'text-right', className)}
    >
      {children}
    </td>
  );
}

/** Message d'un tableau vide. */
export function Vide({ children }) {
  return <p className="px-4 py-8 text-center text-sm text-secondary-500">{children}</p>;
}
