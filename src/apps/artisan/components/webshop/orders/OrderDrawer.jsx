/**
 * OrderDrawer — détail d'une commande : lignes, montants, client, livraison, paiement, suivi.
 * Statut modifiable ici aussi ; annulation = motif obligatoire ; réactivation → Nouvelle.
 * Consigne transporteur (`delivery_instructions`) imprimée sur la feuille de route (onglet Tournées).
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { X, Phone, Mail, MapPin, Building2, Loader2, Truck, CreditCard } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { TextInput, TextArea, FormField, SelectInput } from '@apps/artisan/components/FormFields';
import {
  ORDER_BOARD_COLUMNS, ORDER_STATUS_LABELS, orderLines, orderTotalCents, formatCents, statusPatch,
  reactivationPatch,
} from '@/lib/webshop/orders';
import OrderDeleteButton from '../OrderDeleteButton';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const DELIVERY_LABELS = { delivery: 'Livraison', pickup: 'Retrait' };

function Section({ title, icon: Icon, children }) {
  return (
    <section className="py-4 border-b border-secondary-100">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-secondary-400 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5" />} {title}
      </h3>
      <div className="text-sm text-secondary-700 space-y-1">{children}</div>
    </section>
  );
}

export default function OrderDrawer({ order, onClose, updateOrder, deleteOrder }) {
  const [carrier, setCarrier] = useState(order.carrier ?? '');
  const [tracking, setTracking] = useState(order.tracking_number ?? '');
  const [instructions, setInstructions] = useState(order.delivery_instructions ?? '');
  const [notes, setNotes] = useState(order.internal_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const lines = orderLines(order);
  const followUpDirty = carrier !== (order.carrier ?? '')
    || tracking !== (order.tracking_number ?? '')
    || instructions !== (order.delivery_instructions ?? '')
    || notes !== (order.internal_notes ?? '');

  const run = async (patch, success) => {
    setSaving(true);
    try {
      await updateOrder({ id: order.id, patch });
      toast.success(success);
      return true;
    } catch (err) {
      toast.error(`Modification refusée : ${err.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveFollowUp = () => run({
    carrier: carrier.trim() || null,
    tracking_number: tracking.trim() || null,
    delivery_instructions: instructions.trim() || null,
    internal_notes: notes.trim() || null,
  }, 'Suivi enregistré');

  const changeStatus = (to) => run(statusPatch(order, to), `Commande « ${ORDER_STATUS_LABELS[to]} »`);

  const confirmCancel = async () => {
    const ok = await run({ status: 'annulee', cancel_reason: cancelReason.trim() }, 'Commande annulée');
    if (ok) {
      setCancelOpen(false);
      onClose();
    }
  };

  const confirmReactivate = async () => {
    const patch = reactivationPatch(order);
    const ok = await run(patch, `Commande réactivée (« ${ORDER_STATUS_LABELS[patch.status]} »)`);
    if (ok) setReactivateOpen(false);
  };

  const isCancelled = order.status === 'annulee';
  const isPending = order.status === 'en_attente_paiement';
  const vat = order.vat_breakdown && typeof order.vat_breakdown === 'object' ? Object.entries(order.vat_breakdown) : [];
  const hasSubtotal = order.subtotal_ttc_cents !== null && order.subtotal_ttc_cents !== undefined;

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-6 py-4 border-b border-secondary-200">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">{order.order_number}</h2>
            <p className="text-xs text-secondary-500">Passée le {fmtDate(order.created_at)} · {formatCents(orderTotalCents(order))} TTC</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-secondary-400 hover:text-secondary-700" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-6">
          <div className="py-4 border-b border-secondary-100 flex items-center gap-3">
            {isCancelled || isPending ? (
              <span className="text-sm font-medium text-secondary-600">{ORDER_STATUS_LABELS[order.status]}</span>
            ) : (
              <div className="w-60">
                <SelectInput
                  value={order.status}
                  onChange={(v) => v && v !== order.status && changeStatus(v)}
                  options={ORDER_BOARD_COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
                  disabled={saving}
                />
              </div>
            )}
            {isCancelled && (
              <button type="button" disabled={saving} onClick={() => setReactivateOpen(true)} className="text-sm text-primary-600 hover:underline">Réactiver</button>
            )}
            {!isCancelled && (
              <button type="button" disabled={saving} onClick={() => setCancelOpen(true)} className="ml-auto text-sm text-red-600 hover:underline">Annuler la commande</button>
            )}
          </div>
          {isCancelled && order.cancel_reason && <p className="pt-2 text-xs text-secondary-500">Motif : {order.cancel_reason}</p>}

          <Section title="Articles">
            <table className="w-full text-sm">
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-secondary-50 last:border-0">
                    <td className="py-1 pr-2">
                      {l.name}
                      {l.shippingKind && <span className="text-xs text-secondary-400"> · {l.shippingKind === 'pallet' ? 'palette' : 'colis'}</span>}
                    </td>
                    <td className="py-1 px-2 text-right text-secondary-500 whitespace-nowrap">{l.qty} × {formatCents(l.unitCents ?? 0)}</td>
                    <td className="py-1 pl-2 text-right font-medium whitespace-nowrap">{formatCents(l.totalCents ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasSubtotal && (
              <div className="pt-2 text-xs text-secondary-500 space-y-0.5">
                <p>Sous-total : {formatCents(order.subtotal_ttc_cents)} · Livraison : {formatCents(order.shipping_ttc_cents ?? 0)}</p>
                {vat.length > 0 && <p>TVA : {vat.map(([rate, cents]) => `${rate} % → ${formatCents(cents)}`).join(' · ')}</p>}
              </div>
            )}
            <p className="pt-1 font-semibold text-secondary-900">Total : {formatCents(orderTotalCents(order))} TTC</p>
          </Section>

          <Section title="Client" icon={MapPin}>
            <p className="font-medium">{[order.first_name, order.last_name].filter(Boolean).join(' ')}</p>
            <p>{[order.address, [order.postal_code, order.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</p>
            {order.phone && <p><a href={`tel:${order.phone}`} className="inline-flex items-center gap-1 text-primary-600"><Phone className="w-3.5 h-3.5" />{order.phone}</a></p>}
            {order.email && <p><a href={`mailto:${order.email}`} className="inline-flex items-center gap-1 text-primary-600"><Mail className="w-3.5 h-3.5" />{order.email}</a></p>}
            {order.comments && <p className="italic text-secondary-500">« {order.comments} »</p>}
            {order.lead_id && <p className="text-secondary-500">Lead lié dans le pipeline : {order.lead_name ?? '—'}</p>}
          </Section>

          {order.channel === 'pro' && (
            <Section title="Concessionnaire" icon={Building2}>
              <p className="font-medium">
                {order.company_name}
                {order.company_siret && <span className="text-secondary-500"> — SIRET {order.company_siret}</span>}
              </p>
              <p className="text-secondary-500">{[order.company_contact, order.company_phone, order.company_email].filter(Boolean).join(' · ')}</p>
            </Section>
          )}

          <Section title="Livraison & paiement" icon={CreditCard}>
            {order.pallet_delivery_mode && (
              <p>
                Palette : {DELIVERY_LABELS[order.pallet_delivery_mode] ?? order.pallet_delivery_mode}
                {order.delivery_date && ` le ${fmtDate(order.delivery_date)}`}
                {order.sector_label && ` · secteur ${order.sector_label}`}
              </p>
            )}
            {order.parcel_delivery_mode && <p>Colis : {DELIVERY_LABELS[order.parcel_delivery_mode] ?? order.parcel_delivery_mode}</p>}
            {order.pickup_point_name && <p>Point de retrait : {order.pickup_point_name}</p>}
            {order.needs_manual_planning && <p className="text-amber-700">Livraison à planifier à la main (onglet Tournées)</p>}
            {order.delivery_slot_changed && <p className="text-amber-700">Le créneau a été modifié après la commande</p>}
            <p>Paiement : {order.paid_at ? `reçu le ${fmtDate(order.paid_at)}` : isPending ? 'en attente' : '—'}</p>
            <p className="text-xs text-secondary-400">Expédiée : {fmtDate(order.shipped_at)} · Livrée : {fmtDate(order.delivered_at)}</p>
          </Section>

          <Section title="Suivi" icon={Truck}>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Transporteur"><TextInput value={carrier} onChange={setCarrier} /></FormField>
              <FormField label="N° de suivi"><TextInput value={tracking} onChange={setTracking} /></FormField>
            </div>
            <FormField label="Consigne transporteur (imprimée sur la feuille de route)">
              <TextArea value={instructions} onChange={setInstructions} rows={2} placeholder="Accès, horaires, appeler avant…" />
            </FormField>
            <FormField label="Notes internes (jamais imprimées)">
              <TextArea value={notes} onChange={setNotes} rows={3} placeholder="Fournisseur contacté, particularités…" />
            </FormField>
            <button
              type="button"
              onClick={saveFollowUp}
              disabled={!followUpDirty || saving}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer le suivi
            </button>
          </Section>

          <div className="py-4 flex justify-end">
            <OrderDeleteButton order={order} onDelete={deleteOrder} onDeleted={onClose} />
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Annuler ${order.order_number} ?`}
        description="La commande passe en Annulée et sa place dans la tournée est libérée. Un éventuel remboursement se fait dans Stripe."
        confirmLabel="Annuler la commande"
        confirmDisabled={!cancelReason.trim()}
        loading={saving}
        onConfirm={confirmCancel}
      >
        <FormField label="Motif" required>
          <TextInput value={cancelReason} onChange={setCancelReason} placeholder="Ex. rupture fournisseur, demande du client" />
        </FormField>
      </ConfirmDialog>

      <ConfirmDialog
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        title={`Réactiver ${order.order_number} ?`}
        description={order.paid_at
          ? 'La commande a été payée : elle repart en « Nouvelle ».'
          : 'Aucun paiement reçu : elle repart en « En attente de paiement », pas dans le tableau.'}
        confirmLabel="Réactiver"
        variant="default"
        loading={saving}
        onConfirm={confirmReactivate}
      />
    </div>
  );
}
