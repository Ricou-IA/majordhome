import { MapPin } from 'lucide-react';
import { FRENCH_DEPARTMENTS } from '@lib/departments';

/**
 * Sélecteur de département français (95 + DOM-TOM).
 * Bouton "📍 Détecter depuis siège" si onDetectFromHq fourni.
 *
 * @param {Object} props
 * @param {string} props.value - code département actuel (ex '81')
 * @param {Function} props.onChange - (code: string) => void
 * @param {Function} [props.onDetectFromHq] - callback pour auto-détection depuis lat/lng du siège
 * @param {boolean} [props.disabled]
 */
export default function DepartmentSelect({
  value = '',
  onChange,
  onDetectFromHq,
  disabled = false,
}) {
  return (
    <div className="flex gap-2 items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-1 px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-secondary-50"
      >
        <option value="">— Sélectionne un département —</option>
        {FRENCH_DEPARTMENTS.map((d) => (
          <option key={d.code} value={d.code}>
            {d.code} — {d.name}
          </option>
        ))}
      </select>
      {onDetectFromHq && (
        <button
          type="button"
          onClick={onDetectFromHq}
          disabled={disabled}
          className="flex items-center gap-1 px-3 py-2 text-xs text-primary-600 border border-primary-300 rounded-md hover:bg-primary-50 disabled:opacity-50 flex-shrink-0"
        >
          <MapPin className="w-3 h-3" />
          Détecter depuis siège
        </button>
      )}
    </div>
  );
}
