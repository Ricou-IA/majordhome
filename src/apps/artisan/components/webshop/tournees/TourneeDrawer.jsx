/**
 * TourneeDrawer.jsx — Détail d'une tournée de livraison palettes (panneau latéral)
 * ============================================================================
 * Remplissage, état de la feuille de route, commandes rattachées (déplaçables) et
 * gestes : envoyer au transporteur, télécharger la feuille, fermer / rouvrir, annuler.
 * Les gestes sont réservés aux chefs d'équipe et admins (garde en base, bouton masqué
 * ici pour les autres).
 * ============================================================================
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { X, Send, Download, Lock, LockOpen, Ban, Loader2, Package, Truck, PackageCheck } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useWebshopSlotOrders, useWebshopTourMutations } from '@hooks/useWebshopTournees';
import { dateLongFR, isCountedOrder, clientsAPrevenir, resumeTourneeEvent, peutMarquerPartie, peutMarquerLivree, peutRouvrir, slotStatusLabel, tourneeErrorMessage, todayParis } from '@/lib/webshop/tournees';
import { buildWebshopConfig } from '@/lib/webshop/reglages';
import { SlotStatusBadge, FillGauge } from './tourneesUi';
import TourOrderCard from './TourOrderCard';
import SendStatus from './SendStatus';
import MoveOrderDialog from './MoveOrderDialog';
import { telechargerFeuilleDeRoute } from './routeSheetExport';

/** Texte de confirmation : combien de commandes préviennent leur client (jamais plus que ce qui partira). */
function evenementDescription(event, { total, sansEmail }, gabarit) {
  const carte = event === 'livree' ? 'passeront en « Livrée »' : 'passeront en « Expédiée »';
  const cartes = `Les commandes 100 % palette ${carte} ; les commandes mixtes ne sont pas déplacées.`;
  if (!gabarit) return `Aucun e-mail client n'est réglé pour cet événement (Réglages webshop → Process) : personne ne sera prévenu. ${cartes}`;
  if (total === 0) return `Aucun client à prévenir sur cette tournée. ${cartes}`;
  const n = `${total} commande${total > 1 ? 's' : ''} : les clients seront prévenus`;
  const sans = sansEmail > 0 ? ` (dont ${sansEmail} sans e-mail : ${sansEmail > 1 ? 'ils ne recevront rien' : 'il ne recevra rien'})` : '';
  return `${n} par e-mail${sans}. ${cartes} Un e-mail déjà envoyé ne repart jamais.`;
}

