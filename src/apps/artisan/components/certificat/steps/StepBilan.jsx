/**
 * StepBilan.jsx - Étape 8 du wizard certificat
 * ============================================================================
 * Bilan de conformité + taux de TVA applicable.
 * ============================================================================
 */

import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { FormField, TextArea, SelectInput } from '@apps/artisan/components/FormFields';
import { SectionTitle } from '@apps/artisan/components/FormFields';
import { TVA_OPTIONS, SECTIONS_PAR_EQUIPEMENT, EQUIPMENT_CATEGORY_LABELS } from '../constants';

const BILAN_OPTIONS = [
  {
    value: 'conforme',
    label: 'Installation conforme',
    Icon: CheckCircle,
    bgClass: 'border-green-300 bg-green-50',
    textClass: 'text-green-800',
    iconClass: 'text-green-600',
  },
  {
    value: 'anomalie',
    label: 'Anomalie(s) détectée(s)',
    Icon: AlertTriangle,
    bgClass: 'border-orange-300 bg-orange-50',
    textClass: 'text-orange-800',
    iconClass: 'text-orange-600',
  },
  {
    value: 'arret_urgence',
    label: 'Arrêt d\'urgence',
    Icon: XCircle,
    bgClass: 'border-red-300 bg-red-50',
    textClass: 'text-red-800',
    iconClass: 'text-red-600',
  },
];

const ACTION_CORRECTIVE_OPTIONS = [
  { value: 'sur_place',      label: 'Corrigée sur place' },
  { value: 'devis',          label: 'Devis à établir' },
  { value: 'arret_urgence',  label: 'Arrêt d\'urgence' },
];

export function StepBilan({ formData, onChange }) {
  const config = SECTIONS_PAR_EQUIPEMENT[formData.equipement_type] || SECTIONS_PAR_EQUIPEMENT.autre;
  const showAnomalie = formData.bilan_conformite === 'anomalie' || formData.bilan_conformite === 'arret_urgence';

  return (
    <div className="space-y-6">
      <SectionTitle>Bilan réglementaire</SectionTitle>

      {/* Sélection conformité */}
      <div className="space-y-2">
        {BILAN_OPTIONS.map(option => {
          const isActive = formData.bilan_conformite === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange('bilan_conformite', option.value)}
              className={`w-full flex items-center gap-3 p-4 rounded-lg border-2 transition-colors text-left ${
                isActive ? option.bgClass : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <option.Icon className={`w-6 h-6 shrink-0 ${isActive ? option.iconClass : 'text-gray-400'}`} />
              <span className={`text-sm font-semibold ${isActive ? option.textClass : 'text-gray-600'}`}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Détail anomalies */}
      {showAnomalie && (
        <div className="space-y-4 border-l-4 border-orange-400 pl-4">
          <FormField label="Détail des anomalies" required>
            <TextArea
              value={formData.anomalies_detail || ''}
              onChange={(val) => onChange('anomalies_detail', val)}
              rows={3}
              placeholder="Décrivez les anomalies constatées..."
            />
          </FormField>

          <FormField label="Action corrective">
            <SelectInput
              value={formData.action_corrective || ''}
              onChange={(val) => onChange('action_corrective', val)}
              options={ACTION_CORRECTIVE_OPTIONS}
              placeholder="Sélectionner..."
            />
          </FormField>
        </div>
      )}

      {/* TVA retirée — information contractuelle, pas technique */}
    </div>
  );
}
