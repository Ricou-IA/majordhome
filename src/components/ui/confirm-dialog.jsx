/**
 * ConfirmDialog.jsx — Modale de confirmation réutilisable
 * ============================================================================
 * Remplace window.confirm() par un dialog Radix UI accessible et stylé.
 *
 * @example
 * <ConfirmDialog
 *   open={showDelete}
 *   onOpenChange={setShowDelete}
 *   title="Supprimer l'équipement"
 *   description="Cette action est irréversible. L'équipement sera définitivement supprimé."
 *   confirmLabel="Supprimer"
 *   variant="destructive"
 *   onConfirm={handleDelete}
 *   loading={isDeleting}
 * />
 * ============================================================================
 */

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { Loader2 } from 'lucide-react';
import { cn } from '@lib/utils';

export function ConfirmDialog({
  open,
  onOpenChange,
  title = 'Confirmation',
  description = 'Êtes-vous sûr de vouloir continuer ?',
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'destructive', // 'destructive' | 'default'
  onConfirm,
  loading = false,
  confirmDisabled = false, // bloque la confirmation (ex. aperçu en erreur) sans masquer le bouton
  size = 'md', // 'md' (confirmation simple) | 'lg' | 'xl' (contenu éditable : tableau de lignes, aperçu de facture)
  children,
}) {
  const confirmButtonClass = variant === 'destructive'
    ? 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500'
    : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500';
  const sizeClass = { md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size] || 'max-w-md';

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <AlertDialogPrimitive.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-50 w-full translate-x-[-50%] translate-y-[-50%]',
            sizeClass,
            'max-h-[90vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
            // Téléphone (< sm) : feuille ancrée en bas, pleine largeur, zone de sécurité iOS.
            // Un plein écran pour deux lignes de texte laisserait une page vide ; la feuille met
            // les boutons sous le pouce. Bureau et tablette (rendue en 1024 px) inchangés.
            'max-sm:left-0 max-sm:top-auto max-sm:bottom-0 max-sm:translate-x-0 max-sm:translate-y-0',
            'max-sm:max-w-none max-sm:max-h-[90dvh] max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-0',
            'max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]',
            // …et la feuille glisse depuis le bas, pas depuis le haut-gauche du bureau.
            // (`bottom-8` écrase le `top-[48%]` du bureau : même variable, émise après ; ne pas
            // ajouter `slide-*-top-0`, Tailwind l'émettrait APRÈS `bottom-8` et annulerait le glissement.)
            'max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-bottom-8',
            'max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-bottom-8',
          )}
        >
          <AlertDialogPrimitive.Title className="text-lg font-semibold text-gray-900">
            {title}
          </AlertDialogPrimitive.Title>
          {description && (
            <AlertDialogPrimitive.Description className="mt-2 text-sm text-gray-500 leading-relaxed">
              {description}
            </AlertDialogPrimitive.Description>
          )}
          {!description && <AlertDialogPrimitive.Description className="sr-only">Confirmation</AlertDialogPrimitive.Description>}

          {children}

          <div className="mt-6 flex items-center justify-end gap-3">
            <AlertDialogPrimitive.Cancel
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 max-sm:flex-1 max-sm:py-3"
              disabled={loading}
            >
              {cancelLabel}
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2',
                'max-sm:flex-1 max-sm:py-3',
                confirmButtonClass,
              )}
              disabled={loading || confirmDisabled}
              onClick={(e) => {
                // Empêcher la fermeture auto pour gérer le loading
                e.preventDefault();
                onConfirm?.();
              }}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {confirmLabel}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export default ConfirmDialog;
