import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@lib/utils';

const LARGEURS = {
  md: 'sm:max-w-[480px]',
  lg: 'sm:max-w-[640px]',
};

/**
 * Panneau latéral (DA § 10 : « la modification se fait dans un panneau latéral ») collé à
 * droite, plein écran sur téléphone. En-tête titre + fermer, corps qui défile, pied collé en
 * bas avec les actions alignées à droite (« Annuler » discret puis l'action principale).
 * Échap, le voile et la croix appellent `onFermer` : c'est l'appelant qui décide de fermer
 * (il peut d'abord demander une confirmation).
 *
 * @param {Object} props
 * @param {boolean} props.ouvert
 * @param {() => void} props.onFermer
 * @param {React.ReactNode} props.titre
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.pied]
 * @param {'md'|'lg'} [props.largeur]   480 px ou 640 px
 */
export function SidePanel({ ouvert, onFermer, titre, description, pied, largeur = 'md', children }) {
  return (
    <Dialog.Root open={ouvert} onOpenChange={(o) => { if (!o) onFermer(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-secondary-900/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-lg focus:outline-none',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
            LARGEURS[largeur] || LARGEURS.md,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-secondary-200 px-6 py-4">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-section text-secondary-900">{titre}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-body-sm text-secondary-500">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{titre}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-secondary-500 hover:bg-secondary-100 hover:text-secondary-900 focus-visible:shadow-ring focus-visible:outline-none"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {pied && (
            <div className="flex items-center justify-end gap-2 border-t border-secondary-200 bg-secondary-25 px-6 py-3">
              {pied}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default SidePanel;
