/** SpecsField — caractéristiques « libellé — valeur » (objet `specs`). */
import { Plus, X } from 'lucide-react';
import { inputClass } from '@apps/artisan/components/FormFields';

export default function SpecsField({ rows, onChange, disabled, error }) {
  const update = (i, key, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  const add = () => onChange([...rows, { label: '', value: '' }]);

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-secondary-400">Aucune caractéristique.</p>}
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={row.label}
            onChange={(e) => update(i, 'label', e.target.value)}
            placeholder="Libellé (ex. Poids)"
            disabled={disabled}
            className={`${inputClass} w-2/5`}
          />
          <input
            value={row.value}
            onChange={(e) => update(i, 'value', e.target.value)}
            placeholder="Valeur (ex. 4,2 kg)"
            disabled={disabled}
            className={`${inputClass} flex-1`}
          />
          {!disabled && (
            <button type="button" onClick={() => remove(i)} className="p-2 text-secondary-400 hover:text-red-600" aria-label="Retirer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!disabled && (
        <button type="button" onClick={add} className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700">
          <Plus className="w-4 h-4" /> Ajouter une caractéristique
        </button>
      )}
    </div>
  );
}
