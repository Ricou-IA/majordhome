/**
 * StepFGaz.jsx - Étape conditionnelle du wizard certificat
 * ============================================================================
 * Contrôle F-Gaz : détection fuites, charges fluide, conformité.
 * Affiché uniquement pour : pac_air_eau, pac_air_air, climatisation, chauffe_eau_thermo.
 * ============================================================================
 */

import { FormField, TextInput } from '@apps/artisan/components/FormFields';
import { SectionTitle } from '@apps/artisan/components/FormFields';
import { ConformiteRow } from '../ConformiteRow';
import { AlertCircle } from 'lucide-react';

export function StepFGaz({ formData, onChange }) {
  const fgaz = formData.donnees_entretien?.fgaz || {
    detection_fuites: '',
    complement_charge_kg: 0,
    certificat_aptitude_verifie: false,
    enregistrement_carnet: false,
    charge_actuelle_kg: null,
    fluide_ajoute_kg: 0,
    fluide_recupere_kg: 0,
  };

  const updateFGaz = (updates) => {
    const updated = {
      ...formData.donnees_entretien,
      fgaz: { ...fgaz, ...updates },
    };
    onChange('donnees_entretien', updated);
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Contrôle F-Gaz</SectionTitle>

      {/* Note réglementaire */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-800">
          <strong>Règlement EU 517/2014</strong> — Contrôle d'étanchéité obligatoire
          pour les équipements contenant ≥ 5 tonnes équivalent CO₂ de gaz fluorés.
          Les opérations doivent être consignées au carnet de l'équipement.
        </p>
      </div>

      {/* Conformité */}
      <ConformiteRow
        label="Détection de fuites"
        value={fgaz.detection_fuites}
        onChange={(val) => updateFGaz({ detection_fuites: val })}
      />

      {/* Vérifications */}
      <div className="space-y-3">
        <SectionTitle>Vérifications</SectionTitle>

        <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={!!fgaz.certificat_aptitude_verifie}
            onChange={(e) => updateFGaz({ certificat_aptitude_verifie: e.target.checked })}
            className="w-5 h-5 rounded border-gray-300 text-blue-600"
          />
          <span className="text-sm text-gray-800">Certificat d'aptitude vérifié</span>
        </label>

        <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={!!fgaz.enregistrement_carnet}
            onChange={(e) => updateFGaz({ enregistrement_carnet: e.target.checked })}
            className="w-5 h-5 rounded border-gray-300 text-blue-600"
          />
          <span className="text-sm text-gray-800">Enregistrement au carnet de l'équipement</span>
        </label>
      </div>

      {/* Mesures fluide */}
      <SectionTitle>Fluide frigorigène</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Charge actuelle (kg)">
          <TextInput
            type="number"
            step="0.001"
            value={fgaz.charge_actuelle_kg ?? ''}
            onChange={(val) => updateFGaz({ charge_actuelle_kg: val ? parseFloat(val) : null })}
            placeholder="1.800"
          />
        </FormField>
        <FormField label="Complément de charge (kg)">
          <TextInput
            type="number"
            step="0.001"
            value={fgaz.complement_charge_kg || ''}
            onChange={(val) => updateFGaz({ complement_charge_kg: val ? parseFloat(val) : 0 })}
            placeholder="0.000"
          />
        </FormField>
        <FormField label="Fluide ajouté (kg)">
          <TextInput
            type="number"
            step="0.001"
            value={fgaz.fluide_ajoute_kg || ''}
            onChange={(val) => updateFGaz({ fluide_ajoute_kg: val ? parseFloat(val) : 0 })}
            placeholder="0.000"
          />
        </FormField>
        <FormField label="Fluide récupéré (kg)">
          <TextInput
            type="number"
            step="0.001"
            value={fgaz.fluide_recupere_kg || ''}
            onChange={(val) => updateFGaz({ fluide_recupere_kg: val ? parseFloat(val) : 0 })}
            placeholder="0.000"
          />
        </FormField>
      </div>
    </div>
  );
}