export default function TourneeDrawer({ slot, sector, onClose }) {
  const { isTeamLeaderOrAbove } = useAuth();
  const { settings } = useOrgSettings();
  const cfg = buildWebshopConfig(settings);
  const { data, isLoading } = useWebshopSlotOrders(slot.id);
  const { setStatus, cancel, sendRouteSheet, markEvent } = useWebshopTourMutations();
  const [confirm, setConfirm] = useState(null); // 'send' | 'close' | 'cancel' | 'partie' | 'livree'
  const [note, setNote] = useState('');
  const [moving, setMoving] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const orders = (data?.orders || []).filter(isCountedOrder);
  const uncounted = (data?.orders || []).length - orders.length;
  const items = data?.items || [];
  // Une tournée passée se consulte, elle ne se pilote plus.
  const active = (slot.status === 'open' || slot.status === 'closed') && slot.delivery_date >= todayParis();
  const canReopen = peutRouvrir(slot, todayParis());

  const canMarkDeparted = peutMarquerPartie(slot);
  const canMarkDelivered = peutMarquerLivree(slot);
  const eventEvent = confirm === 'livree' ? 'livree' : 'partie';
  const clients = clientsAPrevenir({ orders: data?.orders, items });
  const gabaritEvent = cfg.process?.tournee?.[eventEvent]?.email_client;

  const closeConfirm = () => { setConfirm(null); setNote(''); };

  const run = async (fn, success) => {
    try {
      const res = await fn();
      toast.success(typeof success === 'function' ? success(res) : success);
      closeConfirm();
    } catch (err) {
      toast.error(tourneeErrorMessage(err));
    }
  };

  // Bilan de l'événement : warning dès qu'un e-mail n'est pas parti, jamais un succès dans ce cas.
  const runEvent = async (event) => {
    try {
      const res = await markEvent.mutateAsync({ slotId: slot.id, event });
      const { tone, message } = resumeTourneeEvent(event, res);
      if (tone === 'warning') toast.warning(message); else toast.success(message);
      closeConfirm();
    } catch (err) {
      toast.error(tourneeErrorMessage(err));
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await telechargerFeuilleDeRoute({ slot, sector, orders, items, settings });
    } catch (err) {
      toast.error(`Feuille de route : ${err?.message ?? 'échec de la génération'}`);
    } finally {
      setDownloading(false);
    }
  };

  const busy = setStatus.isPending || cancel.isPending || sendRouteSheet.isPending || markEvent.isPending;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-white shadow-xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-secondary-200 bg-secondary-50">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-secondary-900 first-letter:uppercase">{dateLongFR(slot.delivery_date)}</h3>
            <p className="text-sm text-secondary-500">{sector?.label ?? 'Secteur inconnu'} · {slotStatusLabel(slot)}</p>
            {slot.status_note && <p className="text-xs text-amber-800 mt-0.5">Motif : {slot.status_note}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-secondary-500 hover:bg-secondary-200" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="flex items-center gap-6">
            <SlotStatusBadge slot={slot} />
            <FillGauge used={slot.used_slots} capacity={slot.capacity_slots} label="emplacements" />
            <FillGauge used={slot.used_stops} capacity={slot.capacity_stops} label="arrêts" />
          </div>
          <SendStatus slot={slot} />

          <div className="flex flex-wrap gap-2">
            {isTeamLeaderOrAbove && active && (
              <button type="button" disabled={busy || orders.length === 0} onClick={() => setConfirm('send')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40 rounded-lg"
                title={orders.length === 0 ? 'Aucune commande à livrer' : undefined}>
                <Send className="w-4 h-4" /> {slot.route_sheet_sent_at ? 'Renvoyer au transporteur' : 'Envoyer au transporteur'}
              </button>
            )}
            <button type="button" disabled={downloading || orders.length === 0} onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-secondary-700 bg-white border border-secondary-300 hover:bg-secondary-50 disabled:opacity-40 rounded-lg">
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Feuille de route (PDF)
            </button>
            {isTeamLeaderOrAbove && slot.status === 'open' && (
              <button type="button" disabled={busy} onClick={() => setConfirm('close')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-secondary-700 bg-white border border-secondary-300 hover:bg-secondary-50 rounded-lg">
                <Lock className="w-4 h-4" /> Fermer
              </button>
            )}
            {isTeamLeaderOrAbove && canMarkDeparted && (
              <button type="button" disabled={busy} onClick={() => setConfirm('partie')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40 rounded-lg">
                <Truck className="w-4 h-4" /> Marquer partie
              </button>
            )}
            {isTeamLeaderOrAbove && canMarkDelivered && (
              <button type="button" disabled={busy} onClick={() => setConfirm('livree')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40 rounded-lg">
                <PackageCheck className="w-4 h-4" /> Marquer livrée
              </button>
            )}
            {isTeamLeaderOrAbove && canReopen && (
              <button type="button" disabled={busy}
                onClick={() => run(() => setStatus.mutateAsync({ slotId: slot.id, status: 'open' }), 'Tournée rouverte à la réservation')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-secondary-700 bg-white border border-secondary-300 hover:bg-secondary-50 rounded-lg">
                <LockOpen className="w-4 h-4" /> Rouvrir
              </button>
            )}
            {isTeamLeaderOrAbove && active && (
              <button type="button" disabled={busy} onClick={() => setConfirm('cancel')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-800 bg-white border border-amber-300 hover:bg-amber-50 rounded-lg">
                <Ban className="w-4 h-4" /> Annuler la tournée
              </button>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-400 mb-2">
              Commandes ({orders.length})
            </h4>
            {isLoading ? (
              <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
            ) : orders.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-secondary-200 rounded-lg">
                <Package className="w-8 h-8 text-secondary-300 mx-auto mb-2" />
                <p className="text-sm text-secondary-500">Aucune commande sur cette tournée</p>
              </div>
            ) : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <TourOrderCard key={o.id} order={o} items={items} canManage={isTeamLeaderOrAbove && active} onMove={setMoving} />
                ))}
              </div>
            )}
            {uncounted > 0 && (
              <p className="mt-2 text-xs text-secondary-400">
                {uncounted} commande{uncounted > 1 ? 's' : ''} annulée{uncounted > 1 ? 's' : ''} ou non payée{uncounted > 1 ? 's' : ''} rattachée{uncounted > 1 ? 's' : ''}, non comptée{uncounted > 1 ? 's' : ''}.
              </p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'send'}
        onOpenChange={(v) => !v && closeConfirm()}
        title="Envoyer la feuille de route au transporteur ?"
        description={`La tournée sera fermée à la réservation et la feuille de route (${orders.length} commande${orders.length > 1 ? 's' : ''}) partira tout de suite par e-mail au transporteur et à l'adresse interne. Les autres tournées déjà fermées et pas encore envoyées partent avec.`}
        confirmLabel="Envoyer"
        variant="default"
        loading={sendRouteSheet.isPending}
        onConfirm={() => run(() => sendRouteSheet.mutateAsync({ slotId: slot.id }), (res) => (
          res?.other_pending_slots > 0
            ? `Envoi lancé (+ ${res.other_pending_slots} autre${res.other_pending_slots > 1 ? 's' : ''} tournée${res.other_pending_slots > 1 ? 's' : ''} en attente)`
            : 'Envoi lancé — suivi ci-dessus'))}
      />

      <ConfirmDialog
        open={confirm === 'close'}
        onOpenChange={(v) => !v && closeConfirm()}
        title="Fermer la tournée à la réservation ?"
        description={`Plus aucun client ne pourra la choisir. ${cfg.palette.envoi_auto ? `⚠️ L'envoi automatique de ${cfg.palette.heure_envoi} h envoie la feuille de route de toute tournée fermée : elle partira au transporteur ce soir.` : 'L\'envoi automatique est désactivé : pensez à l\'envoyer au transporteur.'}`}
        confirmLabel="Fermer"
        variant="default"
        loading={setStatus.isPending}
        onConfirm={() => run(() => setStatus.mutateAsync({ slotId: slot.id, status: 'closed', note }), 'Tournée fermée')}
      >
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Motif (facultatif)"
          className="mt-3 w-full text-sm border border-secondary-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(v) => !v && closeConfirm()}
        title="Annuler la tournée ?"
        description={`Les ${orders.length} commande${orders.length > 1 ? 's' : ''} rattachée${orders.length > 1 ? 's' : ''} passeront « à planifier manuellement » : à replacer ensuite sur une autre tournée. Les clients ne sont pas prévenus automatiquement.`}
        confirmLabel="Annuler la tournée"
        cancelLabel="Retour"
        loading={cancel.isPending}
        confirmDisabled={!note.trim()}
        onConfirm={() => run(() => cancel.mutateAsync({ slotId: slot.id, note }), (res) => `Tournée annulée — ${res?.detached_orders ?? 0} commande(s) à replanifier`)}
      >
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Motif (obligatoire) : jour férié, transporteur indisponible…"
          className="mt-3 w-full text-sm border border-secondary-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'partie' || confirm === 'livree'}
        onOpenChange={(v) => !v && closeConfirm()}
        title={eventEvent === 'livree' ? 'Marquer la tournée comme livrée ?' : 'Marquer la tournée comme partie ?'}
        description={evenementDescription(eventEvent, clients, gabaritEvent)}
        confirmLabel={eventEvent === 'livree' ? 'Marquer livrée' : 'Marquer partie'}
        variant="default"
        loading={markEvent.isPending}
        confirmDisabled={isLoading || !data}
        onConfirm={() => runEvent(eventEvent)}
      />

      <MoveOrderDialog order={moving} open={!!moving} onOpenChange={(v) => !v && setMoving(null)} />
    </>
  );
}
