/**
 * StepNettoyage.jsx - Étape 3 du wizard certificat
 * ============================================================================
 * Nettoyage des composants : liste filtrée par type d'équipement.
 * ============================================================================
 */

import { SectionTitle } from '@apps/artisan/components/FormFields';
import { ConformiteRow } from '../ConformiteRow';
import { getNettoyageItems } from '../constants';

export function StepNettoyage({ formData, onChange }) {
  const nettoyage = formData.donnees_entretien?.nettoyage || {};
  const items = getNettoyageItems(formData.equipement_type);

  const handleChange = (key, value) => {
    const updated = {
      ...formData.donnees_entretien,
      nettoyage: {
        ...nettoyage,
        [key]: value,
      },
    };
    onChange('donnees_entretien', updated);
  };

  const handleObservation = (key, obs) => {
    const updated = {
      ...formData.donnees_entretien,
      nettoyage: {
        ...nettoyage,
        [`${key}_observation`]: obs,
      },
    };
    onChange('donnees_entretien', updated);
  };

  return (
    <div className="space-y-4">
      <SectionTitle>Nettoyage des composants</SectionTitle>
      <p className="text-sm text-gray-500">
        Indiquez l'état de propreté après intervention.
      </p>

      <div className="space-y-2">
        {items.map(item => (
          <ConformiteRow
            key={item.key}
            label={item.label}
            value={nettoyage[item.key] || ''}
            onChange={(val) => handleChange(item.key, val)}
            observation={nettoyage[`${item.key}_observation`] || ''}
            onObservationChange={(obs) => handleObservation(item.key, obs)}
          />
        ))}
      </div>
    </div>
  );
}
