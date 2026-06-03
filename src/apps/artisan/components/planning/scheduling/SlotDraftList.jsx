/**
 * SlotDraftList.jsx - Majord'home Artisan
 * ============================================================================
 * Liste des "créneaux à planifier" en construction.
 * Permet d'EMPILER plusieurs créneaux sans fermer la modale (= fix du bug
 * mono-créneau de l'ancien SchedulingPanel).
 *
 * Une ligne par créneau : "Mar 9 — 10:00–12:00 — Philippe (+ Karim)"
 *  + sélecteur de technicien(s) par ligne (TechnicianSelect)
 *  + croix de suppression
 *  + pastille ambre si conflit (tech déjà occupé sur ce créneau)
 *
 * @version 1.0.0 - Bloc B stage 2 (assistant créneaux)
 * ============================================================================
 */

import { CalendarDays, Trash2, AlertTriangle } from 'lucide-react';
import { TechnicianSelect } from '@apps/artisan/components/planning/TechnicianSelect';

// ============================================================================
// HELPERS
// ============================================================================

/** "2026-06-09" → "Mar 9 juin" (court). */
function formatSlotDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d
    .toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace('.', '');
}

// ============================================================================
// COMPOSANT
// ============================================================================

/**
 * @param {Object} props
 * @param {Array} props.slots - [{ id, date, startTime, endTime, duration, technicianIds }]
 * @param {Array} props.members - [{ id, display_name, calendar_color, specialties }]
 * @param {Object} props.conflictsBySlot - { [slotId]: number } compteur de conflits
 * @param {Function} props.onRemoveSlot - (slotId) => void
 * @param {Function} props.onToggleTech - (slotId, techId) => void
 * @param {string} [props.assigneeLabel] - libellé du type de membre (défaut "Technicien(s)")
 * @param {boolean} [props.showTechSelect] - afficher le sélecteur par ligne (défaut true)
 */
export function SlotDraftList({
  slots = [],
  members = [],
  conflictsBySlot = {},
  onRemoveSlot,
  onToggleTech,
  assigneeLabel = 'Technicien(s)',
  showTechSelect = true,
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
        <CalendarDays className="w-4 h-4 text-blue-600" />
        Créneaux à planifier ({slots.length})
      </h4>

      {slots.length === 0 ? (
        <p className="text-xs text-gray-400 italic px-1 py-2">
          Cliquez-glissez dans une colonne ci-dessus pour ajouter un créneau.
        </p>
      ) : (
        <ul className="space-y-2">
          {slots.map((slot) => {
            const conflictCount = conflictsBySlot[slot.id] || 0;
            const selectedIds = slot.technicianIds || [];
            return (
              <li
                key={slot.id}
                className={`rounded-lg border p-2.5 ${
                  conflictCount > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {conflictCount > 0 && (
                      <span
                        className="w-2 h-2 rounded-full bg-amber-500 shrink-0"
                        title={`${conflictCount} conflit(s) de disponibilité`}
                      />
                    )}
                    <span className="text-sm font-medium text-gray-900 capitalize">
                      {formatSlotDate(slot.date)}
                    </span>
                    <span className="text-sm text-gray-600 tabular-nums">
                      {slot.startTime}
                      {slot.endTime ? `–${slot.endTime}` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveSlot?.(slot.id)}
                    className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                    title="Retirer ce créneau"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Sélecteur de technicien(s) par ligne */}
                {showTechSelect && (
                  <div className="mt-2">
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">{assigneeLabel}</label>
                    <TechnicianSelect
                      selectedIds={selectedIds}
                      onChange={(newIds) => {
                        // Diff → toggle individuel (l'orchestrateur gère ajout/retrait par tech)
                        const added = newIds.filter((id) => !selectedIds.includes(id));
                        const removed = selectedIds.filter((id) => !newIds.includes(id));
                        [...added, ...removed].forEach((id) => onToggleTech?.(slot.id, id));
                      }}
                      members={members}
                      placeholder="Sélectionner..."
                    />
                  </div>
                )}

                {conflictCount > 0 && (
                  <p className="mt-1.5 text-[11px] text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Déjà pris à cet horaire — vous pouvez planifier quand même.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default SlotDraftList;
