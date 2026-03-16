/**
 * StepMesures.jsx - Étape 6 du wizard certificat
 * ============================================================================
 * Mesures et performances : champs numériques filtrés par type d'équipement.
 * ============================================================================
 */

import { FormField, TextInput } from '@apps/artisan/components/FormFields';
import { SectionTitle } from '@apps/artisan/components/FormFields';
import { MESURES_PAR_TYPE, SECTIONS_PAR_EQUIPEMENT } from '../constants';

export function StepMesures({ formData, onChange }) {
  const config = SECTIONS_PAR_EQUIPEMENT[formData.equipement_type] || SECTIONS_PAR_EQUIPEMENT.autre;
  const mesuresItems = MESURES_PAR_TYPE[config.mesuresLabel] || MESURES_PAR_TYPE.combustion;
  const mesures = formData.mesures || {};

  const handleChange = (key, value) => {
    onChange('mesures', {
      ...mesures,
      [key]: value,
    });
  };

  return (
    <div className="space-y-4">
      <SectionTitle>Mesures et performances</SectionTitle>
      <p className="text-sm text-gray-500">
        Tous les champs sont optionnels. Renseignez les mesures effectuées.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {mesuresItems.map(item => (
          <FormField key={item.key} label={`${item.label}${item.unit ? ` (${item.unit})` : ''}`}>
            <TextInput
              type="number"
              step="0.1"
              value={mesures[item.key] ?? ''}
              onChange={(val) => handleChange(item.key, val ? parseFloat(val) : null)}
              placeholder="—"
            />
          </FormField>
        ))}
      </div>
    </div>
  );
}
