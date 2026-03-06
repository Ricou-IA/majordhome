/**
 * TechnicianSelect.jsx - Majord'home Artisan
 * ============================================================================
 * Sélecteur multi-techniciens réutilisable.
 * Utilisé par EventModal (planning) et SchedulingPanel (pipeline leads).
 *
 * @version 1.0.0 - Extrait d'EventModal Sprint 2, partagé Sprint 4+
 * ============================================================================
 */

import { useState } from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';

/**
 * @param {Object} props
 * @param {string[]} props.selectedIds - IDs des techniciens sélectionnés
 * @param {Function} props.onChange - Callback (newIds: string[]) => void
 * @param {Array} props.members - Liste des team_members {id, display_name, calendar_color, specialties}
 * @param {string} [props.placeholder] - Placeholder quand aucun technicien sélectionné
 */
export function TechnicianSelect({ selectedIds, onChange, members, placeholder = 'Sélectionner des techniciens...' }) {
  const [open, setOpen] = useState(false);

  const toggleTech = (techId) => {
    const newIds = selectedIds.includes(techId)
      ? selectedIds.filter(id => id !== techId)
      : [...selectedIds, techId];
    onChange(newIds);
  };

  const selectedNames = members
    .filter(m => selectedIds.includes(m.id))
    .map(m => m.display_name);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <span className={selectedNames.length > 0 ? 'text-gray-900' : 'text-gray-400'}>
          {selectedNames.length > 0
            ? selectedNames.join(', ')
            : placeholder
          }
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 max-h-48 overflow-y-auto">
            {members.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-500">Aucun technicien disponible</p>
            ) : (
              members.map(member => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleTech(member.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50"
                >
                  <span
                    className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                      selectedIds.includes(member.id)
                        ? 'bg-blue-600 border-blue-600'
                        : 'border-gray-300'
                    }`}
                  >
                    {selectedIds.includes(member.id) && (
                      <CheckCircle2 className="w-3 h-3 text-white" />
                    )}
                  </span>
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: member.calendar_color || '#6B7280' }}
                  />
                  <span className="text-gray-900">{member.display_name}</span>
                  {member.specialties && (
                    <span className="text-gray-400 text-xs ml-auto">{member.specialties}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default TechnicianSelect;
