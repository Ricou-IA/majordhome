/**
 * AssignSlotModal.jsx — « Qui prend ce RDV ? »
 * ============================================================================
 * Filet OBLIGATOIRE (Eric, 2026-09-16 : « je ne veux pas de planning non
 * assigné ») : s'ouvre quand le sélecteur inline d'un créneau a été vidé.
 * Le créneau n'existe que si on lui donne quelqu'un : Annuler = il est retiré.
 * (La colonne « À assigner » de la grille a été retirée le 2026-09-17 : on
 * décide sur l'instant, poser = poser dans la colonne de quelqu'un.)
 *
 * Présentationnelle : la décision remonte via onAssign(ids[]) / onCancel().
 * Mode `single` (commercial) : un seul choix ; sinon plusieurs techniciens.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { X, UserCheck } from 'lucide-react';

/** "2026-06-09" → "mardi 9 juin". */
function formatSlotDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Object|null} props.slot - { id, date, startTime, endTime }
 * @param {Array} props.members - [{ id, display_name, calendar_color }]
 * @param {boolean} [props.single] - un seul assigné (mode commercial)
 * @param {string} [props.assigneeLabel]
 * @param {Function} props.onAssign - (ids[]) => void  (ids non vide)
 * @param {Function} props.onCancel - () => void  (le créneau est retiré)
 */
export function AssignSlotModal({
  open,
  slot,
  members = [],
  single = false,
  assigneeLabel = 'Technicien(s)',
  onAssign,
  onCancel,
}) {
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open, slot?.id]);

  if (!open || !slot) return null;

  const toggle = (id) => {
    setSelected((prev) => {
      if (single) return prev.includes(id) ? [] : [id];
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-start justify-between p-4 border-b border-gray-200">
          <div>
            <h3 className="font-semibold text-gray-900">Qui prend ce RDV ?</h3>
            <p className="text-sm text-gray-500 capitalize">
              {formatSlotDate(slot.date)} · {slot.startTime}{slot.endTime ? `–${slot.endTime}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            aria-label="Annuler ce créneau"
            title="Annuler ce créneau"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">{assigneeLabel}</p>
          {members.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Aucun membre assignable.</p>
          ) : (
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {members.map((m) => {
                const isSel = selected.includes(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-sm transition-colors ${
                        isSel ? 'bg-blue-50 border-blue-300 text-blue-900' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-800'
                      }`}
                      role={single ? 'radio' : 'checkbox'}
                      aria-checked={isSel}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: m.calendar_color || '#6B7280' }}
                      />
                      <span className="truncate">{m.display_name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-gray-500 italic">
            Un RDV a toujours une personne. Annuler retire le créneau.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => selected.length && onAssign?.(selected)}
            disabled={selected.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UserCheck className="w-4 h-4" />
            Assigner{selected.length > 1 ? ` (${selected.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AssignSlotModal;
