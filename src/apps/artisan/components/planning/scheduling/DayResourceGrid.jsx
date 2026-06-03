/**
 * DayResourceGrid.jsx - Majord'home Artisan
 * ============================================================================
 * Vue JOUR avec une colonne PAR MEMBRE (technicien ou commercial).
 * Évolution CSS-grid de MiniWeekCalendar (PAS de FullCalendar) :
 *  - bande semaine en tête (Lun-Ven) pour choisir le jour
 *  - 1 colonne par membre ; blocs occupés filtrés par technician_ids
 *  - hors-horaire grisé via default_availability (memberWorkingHoursForDate)
 *  - blocs "draft" (créneaux en cours) rendus distinctement (bleu plein)
 *  - clic-glisser dans une colonne → onPlaceSlot (durée par drag)
 *  - conflit (tech déjà pris au même horaire) = surbrillance ambre NON bloquante
 *
 * @version 1.0.0 - Bloc B stage 2 (assistant créneaux)
 * ============================================================================
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { getAppointmentTypeConfig } from '@services/appointments.service';
import { formatDateForInput } from '@/lib/utils';
import { findTechnicianConflicts, memberWorkingHoursForDate, timeToMinutes } from '@/lib/scheduleConflicts';

// ============================================================================
// CONSTANTES
// ============================================================================

/** Heures affichées : 07h-19h (même range que Planning.jsx / MiniWeekCalendar) */
const START_HOUR = 7;
const END_HOUR = 19;
const SLOT_MINUTES = 30;
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * (60 / SLOT_MINUTES); // 24 créneaux
const SLOT_HEIGHT = 20; // px par créneau de 30 min

const WEEK_DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
const WEEK_DAYS_COUNT = 5;

// ============================================================================
// HELPERS
// ============================================================================

const formatDate = formatDateForInput;

/** Lundi de la semaine d'une date donnée. */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** HH:MM -> index de créneau (0-based, peut être < 0 si avant START_HOUR). */
function timeToSlotIndex(timeStr) {
  if (!timeStr) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  return Math.floor((h * 60 + m - START_HOUR * 60) / SLOT_MINUTES);
}

