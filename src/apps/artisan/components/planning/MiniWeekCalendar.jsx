/**
 * MiniWeekCalendar.jsx - Majord'home Artisan
 * ============================================================================
 * Calendrier semaine léger en CSS Grid.
 * Affiche 6 jours (Lun-Sam) × créneaux 30 min avec les RDV existants.
 * Utilisé dans le SchedulingPanel (pipeline leads) pour visualiser les dispos.
 *
 * PAS de dépendance FullCalendar — pur CSS Grid + Tailwind.
 *
 * Fonctionnalités :
 * - Clic sur un créneau vide = sélection (durée 30 min par défaut)
 * - Clic + glisser vers le bas = étendre la durée (pas de 30 min)
 * - Affichage visuel du bloc sélectionné (plage bleue)
 * - Collision détectée : impossible de glisser à travers un créneau occupé
 *
 * @version 2.0.0 - Sprint 4+ Pipeline → Planning + Drag-to-resize
 * ============================================================================
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getAppointmentTypeConfig } from '@/shared/services/appointments.service';

// ============================================================================
// CONSTANTES
// ============================================================================

/** Heures affichées : 07h-19h (même range que Planning.jsx) */
const START_HOUR = 7;
const END_HOUR = 19;
const SLOT_MINUTES = 30;
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * (60 / SLOT_MINUTES); // 24 créneaux

/** Jours affichés : Lun-Sam */
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAYS_COUNT = 6;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Retourne le lundi de la semaine d'une date donnée
 */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Formate YYYY-MM-DD
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Retourne le numéro de semaine ISO
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/**
 * Convertit HH:MM en index de créneau (0-based)
 */
function timeToSlotIndex(timeStr) {
  if (!timeStr) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  const totalMin = h * 60 + m;
  const startMin = START_HOUR * 60;
  return Math.floor((totalMin - startMin) / SLOT_MINUTES);
}

/**
 * Convertit un index de créneau en HH:MM
 */
function slotIndexToTime(index) {
  const totalMin = START_HOUR * 60 + index * SLOT_MINUTES;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Formate le header de la semaine : "3 - 8 mars"
 */
function formatWeekRange(monday) {
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);

  const dayStart = monday.getDate();
  const daySat = saturday.getDate();
  const monthStart = monday.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
  const monthSat = saturday.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');

  if (monthStart === monthSat) {
    return `${dayStart} - ${daySat} ${monthStart}`;
  }
  return `${dayStart} ${monthStart} - ${daySat} ${monthSat}`;
}

// ============================================================================
// COMPOSANT
// ============================================================================

/**
 * @param {Object} props
 * @param {Date} props.weekStartDate - Lundi de la semaine affichée
 * @param {Array} props.appointments - RDV existants [{scheduled_date, scheduled_start, scheduled_end, appointment_type, duration_minutes}]
 * @param {string} props.selectedDate - Date sélectionnée (YYYY-MM-DD)
 * @param {string} props.selectedTime - Heure sélectionnée (HH:MM)
 * @param {number} [props.selectedDuration=30] - Durée sélectionnée en minutes (pour afficher la plage)
 * @param {Function} props.onSelectSlot - Callback ({date, time, duration}) => void
 * @param {Function} props.onWeekChange - Callback (newMonday: Date) => void
 * @param {string[]} [props.technicianFilter] - IDs techniciens pour filtrer les RDV affichés
 */
