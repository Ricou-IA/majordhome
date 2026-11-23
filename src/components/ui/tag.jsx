import { cn } from '@lib/utils';

/** Étiquette neutre : un attribut (rôle, catégorie, ville), jamais un statut. */
export function Tag({ children, className }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-md bg-secondary-100 px-2 text-caption text-secondary-600',
        className,
      )}
    >
      {children}
    </span>
  );
}

export default Tag;