/** index de créneau -> HH:MM. */
function slotIndexToTime(index) {
  const totalMin = START_HOUR * 60 + index * SLOT_MINUTES;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Libellé long du jour : "Mardi 9 juin". */
function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ============================================================================
// COMPOSANT
// ============================================================================

/**
 * @param {Object} props
 * @param {string} props.date - Jour affiché (YYYY-MM-DD)
 * @param {Function} props.onDateChange - (newDate: string) => void
 * @param {Array} props.members - [{ id, display_name, calendar_color, default_availability }]
 * @param {Array} props.dayAppointments - RDV du jour (chacun avec technician_ids)
 * @param {Array} props.draftSlots - créneaux en cours [{ id, date, startTime, endTime, technicianIds }]
 * @param {Function} props.onPlaceSlot - ({ memberId, date, startTime, endTime, duration }) => void
 */
export function DayResourceGrid({
  date,
  onDateChange,
  members = [],
  dayAppointments = [],
  draftSlots = [],
  onPlaceSlot,
}) {
  const todayStr = formatDate(new Date());
  // État du drag : { memberId, startIndex, currentIndex }
  const [dragState, setDragState] = useState(null);

  // --- Bande semaine (Lun-Ven) ---
  const monday = useMemo(() => getMonday(date ? new Date(date + 'T00:00:00') : new Date()), [date]);
  const weekDays = useMemo(() => {
    const result = [];
    for (let i = 0; i < WEEK_DAYS_COUNT; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = formatDate(d);
      result.push({ date: ds, dayNum: d.getDate(), label: WEEK_DAY_LABELS[i], isToday: ds === todayStr });
    }
    return result;
  }, [monday, todayStr]);

  // --- Labels horaires ---
  const slotLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      labels.push({ index: i, time: slotIndexToTime(i), label: i % 2 === 0 ? slotIndexToTime(i) : '' });
    }
    return labels;
  }, []);

  // --- Blocs occupés par membre (avec index de début + nb de créneaux) ---
  // Map<memberId, Array<{ startIdx, slotCount, color, subject }>>
  const blocksByMember = useMemo(() => {
    const map = new Map();
    members.forEach((m) => map.set(m.id, []));
    (dayAppointments || []).forEach((apt) => {
      if (apt.scheduled_date !== date) return;
      if (apt.status === 'cancelled' || apt.status === 'no_show') return;
      const startIdx = timeToSlotIndex(apt.scheduled_start);
      if (startIdx < 0 || startIdx >= TOTAL_SLOTS) return;
      const duration = apt.duration_minutes || 60;
      const slotCount = Math.max(1, Math.ceil(duration / SLOT_MINUTES));
      const cfg = getAppointmentTypeConfig(apt.appointment_type);
      (apt.technician_ids || []).forEach((tid) => {
        if (!map.has(tid)) return;
        map.get(tid).push({
          startIdx,
          slotCount,
          color: cfg.color,
          label: apt.subject || cfg.label,
        });
      });
    });
    return map;
  }, [members, dayAppointments, date]);

  // --- Blocs draft par membre (créneaux en construction du jour courant) ---
  // Map<memberId, Array<{ startIdx, slotCount, conflict }>>
  const draftsByMember = useMemo(() => {
    const map = new Map();
    members.forEach((m) => map.set(m.id, []));
    (draftSlots || []).forEach((slot) => {
      if (slot.date !== date) return;
      const startIdx = timeToSlotIndex(slot.startTime);
      if (startIdx < 0 || startIdx >= TOTAL_SLOTS) return;
      const sMin = timeToMinutes(slot.startTime);
      const eMin = timeToMinutes(slot.endTime) ?? (sMin + (slot.duration || SLOT_MINUTES));
      const slotCount = Math.max(1, Math.ceil((eMin - sMin) / SLOT_MINUTES));
      const endTime = slot.endTime || slotIndexToTime(startIdx + slotCount);
      (slot.technicianIds || []).forEach((tid) => {
        if (!map.has(tid)) return;
        const conflict = findTechnicianConflicts(
          { date: slot.date, startTime: slot.startTime, endTime },
          tid,
          dayAppointments,
        ).length > 0;
        map.get(tid).push({ startIdx, slotCount, conflict });
      });
    });
    return map;
  }, [members, draftSlots, date, dayAppointments]);

  // --- Plage de travail (off-hours) par membre ---
  const hoursByMember = useMemo(() => {
    const map = new Map();
    members.forEach((m) => map.set(m.id, memberWorkingHoursForDate(m, date)));
    return map;
  }, [members, date]);

  const isOffHour = useCallback((memberId, slotIndex) => {
    const hours = hoursByMember.get(memberId);
    if (!hours) return true; // jour off complet
    const slotStartMin = START_HOUR * 60 + slotIndex * SLOT_MINUTES;
    return slotStartMin < timeToMinutes(hours.start) || slotStartMin >= timeToMinutes(hours.end);
  }, [hoursByMember]);

  // Un créneau est-il occupé (pour bloquer le drag à travers) ?
  const isOccupied = useCallback((memberId, slotIndex) => {
    const blocks = blocksByMember.get(memberId) || [];
    return blocks.some((b) => slotIndex >= b.startIdx && slotIndex < b.startIdx + b.slotCount);
  }, [blocksByMember]);

  // --- Navigation jour (saute les week-ends : semaine Lun-Ven) ---
  const shiftDay = useCallback((delta) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    // Si on tombe sur un week-end, continuer dans le sens du déplacement
    // jusqu'au prochain jour ouvré (vendredi en arrière, lundi en avant).
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + (delta >= 0 ? 1 : -1));
    }
    onDateChange(formatDate(d));
  }, [date, onDateChange]);

  const goToToday = useCallback(() => {
    const d = new Date();
    const dow = d.getDay();
    if (dow === 6) d.setDate(d.getDate() + 2); // samedi → lundi
    else if (dow === 0) d.setDate(d.getDate() + 1); // dimanche → lundi
    onDateChange(formatDate(d));
  }, [onDateChange]);

  // --- Drag handlers (par colonne membre) ---
  const handleSlotMouseDown = useCallback((e, memberId, slotIndex) => {
    e.preventDefault();
    if (isOccupied(memberId, slotIndex)) return; // pas d'amorce sur un bloc occupé
    setDragState({ memberId, startIndex: slotIndex, currentIndex: slotIndex });
  }, [isOccupied]);

  const handleSlotMouseEnter = useCallback((memberId, slotIndex) => {
    if (!dragState) return;
    if (memberId !== dragState.memberId) return; // même colonne uniquement
    if (slotIndex <= dragState.startIndex) return; // vers le bas uniquement
    // Bloquer l'extension à travers un créneau occupé (on s'arrête au bord)
    for (let i = dragState.startIndex + 1; i <= slotIndex; i++) {
      if (isOccupied(memberId, i)) return;
    }
    setDragState((prev) => ({ ...prev, currentIndex: slotIndex }));
  }, [dragState, isOccupied]);

  const handleDragEnd = useCallback(() => {
    if (!dragState) return;
    const numSlots = dragState.currentIndex - dragState.startIndex + 1;
    const duration = numSlots * SLOT_MINUTES;
    const startTime = slotIndexToTime(dragState.startIndex);
    const endTime = slotIndexToTime(dragState.currentIndex + 1);
    onPlaceSlot?.({ memberId: dragState.memberId, date, startTime, endTime, duration });
    setDragState(null);
  }, [dragState, date, onPlaceSlot]);

  // Listener global mouseup (finalise même hors grille)
  useEffect(() => {
    if (!dragState) return;
    const onGlobalMouseUp = () => handleDragEnd();
    window.addEventListener('mouseup', onGlobalMouseUp);
    return () => window.removeEventListener('mouseup', onGlobalMouseUp);
  }, [dragState, handleDragEnd]);

  const gridTemplateColumns = `40px repeat(${Math.max(members.length, 1)}, minmax(96px, 1fr))`;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Bande semaine + navigation jour */}
      <div className="flex items-center justify-between px-2 py-2 bg-gray-50 border-b gap-1">
        <button
          type="button"
          onClick={() => shiftDay(-1)}
          className="p-1 rounded hover:bg-gray-200 transition-colors shrink-0"
          title="Jour précédent"
        >
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>

        <div className="flex items-center gap-1 flex-1 justify-center">
          {weekDays.map((d) => (
            <button
              key={d.date}
              type="button"
              onClick={() => onDateChange(d.date)}
              className={`flex flex-col items-center px-1.5 py-1 rounded-lg transition-colors min-w-[36px] ${
                d.date === date
                  ? 'bg-blue-600 text-white'
                  : d.isToday
                  ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span className="text-[10px] leading-none">{d.label}</span>
              <span className="text-sm font-semibold leading-tight">{d.dayNum}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={goToToday}
            className="text-xs text-blue-600 hover:text-blue-800 px-1.5 py-1"
          >
            Auj.
          </button>
          <button
            type="button"
            onClick={() => shiftDay(1)}
            className="p-1 rounded hover:bg-gray-200 transition-colors"
            title="Jour suivant"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Libellé du jour sélectionné */}
      <div className="px-3 py-1.5 bg-white border-b text-xs font-medium text-gray-700 capitalize">
        {date ? formatDayLabel(date) : '—'}
      </div>

      {members.length === 0 ? (
        <div className="px-3 py-8 text-center text-sm text-gray-400">Aucun membre assignable</div>
      ) : (
        <div className="overflow-x-auto">
          <div className={`grid ${dragState ? 'select-none' : ''}`} style={{ gridTemplateColumns }}>
            {/* Header colonnes membres */}
            <div className="border-b border-r bg-gray-50" />
            {members.map((m) => (
              <div key={m.id} className="border-b border-r bg-gray-50 px-1 py-1.5 text-center" title={m.display_name}>
                <div className="flex items-center justify-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: m.calendar_color || '#6B7280' }}
                  />
                  <span className="text-xs font-medium text-gray-700 truncate">{m.display_name}</span>
                </div>
              </div>
            ))}

            {/* Lignes de créneaux */}
            {slotLabels.map((slot) => (
              <div key={`row-${slot.index}`} className="contents">
                {/* Label heure */}
                <div
                  className="border-r border-b px-1 flex items-start justify-end"
                  style={{ height: `${SLOT_HEIGHT}px` }}
                >
                  <span className="text-[10px] text-gray-400 -mt-1.5 select-none">{slot.label}</span>
                </div>

                {/* Cellules par membre */}
                {members.map((m) => {
                  const off = isOffHour(m.id, slot.index);
                  const occupied = isOccupied(m.id, slot.index);
                  const inDrag = dragState
                    && dragState.memberId === m.id
                    && slot.index >= dragState.startIndex
                    && slot.index <= dragState.currentIndex;

                  // Bloc occupé démarrant sur ce créneau
                  const busyBlock = (blocksByMember.get(m.id) || []).find((b) => b.startIdx === slot.index);
                  // Bloc draft démarrant sur ce créneau
                  const draftBlock = (draftsByMember.get(m.id) || []).find((b) => b.startIdx === slot.index);

                  let cellClass = 'border-b border-r relative transition-colors';
                  if (occupied) cellClass += ' cursor-default';
                  else if (inDrag) cellClass += ' bg-blue-200 cursor-row-resize';
                  else if (off) cellClass += ' bg-gray-100 hover:bg-blue-50/60 cursor-pointer';
                  else cellClass += ' hover:bg-blue-50 cursor-pointer';

                  return (
                    <div
                      key={`${m.id}-${slot.index}`}
                      onMouseDown={(e) => handleSlotMouseDown(e, m.id, slot.index)}
                      onMouseEnter={() => handleSlotMouseEnter(m.id, slot.index)}
                      onMouseUp={handleDragEnd}
                      className={cellClass}
                      style={{ height: `${SLOT_HEIGHT}px` }}
                      title={off ? 'Hors horaires' : slot.time}
                    >
                      {/* Bloc occupé (rendu sur la cellule de début, hauteur = nb créneaux) */}
                      {busyBlock && (
                        <div
                          className="absolute inset-x-0.5 top-0.5 rounded-sm px-1 overflow-hidden pointer-events-none z-10 opacity-80"
                          style={{
                            height: `${busyBlock.slotCount * SLOT_HEIGHT - 4}px`,
                            backgroundColor: busyBlock.color,
                          }}
                        >
                          <span className="text-[9px] text-white font-medium leading-tight line-clamp-2">
                            {busyBlock.label}
                          </span>
                        </div>
                      )}

                      {/* Bloc draft (bleu plein, ambre si conflit) */}
                      {draftBlock && (
                        <div
                          className={`absolute inset-x-0.5 top-0.5 rounded-sm px-1 flex items-center gap-0.5 pointer-events-none z-20 border ${
                            draftBlock.conflict
                              ? 'bg-amber-400 border-amber-600'
                              : 'bg-blue-500 border-blue-700'
                          }`}
                          style={{ height: `${draftBlock.slotCount * SLOT_HEIGHT - 4}px` }}
                        >
                          {draftBlock.conflict && <AlertTriangle className="w-2.5 h-2.5 text-amber-900 shrink-0" />}
                          <span className={`text-[9px] font-semibold leading-tight ${draftBlock.conflict ? 'text-amber-900' : 'text-white'}`}>
                            {slotIndexToTime(draftBlock.startIdx)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Légende */}
      <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-blue-500 rounded-sm" />
          Créneau à planifier
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-gray-300 rounded-sm opacity-70" />
          Occupé
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-amber-400 rounded-sm" />
          Conflit (planif. quand même)
        </span>
        <span className="text-gray-400 italic">Cliquer-glisser dans une colonne</span>
      </div>
    </div>
  );
}

export default DayResourceGrid;
