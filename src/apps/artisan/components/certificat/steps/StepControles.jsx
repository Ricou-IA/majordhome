/**
 * StepControles.jsx - Étape 2 du wizard certificat
 * ============================================================================
 * Contrôles de sécurité : liste de points avec conformité 3 états.
 * ============================================================================
 */

import { SectionTitle } from '@apps/artisan/components/FormFields';
import { ConformiteRow } from '../ConformiteRow';
import { CONTROLES_SECURITE_ITEMS } from '../constants';

export function StepControles({ formData, onChange }) {
  const controles = formData.donnees_entretien?.controles_securite || {};

  const handleChange = (key, value) => {
    const updated = {
      ...formData.donnees_entretien,
      controles_securite: {
        ...controles,
        [key]: value,
      },
    };
    onChange('donnees_entretien', updated);
  };

  const handleObservation = (key, obs) => {
    const updated = {
      ...formData.donnees_entretien,
      controles_securite: {
        ...controles,
        [`${key}_observation`]: obs,
      },
    };
    onChange('donnees_entretien', updated);
  };

  const handleNumeric = (key, value) => {
    const updated = {
      ...formData.donnees_entretien,
      controles_securite: {
        ...controles,
        [key]: value,
      },
    };
    onChange('donnees_entretien', updated);
  };

  return (
    <div className="space-y-4">
      <SectionTitle>Contrôles de sécurité</SectionTitle>
      <p className="text-sm text-gray-500">
        Vérifiez chaque point et indiquez le résultat.
      </p>

      <div className="space-y-2">
        {CONTROLES_SECURITE_ITEMS.map(item => {
          // Les items avec hasNumericField sont des champs numériques purs, pas des conformités
          if (item.hasNumericField) {
            return (
              <ConformiteRow
                key={item.key}
                label={item.label}
                value={controles[item.key] || ''}
                onChange={(val) => handleChange(item.key, val)}
                observation={controles[`${item.key}_observation`] || ''}
                onObservationChange={(obs) => handleObservation(item.key, obs)}
                numericField={{ label: item.numericLabel }}
                numericValue={controles[item.numericKey]}
                onNumericChange={(val) => handleNumeric(item.numericKey, val)}
              />
            );
          }

          return (
            <ConformiteRow
              key={item.key}
              label={item.label}
              value={controles[item.key] || ''}
              onChange={(val) => handleChange(item.key, val)}
              observation={controles[`${item.key}_observation`] || ''}
              onObservationChange={(obs) => handleObservation(item.key, obs)}
            />
          );
        })}
      </div>
    </div>
  );
}
