import { Combobox } from '@/components/ui/combobox';
import { MapPin } from 'lucide-react';
import { FRENCH_DEPARTMENTS } from '@lib/departments';

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
      <Combobox
        value={value}
        onChange={(v) => onChange(v)}
        disabled={disabled}
        libelle="Département"
        className="flex-1"
        options={[
          { value: '', label: 'Choisir un département' },
          ...FRENCH_DEPARTMENTS.map((d) => ({ value: d.code, label: `${d.code} · ${d.name}` })),
        ]}
      />
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
