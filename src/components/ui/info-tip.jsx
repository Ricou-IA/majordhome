import { Info } from 'lucide-react';
import { cn } from '@lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from './popover';

/**
 * Info-bulle (i) : l'aide d'un libellé ou d'un chiffre, jamais en texte permanent (DA § 8).
 * S'ouvre au clic ou au toucher (Radix Popover), se ferme par Échap ou un clic ailleurs.
 */
export function InfoTip({ children, className }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Plus d'informations"
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-secondary-400 transition-colors hover:text-secondary-600 focus-visible:outline-none focus-visible:shadow-ring',
            className,
          )}
        >
          <Info className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        sideOffset={6}
        className="w-auto max-w-xs rounded-lg border border-secondary-200 bg-white p-3 text-body-sm text-secondary-700 shadow-lg"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export default InfoTip;
