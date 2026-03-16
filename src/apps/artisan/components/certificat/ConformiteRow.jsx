/**
 * ConformiteRow.jsx - Certificat d'Entretien
 * ============================================================================
 * Ligne de contrôle réutilisable : libellé + 3 boutons radio
 * (Conforme / Non conforme / N/A) + textarea observation conditionnelle.
 *
 * Optimisé tablette : boutons 48px min, texte lisible.
 * ============================================================================
 */

const STATES = [
  { value: 'conforme',      label: 'Conforme',      short: '✓', bgActive: 'bg-green-600 text-white', bgInactive: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'non_conforme',  label: 'Non conforme',  short: '✗', bgActive: 'bg-red-600 text-white',   bgInactive: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'na',            label: 'N/A',            short: '—', bgActive: 'bg-gray-600 text-white',  bgInactive: 'bg-gray-50 text-gray-600 border-gray-200' },
];

export function ConformiteRow({ label, value, onChange, observation, onObservationChange, numericField, numericValue, onNumericChange }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        {/* Libellé */}
        <span className="text-sm font-medium text-gray-800 flex-1 min-w-0">
          {label}
        </span>

        {/* Boutons radio */}
        <div className="flex gap-1.5 shrink-0">
          {STATES.map(state => {
            const isActive = value === state.value;
            return (
              <button
                key={state.value}
                type="button"
                onClick={() => onChange(state.value)}
                className={`min-h-[40px] min-w-[40px] px-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                  isActive ? state.bgActive + ' border-transparent' : state.bgInactive
                }`}
                title={state.label}
              >
                <span className="sm:hidden">{state.short}</span>
                <span className="hidden sm:inline">{state.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Champ numérique optionnel (ex: pression) */}
      {numericField && (
        <div className="flex items-center gap-2 pl-1">
          <label className="text-xs text-gray-500">{numericField.label} :</label>
          <input
            type="number"
            step="0.1"
            value={numericValue ?? ''}
            onChange={(e) => onNumericChange?.(e.target.value ? parseFloat(e.target.value) : null)}
            className="w-24 px-2 py-1 border border-gray-300 rounded text-sm bg-white"
            placeholder="—"
          />
        </div>
      )}

      {/* Observation (si non conforme) */}
      {value === 'non_conforme' && (
        <textarea
          value={observation || ''}
          onChange={(e) => onObservationChange?.(e.target.value)}
          placeholder="Observation obligatoire..."
          rows={2}
          className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm bg-red-50 focus:ring-2 focus:ring-red-300 focus:border-red-300 outline-none"
        />
      )}
    </div>
  );
}
