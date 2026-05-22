import { useState } from 'react';
import AddressSearch from './AddressSearch';

const COLOR_PRESETS = [
  { value: '#f97316', name: 'Orange' },
  { value: '#ef4444', name: 'Rouge' },
  { value: '#10b981', name: 'Vert' },
  { value: '#3b82f6', name: 'Bleu' },
  { value: '#8b5cf6', name: 'Violet' },
  { value: '#f59e0b', name: 'Ambre' },
];

const EMOJI_PRESETS = ['🏢', '🏠', '🏭', '⚡', '📍'];

/**
 * Formulaire d'édition d'un centre (siège ou antenne).
 * Géré en controlled mode : le parent passe `value` et reçoit `onChange`.
 *
 * @param {Object} props
 * @param {Object} props.value - { label, lat, lng, color, emoji }
 * @param {Function} props.onChange - (newCenter) => void
 * @param {string} [props.labelHint] - texte d'aide sous "Nom"
 * @param {boolean} [props.disabled]
 */
export default function CenterEditor({ value, onChange, labelHint, disabled = false }) {
  const [manualMode, setManualMode] = useState(false);

  const update = (patch) => onChange({ ...value, ...patch });

  const handleAddressSelect = ({ lat, lng, label }) => {
    // Ne pas écraser le label custom si déjà saisi par l'user
    update({ lat, lng, label: value.label || label });
  };

  return (
    <div className="space-y-4">
      {/* Nom */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1">
          Nom (affiché sur la carte)
        </label>
        <input
          type="text"
          value={value.label || ''}
          onChange={(e) => update({ label: e.target.value })}
          disabled={disabled}
          maxLength={80}
          placeholder="Ex: Siège Cimaj — Toulouse"
          className="w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        {labelHint && <p className="mt-1 text-xs text-secondary-500">{labelHint}</p>}
      </div>

      {/* Adresse → géocodage */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1">
          Rechercher une adresse
        </label>
        <AddressSearch initialValue="" onSelect={handleAddressSelect} disabled={disabled} />
      </div>

      {/* Coordonnées affichées + toggle saisie manuelle */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-secondary-500">
            {Number.isFinite(value.lat) && Number.isFinite(value.lng)
              ? `📍 ${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}`
              : 'Aucune coordonnée'}
          </span>
          <button
            type="button"
            onClick={() => setManualMode(!manualMode)}
            className="text-xs text-primary-600 hover:underline"
            disabled={disabled}
          >
            {manualMode ? 'Cacher la saisie manuelle' : 'Saisie manuelle'}
          </button>
        </div>
        {manualMode && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              type="number"
              step="0.000001"
              value={value.lat ?? ''}
              onChange={(e) =>
                update({ lat: e.target.value === '' ? null : parseFloat(e.target.value) })
              }
              placeholder="Latitude"
              disabled={disabled}
              className="px-3 py-2 border border-secondary-300 rounded-md text-sm"
            />
            <input
              type="number"
              step="0.000001"
              value={value.lng ?? ''}
              onChange={(e) =>
                update({ lng: e.target.value === '' ? null : parseFloat(e.target.value) })
              }
              placeholder="Longitude"
              disabled={disabled}
              className="px-3 py-2 border border-secondary-300 rounded-md text-sm"
            />
          </div>
        )}
      </div>

      {/* Couleur */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1">
          Couleur (sur la carte)
        </label>
        <div className="flex gap-2">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => update({ color: c.value })}
              disabled={disabled}
              title={c.name}
              className={`w-7 h-7 rounded-full transition-all ${
                value.color === c.value ? 'ring-2 ring-offset-2 ring-primary-500' : ''
              }`}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
      </div>

      {/* Emoji */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1">Icône</label>
        <div className="flex gap-2">
          {EMOJI_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => update({ emoji: e })}
              disabled={disabled}
              className={`w-9 h-9 rounded-md border text-lg transition-colors ${
                value.emoji === e
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-secondary-300 hover:bg-secondary-50'
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
