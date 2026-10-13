/* eslint-disable react-refresh/only-export-components -- petits éléments d'affichage partagés
   par les composants de l'onglet Tournées (badges, jauges, formatage de date). */
/**
 * tourneesUi.jsx — Éléments d'affichage partagés de l'onglet Webshop → Tournées
 * ============================================================================
 */

import { SLOT_STATUS, todayParis, addDaysIso } from '@/lib/webshop/tournees';

/** Fenêtre « à venir » (partagée par la liste et le dialogue de déplacement → même cache). */
export const UPCOMING_RANGE = () => {
  const today = todayParis();
  return { from: today, to: addDaysIso(today, 120) };
};

/** Fenêtre « récentes » : 30 derniers jours. */
export const RECENT_RANGE = () => {
  const today = todayParis();
  return { from: addDaysIso(today, -30), to: addDaysIso(today, -1) };
};

/** « lun. 2 nov. » */
export function formatSlotDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${iso}T00:00:00Z`));
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const TONES = {
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  slate: 'bg-secondary-100 text-secondary-700 border-secondary-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
};

export function SlotStatusBadge({ slot }) {
  const meta = SLOT_STATUS[slot.status] ?? { label: slot.status, tone: 'slate' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${TONES[meta.tone]}`}>
      {meta.label}
    </span>
  );
}

/** Jauge « 3/10 » — bleu, ambre quand c'est plein (jamais rouge/vert). */
export function FillGauge({ used, capacity, label }) {
  const ratio = capacity > 0 ? Math.min(1, used / capacity) : 0;
  const full = used >= capacity;
  return (
    <div className="min-w-[88px]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={`tabular-nums font-medium ${full ? 'text-amber-700' : 'text-secondary-800'}`}>{used}/{capacity}</span>
        <span className="text-secondary-400">{label}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-secondary-100 overflow-hidden">
        <div className={`h-full rounded-full ${full ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