export function MiniWeekCalendar({
  weekStartDate,
  appointments = [],
  selectedDate,
  selectedTime,
  selectedDuration = 30,
  onSelectSlot,
  onWeekChange,
  technicianFilter = [],
}) {
  const monday = useMemo(() => getMonday(weekStartDate), [weekStartDate]);
  const weekNum = useMemo(() => getWeekNumber(monday), [monday]);
  const todayStr = formatDate(new Date());
  const gridRef = useRef(null);

  // État du drag (clic + glisser pour étendre la durée)
  const [dragState, setDragState] = useState(null); // { date, startIndex, currentIndex }

  // Générer les jours de la semaine (Lun-Sam)
  const days = useMemo(() => {
    const result = [];
    for (let i = 0; i < DAYS_COUNT; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      result.push({
        date: formatDate(d),
        dayNum: d.getDate(),
        label: DAY_LABELS[i],
        isToday: formatDate(d) === todayStr,
      });
    }
    return result;
  }, [monday, todayStr]);

  // Filtrer les RDV par techniciens sélectionnés et construire une map
  // slotKey "YYYY-MM-DD_slotIndex" → appointment info
  const occupiedSlots = useMemo(() => {
    const map = new Map();

    const filtered = technicianFilter.length > 0
      ? appointments.filter(apt => {
          const techIds = apt.technician_ids || [];
          return techIds.some(id => technicianFilter.includes(id));
        })
      : appointments;

    filtered.forEach(apt => {
      const dateStr = apt.scheduled_date;
      const startSlot = timeToSlotIndex(apt.scheduled_start);
      if (startSlot < 0) return;

      // Calculer le nombre de créneaux occupés
      const duration = apt.duration_minutes || 60;
      const slotCount = Math.ceil(duration / SLOT_MINUTES);
      const typeConfig = getAppointmentTypeConfig(apt.appointment_type);

      for (let s = 0; s < slotCount; s++) {
        const slotIdx = startSlot + s;
        if (slotIdx >= TOTAL_SLOTS) break;
        const key = `${dateStr}_${slotIdx}`;
        map.set(key, {
          color: typeConfig.color,
          subject: apt.subject || typeConfig.label,
          isStart: s === 0,
        });
      }
    });

    return map;
  }, [appointments, technicianFilter]);

  // Créneaux horaires (labels à gauche)
  const slotLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const time = slotIndexToTime(i);
      // Afficher le label uniquement pour les heures pleines
      labels.push({
        index: i,
        time,
        label: i % 2 === 0 ? time : '',
      });
    }
    return labels;
  }, []);

  // Plage sélectionnée (pour le rendu visuel)
  const selectedRange = useMemo(() => {
    if (!selectedDate || !selectedTime) return null;
    const startIdx = timeToSlotIndex(selectedTime);
    if (startIdx < 0) return null;
    const slotCount = Math.max(1, Math.ceil(selectedDuration / SLOT_MINUTES));
    return { date: selectedDate, startIndex: startIdx, endIndex: startIdx + slotCount - 1 };
  }, [selectedDate, selectedTime, selectedDuration]);

  // Navigation semaine
  const goToPrevWeek = useCallback(() => {
    const prev = new Date(monday);
    prev.setDate(prev.getDate() - 7);
    onWeekChange(prev);
  }, [monday, onWeekChange]);

  const goToNextWeek = useCallback(() => {
    const next = new Date(monday);
    next.setDate(next.getDate() + 7);
    onWeekChange(next);
  }, [monday, onWeekChange]);

  const goToThisWeek = useCallback(() => {
    onWeekChange(getMonday(new Date()));
  }, [onWeekChange]);

  // ---- Drag handlers ----

  // Début du drag : mousedown sur un créneau vide
  const handleSlotMouseDown = useCallback((e, date, slotIndex) => {
    e.preventDefault(); // empêche la sélection de texte
    const key = `${date}_${slotIndex}`;
    if (occupiedSlots.has(key)) return;
    if (date < todayStr) return;
    setDragState({ date, startIndex: slotIndex, currentIndex: slotIndex });
  }, [occupiedSlots, todayStr]);

  // Pendant le drag : mouseenter sur un créneau adjacent
  const handleSlotMouseEnter = useCallback((date, slotIndex) => {
    if (!dragState) return;
    if (date !== dragState.date) return; // même jour uniquement
    if (slotIndex <= dragState.startIndex) return; // vers le bas uniquement

    // Vérifier que tous les créneaux entre start et target sont libres
    for (let i = dragState.startIndex + 1; i <= slotIndex; i++) {
      if (occupiedSlots.has(`${date}_${i}`)) return; // bloqué par un créneau occupé
    }

    setDragState(prev => ({ ...prev, currentIndex: slotIndex }));
  }, [dragState, occupiedSlots]);

  // Fin du drag : mouseup → finaliser la sélection
  const handleDragEnd = useCallback(() => {
    if (!dragState) return;
    const numSlots = dragState.currentIndex - dragState.startIndex + 1;
    const duration = numSlots * SLOT_MINUTES;
    onSelectSlot({
      date: dragState.date,
      time: slotIndexToTime(dragState.startIndex),
      duration,
    });
    setDragState(null);
  }, [dragState, onSelectSlot]);

  // Listener global mouseup pour finaliser le drag même hors de la grille
  useEffect(() => {
    if (!dragState) return;
    const onGlobalMouseUp = () => handleDragEnd();
    window.addEventListener('mouseup', onGlobalMouseUp);
    return () => window.removeEventListener('mouseup', onGlobalMouseUp);
  }, [dragState, handleDragEnd]);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Header navigation */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
        <button
          type="button"
          onClick={goToPrevWeek}
          className="p-1 rounded hover:bg-gray-200 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">
            Sem. {weekNum}
          </span>
          <span className="text-xs text-gray-500">
            ({formatWeekRange(monday)})
          </span>
          {formatDate(getMonday(new Date())) !== formatDate(monday) && (
            <button
              type="button"
              onClick={goToThisWeek}
              className="text-xs text-blue-600 hover:text-blue-800 ml-1"
            >
              Auj.
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={goToNextWeek}
          className="p-1 rounded hover:bg-gray-200 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-gray-600" />
        </button>
      </div>

      {/* Grille calendrier */}
      <div className="overflow-x-auto">
        <div
          ref={gridRef}
          className={`grid min-w-[360px] ${dragState ? 'select-none' : ''}`}
          style={{
            gridTemplateColumns: `40px repeat(${DAYS_COUNT}, 1fr)`,
          }}
        >
          {/* Header jours */}
          <div className="border-b border-r bg-gray-50 p-1" />
          {days.map((day) => (
            <div
              key={day.date}
              className={`border-b text-center py-1.5 text-xs font-medium ${
                day.isToday
                  ? 'bg-blue-50 text-blue-700'
                  : selectedDate === day.date
                  ? 'bg-blue-50 text-blue-600'
                  : 'bg-gray-50 text-gray-600'
              }`}
            >
              <div>{day.label}</div>
              <div className={`text-sm font-semibold ${
                day.isToday ? 'bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center mx-auto' : ''
              }`}>
                {day.dayNum}
              </div>
            </div>
          ))}

          {/* Créneaux */}
          {slotLabels.map((slot) => (
            <>
              {/* Label heure */}
              <div
                key={`label-${slot.index}`}
                className="border-r border-b px-1 flex items-start justify-end"
                style={{ height: '20px' }}
              >
                <span className="text-[10px] text-gray-400 -mt-1.5 select-none">
                  {slot.label}
                </span>
              </div>

              {/* Cellules jours */}
              {days.map((day) => {
                const key = `${day.date}_${slot.index}`;
                const occupied = occupiedSlots.get(key);
                const isPast = day.date < todayStr;

                // Vérifier si le créneau est dans la plage drag active
                const isInDrag = dragState &&
                  day.date === dragState.date &&
                  slot.index >= dragState.startIndex &&
                  slot.index <= dragState.currentIndex;

                // Vérifier si le créneau est dans la plage sélectionnée (après confirmation)
                const isInSelected = !dragState && selectedRange &&
                  day.date === selectedRange.date &&
                  slot.index >= selectedRange.startIndex &&
                  slot.index <= selectedRange.endIndex;

                const isStart = isInSelected && slot.index === selectedRange?.startIndex;

                return (
                  <div
                    key={key}
                    onMouseDown={(e) => handleSlotMouseDown(e, day.date, slot.index)}
                    onMouseEnter={() => handleSlotMouseEnter(day.date, slot.index)}
                    onMouseUp={handleDragEnd}
                    className={`border-b border-r transition-colors relative ${
                      occupied
                        ? 'cursor-default'
                        : isPast
                        ? 'cursor-default bg-gray-50'
                        : isInDrag
                        ? 'bg-blue-200'
                        : isInSelected
                        ? 'bg-blue-100'
                        : dragState
                        ? 'cursor-row-resize'
                        : day.isToday
                        ? 'bg-blue-50/30 hover:bg-blue-100/50 cursor-pointer'
                        : 'hover:bg-blue-50 cursor-pointer'
                    }`}
                    style={{ height: '20px' }}
                    title={
                      occupied
                        ? occupied.subject
                        : isPast
                        ? 'Passé'
                        : isInDrag || isInSelected
                        ? `${slot.time} (sélectionné)`
                        : `${day.label} ${day.dayNum} à ${slot.time}`
                    }
                  >
                    {occupied && (
                      <div
                        className={`absolute inset-0.5 rounded-sm ${occupied.isStart ? 'opacity-70' : 'opacity-40'}`}
                        style={{ backgroundColor: occupied.color }}
                      />
                    )}
                    {/* Indicateur début de la plage sélectionnée */}
                    {isStart && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-blue-600 rounded-full" />
                      </div>
                    )}
                    {/* Bordure de la plage sélectionnée */}
                    {isInSelected && (
                      <div className="absolute inset-x-0.5 inset-y-0 border-x-2 border-blue-400 pointer-events-none"
                        style={{
                          borderTop: slot.index === selectedRange.startIndex ? '2px solid rgb(96 165 250)' : 'none',
                          borderBottom: slot.index === selectedRange.endIndex ? '2px solid rgb(96 165 250)' : 'none',
                        }}
                      />
                    )}
                    {/* Bordure de la plage en cours de drag */}
                    {isInDrag && (
                      <div className="absolute inset-x-0.5 inset-y-0 border-x-2 border-blue-500 pointer-events-none"
                        style={{
                          borderTop: slot.index === dragState.startIndex ? '2px solid rgb(59 130 246)' : 'none',
                          borderBottom: slot.index === dragState.currentIndex ? '2px solid rgb(59 130 246)' : 'none',
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>

      {/* Légende */}
      <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-blue-100 border-2 border-blue-400 rounded-sm" />
          Sélectionné
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-gray-300 rounded-sm opacity-70" />
          Occupé
        </span>
        <span className="text-gray-400 italic">
          Cliquer-glisser pour ajuster la durée
        </span>
      </div>
    </div>
  );
}

export default MiniWeekCalendar;
