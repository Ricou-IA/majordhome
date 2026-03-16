/**
 * StepRamonage.jsx - Étape conditionnelle du wizard certificat
 * ============================================================================
 * Ramonage des conduits : 1 à 3 conduits dynamiques, méthode, taux de dépôts.
 * Affiché uniquement pour : poele, chaudiere_bois, chaudiere_fioul, chaudiere_gaz.
 * ============================================================================
 */

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField, TextInput, SelectInput, TextArea } from '@apps/artisan/components/FormFields';
import { SectionTitle } from '@apps/artisan/components/FormFields';
import { METHODES_RAMONAGE, TAUX_DEPOTS } from '../constants';

const RESULTAT_OPTIONS = [
  { value: 'ramone',  label: 'Ramoné' },
  { value: 'obstrue', label: 'Obstrué' },
  { value: 'na',      label: 'N/A' },
];

const emptyConduit = () => ({
  label: '',
  diametre_mm: null,
  longueur_ml: null,
  resultat: 'ramone',
  observations: '',
});

export function StepRamonage({ formData, onChange }) {
  const ramonage = formData.donnees_ramonage || {
    conduits: [{ ...emptyConduit(), label: 'Conduit principal' }],
    methode: 'mecanique',
    methode_autre: '',
    taux_depots: 'faible',
    observations_conduit: '',
  };

  const updateRamonage = (updates) => {
    onChange('donnees_ramonage', { ...ramonage, ...updates });
  };

  const updateConduit = (index, field, value) => {
    const conduits = [...ramonage.conduits];
    conduits[index] = { ...conduits[index], [field]: value };
    updateRamonage({ conduits });
  };

  const addConduit = () => {
    if (ramonage.conduits.length >= 3) return;
    const conduits = [...ramonage.conduits, { ...emptyConduit(), label: `Conduit ${ramonage.conduits.length + 1}` }];
    updateRamonage({ conduits });
  };

  const removeConduit = (index) => {
    if (ramonage.conduits.length <= 1) return;
    const conduits = ramonage.conduits.filter((_, i) => i !== index);
    updateRamonage({ conduits });
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Ramonage des conduits</SectionTitle>

      {/* Conduits */}
      {ramonage.conduits.map((conduit, index) => (
        <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-800">
              Conduit {index + 1}
            </h4>
            {ramonage.conduits.length > 1 && (
              <button
                type="button"
                onClick={() => removeConduit(index)}
                className="text-red-500 hover:text-red-700 p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Label">
              <TextInput
                value={conduit.label}
                onChange={(val) => updateConduit(index, 'label', val)}
                placeholder="Ex: Conduit principal"
              />
            </FormField>
            <FormField label="Résultat">
              <SelectInput
                value={conduit.resultat}
                onChange={(val) => updateConduit(index, 'resultat', val)}
                options={RESULTAT_OPTIONS}
              />
            </FormField>
            <FormField label="Diamètre (mm)">
              <TextInput
                type="number"
                value={conduit.diametre_mm || ''}
                onChange={(val) => updateConduit(index, 'diametre_mm', val ? parseInt(val) : null)}
                placeholder="150"
              />
            </FormField>
            <FormField label="Longueur (ml)">
              <TextInput
                type="number"
                step="0.1"
                value={conduit.longueur_ml || ''}
                onChange={(val) => updateConduit(index, 'longueur_ml', val ? parseFloat(val) : null)}
                placeholder="8.5"
              />
            </FormField>
          </div>

          {conduit.resultat === 'obstrue' && (
            <FormField label="Observations">
              <TextArea
                value={conduit.observations}
                onChange={(val) => updateConduit(index, 'observations', val)}
                rows={2}
                placeholder="Détail de l'obstruction..."
              />
            </FormField>
          )}
        </div>
      ))}

      {ramonage.conduits.length < 3 && (
        <Button type="button" variant="outline" onClick={addConduit} className="min-h-[44px]">
          <Plus className="w-4 h-4 mr-2" />
          Ajouter un conduit
        </Button>
      )}

      {/* Méthode */}
      <SectionTitle>Méthode de ramonage</SectionTitle>
      <FormField label="Méthode">
        <SelectInput
          value={ramonage.methode}
          onChange={(val) => updateRamonage({ methode: val })}
          options={METHODES_RAMONAGE}
        />
      </FormField>
      {ramonage.methode === 'autre' && (
        <FormField label="Préciser">
          <TextInput
            value={ramonage.methode_autre}
            onChange={(val) => updateRamonage({ methode_autre: val })}
            placeholder="Méthode utilisée..."
          />
        </FormField>
      )}

      {/* Taux de dépôts */}
      <FormField label="Taux de dépôts">
        <SelectInput
          value={ramonage.taux_depots}
          onChange={(val) => updateRamonage({ taux_depots: val })}
          options={TAUX_DEPOTS}
        />
      </FormField>

      {/* Observations générales */}
      <FormField label="Observations générales">
        <TextArea
          value={ramonage.observations_conduit}
          onChange={(val) => updateRamonage({ observations_conduit: val })}
          rows={3}
          placeholder="Observations sur l'état des conduits..."
        />
      </FormField>
    </div>
  );
}
