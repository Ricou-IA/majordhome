import { useState } from 'react';
import { MapPin } from 'lucide-react';
import AddressSearch from './AddressSearch';
import { Field, INPUT_CLASS } from './layout';

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

  const hasCoords = Number.isFinite(value.lat) && Number.isFinite(value.lng);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Nom sur la carte" hint={labelHint}>
          <input
            type="text"
            value={value.label || ''}
            onChange={(e) => update({ label: e.target.value })}
            disabled={disabled}
            maxLength={80}
            placeholder="Ex. Siège Cimaj, Toulouse"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Adresse">
          <AddressSearch initialValue="" onSelect={handleAddressSelect} disabled={disabled} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className={`flex items-center gap-1.5 tabular-nums ${hasCoords ? 'text-secondary-600' : 'text-amber-800'}`}>
          <MapPin className="w-4 h-4" />
          {hasCoords ? `${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}` : 'Position non renseignée : recherchez l’adresse'}
        </span>
        <button
          type="button"
          onClick={() => setManualMode(!manualMode)}
          className="text-sm text-primary-700 hover:underline"
          disabled={disabled}
        >
          {manualMode ? 'Masquer les coordonnées' : 'Saisir les coordonnées'}
        </button>
      </div>
      {manualMode && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitude">
            <input
              type="number"
              step="0.000001"
              value={value.lat ?? ''}
              onChange={(e) => update({ lat: e.target.value === '' ? null : parseFloat(e.target.value) })}
              disabled={disabled}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field label="Longitude">
            <input
              type="number"
              step="0.000001"
              value={value.lng ?? ''}
              onChange={(e) => update({ lng: e.target.value === '' ? null : parseFloat(e.target.value) })}
              disabled={disabled}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
        </div>
      )}

      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <Field label="Couleur du repère">
          <div className="flex gap-2">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => update({ color: c.value })}
                disabled={disabled}
                title={c.name}
                aria-label={`Couleur ${c.name}`}
                aria-pressed={value.color === c.value}
                className={`w-8 h-8 rounded-full transition-shadow ${
                  value.color === c.value ? 'ring-2 ring-offset-2 ring-secondary-900' : ''
                }`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        </Field>
        <Field label="Icône du repère">
          <div className="flex gap-2">
            {EMOJI_PRESETS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => update({ emoji: e })}
                disabled={disabled}
                aria-pressed={value.emoji === e}
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
        </Field>
      </div>
    </div>
  );
}
