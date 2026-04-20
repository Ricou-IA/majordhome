/**
 * ProductSpecsForm.jsx — Formulaire caractéristiques techniques adaptatif
 * ============================================================================
 * Génère un formulaire dynamique à partir d'un schéma canonique.
 * - Filtre les champs selon fuel_type (ex: log_length_cm masqué pour granulés)
 * - Groupe par sections (Puissance / Performance / Émissions...)
 * - Bloc "extras" libre pour champs fournisseur non canoniques
 *
 * Props:
 *  - category        : 'poele' (détermine le schéma)
 *  - fuelType        : 'bois' | 'granules' | 'hybride'
 *  - value           : { canonical: {...}, extras: [{label, value, unit?}] }
 *  - onChange(next)  : appelé avec le nouvel objet specs complet
 * ============================================================================
 */

import { useMemo, useCallback } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import { getSchemaForCategory } from '@/shared/specs';
import { FormField, TextInput, SelectInput } from '../../../components/FormFields';
import { inputClass } from '../../../components/FormFields';

export default function ProductSpecsForm({ category, fuelType, value, onChange }) {
  const schema = getSchemaForCategory(category);
  const canonical = value?.canonical || {};
  const extras = value?.extras || [];

  const { groupedFields, filterByFuelType, groupFields } = useMemo(() => {
    if (!schema) return { groupedFields: [], filterByFuelType: null, groupFields: null };
    const fields = schema.filterByFuelType(fuelType);
    const groups = schema.groupFields(fields);
    return { groupedFields: groups, filterByFuelType: schema.filterByFuelType, groupFields: schema.groupFields };
  }, [schema, fuelType]);

  const setCanonical = useCallback((key, newValue) => {
    onChange?.({
      canonical: { ...canonical, [key]: newValue },
      extras,
    });
  }, [canonical, extras, onChange]);

  const setExtra = useCallback((idx, patch) => {
    const next = extras.map((e, i) => (i === idx ? { ...e, ...patch } : e));
    onChange?.({ canonical, extras: next });
  }, [canonical, extras, onChange]);

  const addExtra = useCallback(() => {
    onChange?.({ canonical, extras: [...extras, { label: '', value: '', unit: '' }] });
  }, [canonical, extras, onChange]);

  const removeExtra = useCallback((idx) => {
    onChange?.({ canonical, extras: extras.filter((_, i) => i !== idx) });
  }, [canonical, extras, onChange]);

  if (!schema) {
    return (
      <div className="p-8 text-center text-sm text-secondary-500 bg-secondary-50 rounded-lg">
        <Info className="w-5 h-5 mx-auto mb-2 text-secondary-400" />
        Pas de schéma de caractéristiques défini pour cette catégorie.
        <br />
        <span className="text-xs">Catégories supportées : Poêle (bois/granulés/hybride)</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groupedFields.map((group) => (
        <fieldset key={group.key} className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wider text-secondary-500">
            {group.label}
          </legend>
          <div className="grid grid-cols-2 gap-3">
            {group.fields.map((field) => (
              <SpecField
                key={field.key}
                field={field}
                value={canonical[field.key]}
                onChange={(v) => setCanonical(field.key, v)}
              />
            ))}
          </div>
        </fieldset>
      ))}

      {/* Extras (libre) */}
      <fieldset className="space-y-3 pt-4 border-t border-secondary-200">
        <legend className="flex items-center justify-between w-full">
          <span className="text-xs font-semibold uppercase tracking-wider text-secondary-500">
            Détails fournisseur
          </span>
          <button
            type="button"
            onClick={addExtra}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </button>
        </legend>

        {extras.length === 0 ? (
          <p className="text-xs text-secondary-400 italic">
            Libellé libre pour toute caractéristique hors standard (ex : finition spécifique, accessoires inclus...)
          </p>
        ) : (
          <div className="space-y-2">
            {extras.map((extra, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={extra.label || ''}
                  onChange={(e) => setExtra(idx, { label: e.target.value })}
                  placeholder="Libellé"
                  className={`${inputClass} flex-1`}
                />
                <input
                  type="text"
                  value={extra.value || ''}
                  onChange={(e) => setExtra(idx, { value: e.target.value })}
                  placeholder="Valeur"
                  className={`${inputClass} w-36`}
                />
                <input
                  type="text"
                  value={extra.unit || ''}
                  onChange={(e) => setExtra(idx, { unit: e.target.value })}
                  placeholder="Unité"
                  className={`${inputClass} w-20`}
                />
                <button
                  type="button"
                  onClick={() => removeExtra(idx)}
                  className="p-1.5 hover:bg-red-50 rounded"
                  title="Supprimer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Input adaptatif selon le type de champ
// ----------------------------------------------------------------------------
function SpecField({ field, value, onChange }) {
  const { key, label, unit, type, options, required, hint } = field;

  const displayLabel = (
    <span className="flex items-center gap-1">
      {label}
      {unit && <span className="text-secondary-400 font-normal">({unit})</span>}
      {required && <span className="text-red-500">*</span>}
    </span>
  );

  if (type === 'boolean') {
    return (
      <div className="flex items-center gap-2 py-2">
        <input
          id={`spec-${key}`}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
        />
        <label htmlFor={`spec-${key}`} className="text-sm text-secondary-700 select-none cursor-pointer">
          {label}
          {hint && <span className="block text-xs text-secondary-400">{hint}</span>}
        </label>
      </div>
    );
  }

  if (type === 'enum') {
    return (
      <FormField label={displayLabel}>
        <SelectInput
          value={value ?? ''}
          onChange={(v) => onChange(v || null)}
          options={[{ value: '', label: '—' }, ...options.map((o) => ({ value: o, label: o }))]}
        />
      </FormField>
    );
  }

  if (type === 'number') {
    return (
      <FormField label={displayLabel}>
        <TextInput
          type="number"
          step="any"
          value={value ?? ''}
          onChange={(v) => {
            if (v === '' || v === null) return onChange(null);
            const n = parseFloat(String(v).replace(',', '.'));
            onChange(isNaN(n) ? null : n);
          }}
          placeholder="—"
        />
        {hint && <p className="text-[11px] text-secondary-400 mt-0.5">{hint}</p>}
      </FormField>
    );
  }

  // text (default)
  return (
    <FormField label={displayLabel}>
      <TextInput
        value={value ?? ''}
        onChange={(v) => onChange(v || null)}
        placeholder="—"
      />
    </FormField>
  );
}
