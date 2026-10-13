/**
 * OrderDeleteButton.jsx — Suppression définitive d'une commande webshop (org_admin)
 * ============================================================================
 * « God mode » : commandes de test, annulations à faire disparaître. RPC
 * `webshop_order_hard_delete` (lignes en cascade, tournée recomptée par trigger).
 * Une commande payée est signalée : supprimer ne rembourse rien (Stripe à part).
 * ============================================================================
 */

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { webshopService } from '@services/webshop.service';

export default function OrderDeleteButton({ order, onDeleted }) {
  const { isOrgAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!isOrgAdmin) return null;

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await webshopService.deleteOrder(order.id);
    setDeleting(false);
    if (error) {
      toast.error(error.message === 'org_admin_required' ? 'Réservé aux administrateurs' : `Suppression impossible : ${error.message}`);
      return;
    }
    toast.success(`Commande ${order.order_number} supprimée`);
    setOpen(false);
    onDeleted?.();
  };

  // La vue lue par Commandes ne porte pas paid_at : le statut suffit (seul le paiement sort de « en attente »).
  const paid = !['en_attente_paiement', 'annulee'].includes(order.status);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" /> Supprimer la commande
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Supprimer la commande ${order.order_number} ?`}
        description={`La commande et ses lignes sont effacées définitivement ; sa place dans la tournée est libérée.${
          paid ? ' ⚠️ Commande payée : la suppression ne rembourse pas le client (remboursement à faire dans Stripe).' : ''
        } Pour garder une trace, préférez le statut « Annulée ».`}
        confirmLabel="Supprimer définitivement"
        variant="destructive"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </>
  );
}
