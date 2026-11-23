import { cn } from '@lib/utils';

/**
 * Carte blanche sur fond papier (DA § 4) : rayon 16 px, ombre douce, filet clair.
 * `as` choisit la balise (`section` pour un bloc titré). Présentationnelle.
 */
export function Card({ as: Balise = 'div', className, children, ...props }) {
  return (
    <Balise className={cn('rounded-2xl border border-secondary-200 bg-white shadow-sm', className)} {...props}>
      {children}
    </Balise>
  );
}

/**
 * En-tête de carte : titre (Bricolage 18 px), précision facultative sur une ligne,
 * actions à droite du titre (DA § 6, règle 2). Rembourrage 18 px en haut, 12 px en bas.
 */
export function CardHeader({ title, subtitle, actions, className }) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pb-3 pt-[18px]', className)}>
      <div className="min-w-0">
        <h2 className="font-display text-section text-secondary-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-body-sm text-secondary-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export default Card;
