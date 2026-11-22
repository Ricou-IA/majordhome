/**
 * CalendarFilters.jsx - Majord'home Artisan
 * ============================================================================
 * Filtres du Planning, en entonnoir : nature → personnes → types de RDV.
 * Les règles (qui peut porter quoi, purge des choix devenus impossibles) sont
 * dans src/lib/planningEvents.js ; ce composant ne fait que les afficher.
 * ============================================================================
 */

import { useState } from 'react';
import { ChevronRight, ChevronDown, Calendar as CalendarIcon, Wrench, Briefcase, MoveHorizontal } from 'lucide-react';
import { optionsEntonnoir, purgerFiltres } from '@/lib/planningEvents';
import { APPOINTMENT_TYPES } from '@services/appointments.service';

// Premier étage de l'entonnoir des filtres : la nature des RDV affichés.
const NATURES = [
  { value: 'tout', label: 'Tout', kinds: { intervention: true, commercial: true } },
  { value: 'intervention', label: 'Intervention', icon: Wrench, kinds: { intervention: true, commercial: false } },
  { value: 'commercial', label: 'Commercial', icon: Briefcase, kinds: { intervention: false, commercial: true } },
];

/** Flèche entre deux étages de l'entonnoir (bureau seulement). */
function EtageSuivant() {
  return <ChevronRight className="hidden sm:block w-4 h-4 text-secondary-300 shrink-0" aria-hidden="true" />;
}

/**
 * Filtres en entonnoir : nature (tout / intervention / commercial) → personnes
 * qui peuvent la porter → types de RDV possibles pour ce choix. Chaque étage ne
 * propose que ce que l'étage du dessus laisse possible (règles : optionsEntonnoir
 * / purgerFiltres de planningEvents.js). Les tolérances ne filtrent rien : c'est
 * une option d'affichage, rangée à part.
 */
export function CalendarFilters({ filters, setFilters, teamList }) {
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);

  const kinds = filters.kinds || { intervention: true, commercial: true };
  const nature = kinds.intervention && kinds.commercial ? 'tout' : kinds.intervention ? 'intervention' : 'commercial';
  const { personnes, types } = optionsEntonnoir(filters, teamList, APPOINTMENT_TYPES);
  const selectedKeys = filters.memberProfileKeys || [];
  const selectedType = APPOINTMENT_TYPES.find(t => t.value === filters.appointmentType);
  const hasFilters = selectedKeys.length > 0 || filters.appointmentType || nature !== 'tout';

  // Tout changement d'étage retire des étages du dessous ce qui n'est plus possible.
  const appliquer = (patch) =>
    setFilters(f => purgerFiltres({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }, teamList, APPOINTMENT_TYPES));

  const toggleMember = (profileKey) =>
    appliquer(f => {
      const cur = f.memberProfileKeys || [];
      return { memberProfileKeys: cur.includes(profileKey) ? cur.filter(k => k !== profileKey) : [...cur, profileKey] };
    });

  const resetAll = () =>
    setFilters(f => ({
      ...f,
      kinds: { intervention: true, commercial: true },
      memberProfileKeys: [],
      appointmentType: null,
    }));

  // Sous `sm` (téléphone) : les chips équipe défilent sur une ligne au lieu
  // d'empiler six lignes de boutons ; les tolérances (bandes de souplesse) sont
  // une lecture de bureau.
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Étage 1 — nature */}
      <div className="flex items-center bg-secondary-100 rounded-lg p-0.5" role="group" aria-label="Nature des rendez-vous">
        {NATURES.map(({ value, label, icon: Icon, kinds: k }) => (
          <button
            key={value}
            onClick={() => appliquer({ kinds: k })}
            aria-pressed={nature === value}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              nature === value ? 'bg-white text-secondary-900 shadow-sm' : 'text-secondary-600 hover:text-secondary-900'
            }`}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {label}
          </button>
        ))}
      </div>

      <EtageSuivant />

      {/* Étage 2 — personnes qui peuvent porter cette nature de RDV */}
      <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto no-scrollbar w-full sm:w-auto sm:flex-wrap -mx-1 px-1 py-0.5">
        {personnes.map(h => {
          const isSel = selectedKeys.includes(h.profileKey);
          return (
            <button
              key={h.profileKey}
              onClick={() => toggleMember(h.profileKey)}
              title={h.displayName}
              aria-pressed={isSel}
              className={`inline-flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 sm:py-1 rounded-full border text-sm transition-colors ${
                isSel
                  ? 'border-secondary-400 bg-secondary-100 text-secondary-900'
                  : 'border-secondary-200 bg-white text-secondary-600 hover:bg-secondary-50'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
              {h.displayName.split(' ')[0]}
            </button>
          );
        })}
      </div>

      <EtageSuivant />

      {/* Étage 3 — types possibles pour la nature et les personnes choisies */}
      <div className="relative">
        <button
          onClick={() => setShowTypeDropdown(!showTypeDropdown)}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
            filters.appointmentType
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-secondary-300 text-secondary-700 hover:bg-secondary-50'
          }`}
        >
          <CalendarIcon className="w-4 h-4" />
          {selectedType ? selectedType.label : 'Type'}
          <ChevronDown className={`w-3 h-3 transition-transform ${showTypeDropdown ? 'rotate-180' : ''}`} />
        </button>
        {showTypeDropdown && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowTypeDropdown(false)} />
            <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-secondary-200 rounded-lg shadow-lg z-20 py-1">
              <button
                onClick={() => { setFilters(f => ({ ...f, appointmentType: null })); setShowTypeDropdown(false); }}
                className={`w-full flex items-center px-3 py-2 text-sm text-left ${!filters.appointmentType ? 'bg-blue-50 text-blue-700' : 'text-secondary-700 hover:bg-secondary-50'}`}
              >
                Tous les types
              </button>
              {types.map(type => (
                <button
                  key={type.value}
                  onClick={() => { setFilters(f => ({ ...f, appointmentType: type.value })); setShowTypeDropdown(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
                    filters.appointmentType === type.value ? 'bg-blue-50 text-blue-700' : 'text-secondary-700 hover:bg-secondary-50'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full ${type.bgClass}`} />
                  {type.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Reset filtres */}
      {hasFilters && (
        <button
          onClick={resetAll}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Effacer
        </button>
      )}

      {/* Option d'affichage, pas un filtre : plage dans laquelle un entretien ou un
          SAV dont l'heure n'est pas encore donnée au client peut glisser. */}
      {kinds.intervention && (
        <button
          onClick={() => setFilters(f => ({ ...f, showTolerance: !f.showTolerance }))}
          aria-pressed={!!filters.showTolerance}
          title="Afficher, derrière chaque entretien ou SAV dont l’heure n’est pas encore donnée au client, la plage dans laquelle il peut encore être déplacé"
          className={`hidden sm:inline-flex sm:ml-auto items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
            filters.showTolerance
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-secondary-300 text-secondary-500 hover:bg-secondary-50'
          }`}
        >
          <MoveHorizontal className="w-4 h-4" />
          Tolérances
        </button>
      )}
    </div>
  );
}
