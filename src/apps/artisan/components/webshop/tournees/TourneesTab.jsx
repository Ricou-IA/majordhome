/**
 * TourneesTab.jsx — Onglet Webshop → Tournées (livraison des palettes)
 * ============================================================================
 * - En tête : les commandes payées « à planifier manuellement » (aucune tournée trouvée
 *   au paiement, ou tournée annulée), avec l'action Planifier ;
 * - liste des tournées (à venir sur 120 jours / 30 derniers jours), filtrable par secteur,
 *   avec état, remplissage (emplacements, arrêts) et feuille de route envoyée ou non ;
 * - clic sur une tournée → panneau de détail et gestes (TourneeDrawer).
 * Le moteur (créneaux, réservation, J-2, cron de 17 h) vit côté site : cet écran le pilote.
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { Loader2, RefreshCw, Truck, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useWebshopSectors, useWebshopSlots, useWebshopUnplannedOrders } from '@hooks/useWebshopTournees';
import { UPCOMING_RANGE, RECENT_RANGE, formatSlotDate, formatDateTime, SlotStatusBadge, FillGauge } from './tourneesUi';
import TourneeDrawer from './TourneeDrawer';
import TourOrderCard from './TourOrderCard';
import MoveOrderDialog from './MoveOrderDialog';

const PERIODS = [
  { value: 'upcoming', label: 'À venir' },
  { value: 'recent', label: '30 derniers jours' },
];

function UnplannedOrders({ canManage }) {
  const { data, isLoading } = useWebshopUnplannedOrders();
  const [moving, setMoving] = useState(null);
  const orders = data?.orders || [];
  if (isLoading || orders.length === 0) return null;
  return (
    <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-4">
      <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5 mb-3">
        <AlertTriangle className="w-4 h-4" />
        {orders.length} commande{orders.length > 1 ? 's' : ''} à planifier manuellement
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {orders.map((o) => (
          <TourOrderCard key={o.id} order={o} items={data.items} canManage={canManage} onMove={setMoving} />
        ))}
      </div>
      <MoveOrderDialog order={moving} open={!!moving} onOpenChange={(v) => !v && setMoving(null)} />
    </div>
  );
}

export default function TourneesTab() {
  const { isTeamLeaderOrAbove } = useAuth();
  const [period, setPeriod] = useState('upcoming');
  const [sectorId, setSectorId] = useState('all');
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const range = period === 'upcoming' ? UPCOMING_RANGE() : RECENT_RANGE();
  const { data: sectors = [] } = useWebshopSectors();
  const { data: slots = [], isLoading, refetch, isFetching } = useWebshopSlots(range);

  const sectorById = useMemo(() => new Map(sectors.map((s) => [s.id, s])), [sectors]);
  const visible = useMemo(() => {
    const list = slots
      .filter((s) => sectorId === 'all' || s.sector_id === sectorId)
      .filter((s) => !onlyFilled || s.used_slots > 0);
    return period === 'recent' ? [...list].reverse() : list;
  }, [slots, sectorId, onlyFilled, period]);
  const selected = selectedId ? slots.find((s) => s.id === selectedId) : null;

  return (
    <div className="space-y-4">
      <UnplannedOrders canManage={isTeamLeaderOrAbove} />

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button key={p.value} type="button" onClick={() => setPeriod(p.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              period === p.value ? 'bg-secondary-900 text-white border-secondary-900' : 'bg-white text-secondary-600 border-secondary-200 hover:border-secondary-400'
            }`}>
            {p.label}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-secondary-600 cursor-pointer">
          <input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)}
            className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500" />
          Avec commandes seulement
        </label>
        <div className="ml-auto flex items-center gap-2">
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)}
            className="text-xs border border-secondary-200 rounded-lg px-2.5 py-1.5 bg-white">
            <option value="all">Tous les secteurs</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button type="button" onClick={() => refetch()} title="Rafraîchir"
            className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg">
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 text-primary-600 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 bg-white border border-dashed border-secondary-200 rounded-xl">
          <Truck className="w-10 h-10 text-secondary-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-600">Aucune tournée sur cette période</p>
        </div>
      ) : (
        <div className="bg-white border border-secondary-200 rounded-xl divide-y divide-secondary-100 overflow-hidden">
          {visible.map((slot) => (
            <button key={slot.id} type="button" onClick={() => setSelectedId(slot.id)}
              className={`w-full grid grid-cols-12 gap-3 items-center px-4 py-2.5 text-left hover:bg-secondary-50 transition-colors ${
                slot.used_slots > 0 ? '' : 'text-secondary-500'
              }`}>
              <span className="col-span-2 text-sm font-medium text-secondary-900 first-letter:uppercase">{formatSlotDate(slot.delivery_date)}</span>
              <span className="col-span-3 text-sm truncate">{sectorById.get(slot.sector_id)?.label ?? '—'}</span>
              <span className="col-span-2"><SlotStatusBadge slot={slot} /></span>
              <span className="col-span-2"><FillGauge used={slot.used_slots} capacity={slot.capacity_slots} label="empl." /></span>
              <span className="col-span-1 text-xs tabular-nums text-secondary-600">{slot.used_stops}/{slot.capacity_stops} arr.</span>
              <span className="col-span-2 flex items-center justify-end gap-1.5 text-xs">
                {slot.route_sheet_sent_at ? (
                  <span className="flex items-center gap-1 text-secondary-700" title={`Envoyée le ${formatDateTime(slot.route_sheet_sent_at)}`}>
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" /> Feuille envoyée
                  </span>
                ) : slot.used_slots > 0 && slot.status !== 'cancelled' ? (
                  <span className="text-secondary-400">Feuille à envoyer</span>
                ) : null}
                <ChevronRight className="w-4 h-4 text-secondary-300" />
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <TourneeDrawer slot={selected} sector={sectorById.get(selected.sector_id)} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
