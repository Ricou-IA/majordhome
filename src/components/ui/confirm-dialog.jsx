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

import * as React from 'react';
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
}) {
  const confirmButtonClass = variant === 'destructive'
    ? 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500'
    : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500';

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <AlertDialogPrimitive.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%]',
            'rounded-xl border border-gray-200 bg-white p-6 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          )}
        >
          <AlertDialogPrimitive.Title className="text-lg font-semibold text-gray-900">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-2 text-sm text-gray-500 leading-relaxed">
            {description}
          </AlertDialogPrimitive.Description>

          <div className="mt-6 flex items-center justify-end gap-3">
            <AlertDialogPrimitive.Cancel
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
              disabled={loading}
            >
              {cancelLabel}
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2',
                confirmButtonClass,
              )}
              disabled={loading}
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
