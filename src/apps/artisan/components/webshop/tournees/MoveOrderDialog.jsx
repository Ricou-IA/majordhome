/**
 * MoveOrderDialog.jsx — Déplacer (ou planifier) une commande sur une tournée du même secteur
 * ============================================================================
 * Liste les tournées à venir du secteur de la commande (ouvertes ou fermées, pas
 * annulées). Une tournée sans place reste affichée, grisée, avec la raison ; la base
 * re-vérifie tout (`webshop_order_move_slot`) et refuse en clair si besoin.
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useWebshopSlots, useWebshopTourMutations } from '@hooks/useWebshopTournees';
import { moveTargets, slotStatusLabel, tourneeErrorMessage, todayParis } from '@/lib/webshop/tournees';
import { UPCOMING_RANGE, formatSlotDate } from './tourneesUi';

export default function MoveOrderDialog({ order, open, onOpenChange, onMoved }) {
  const [targetId, setTargetId] = useState(null);
  const range = UPCOMING_RANGE();
  const { data: slots = [], isLoading } = useWebshopSlots(range);
  const { moveOrder } = useWebshopTourMutations();

  const targets = useMemo(
    () => (order ? moveTargets({ slots, order, today: todayParis() }) : []),
    [slots, order],
  );

  const handleConfirm = async () => {
    if (!targetId) return;
    try {
      await moveOrder.mutateAsync({ orderId: order.id, targetSlotId: targetId });
      const target = targets.find((x) => x.slot.id === targetId)?.slot;
      toast.success(`${order.order_number} → tournée du ${formatSlotDate(target?.delivery_date)}`);
      setTargetId(null);
      onOpenChange(false);
      onMoved?.();
    } catch (err) {
      toast.error(tourneeErrorMessage(err));
    }
  };

  if (!order) return null;
  const verb = order.delivery_slot_id ? 'Déplacer' : 'Planifier';

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(v) => { if (!v) setTargetId(null); onOpenChange(v); }}
      title={`${verb} la commande ${order.order_number}`}
      description={`${order.first_name ?? ''} ${order.last_name ?? ''} · ${order.pallet_slots} emplacement${order.pallet_slots > 1 ? 's' : ''} palette. Seules les tournées du même secteur sont proposées.`}
      confirmLabel={verb}
      variant="default"
      size="lg"
      onConfirm={handleConfirm}
      loading={moveOrder.isPending}
      confirmDisabled={!targetId}
    >
      <div className="mt-4 max-h-80 overflow-y-auto space-y-1.5">
        {isLoading && <p className="text-sm text-secondary-500">Chargement des tournées…</p>}
        {!isLoading && targets.length === 0 && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            Aucune tournée à venir dans ce secteur.
          </p>
        )}
        {targets.map(({ slot, fits, reason }) => (
          <label
            key={slot.id}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
              targetId === slot.id ? 'border-primary-500 bg-primary-50' : 'border-secondary-200 hover:bg-secondary-50'
            } ${fits ? '' : 'opacity-60'}`}
          >
            <input
              type="radio"
              name="target-slot"
              checked={targetId === slot.id}
              onChange={() => setTargetId(slot.id)}
              className="text-primary-600 focus:ring-primary-500"
            />
            <span className="font-medium text-secondary-900 w-40">{formatSlotDate(slot.delivery_date)}</span>
            <span className="text-secondary-500 flex-1">{slotStatusLabel(slot)}</span>
            <span className="tabular-nums text-secondary-700">
              {slot.used_slots}/{slot.capacity_slots} empl. · {slot.used_stops}/{slot.capacity_stops} arrêts
            </span>
            {reason && <span className="text-xs text-amber-700">{reason}</span>}
          </label>
        ))}
      </div>
    </ConfirmDialog>
  );
}
