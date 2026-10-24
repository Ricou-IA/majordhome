import { MapPin } from 'lucide-react';
import { FRENCH_DEPARTMENTS } from '@lib/departments';
import { INPUT_CLASS } from './layout';

/**
 * Sélecteur de département français (95 + DOM-TOM).
 * Bouton « Détecter depuis le siège » si onDetectFromHq fourni.
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
        className={`${INPUT_CLASS} flex-1`}
      >
        <option value="">Choisir un département</option>
        {FRENCH_DEPARTMENTS.map((d) => (
          <option key={d.code} value={d.code}>
            {d.code} · {d.name}
          </option>
        ))}
      </select>
      {onDetectFromHq && (
        <button
          type="button"
          onClick={onDetectFromHq}
          disabled={disabled}
          className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50"
        >
          <MapPin className="w-4 h-4" />
          Détecter depuis le siège
        </button>
      )}
    </div>
  );
}
