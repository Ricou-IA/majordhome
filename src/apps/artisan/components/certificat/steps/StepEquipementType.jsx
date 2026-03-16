/**
 * StepEquipementType.jsx - Étape 0 du wizard certificat
 * ============================================================================
 * Sélection ou auto-détection du type d'équipement.
 * Si l'intervention a déjà un equipment_id → on passe automatiquement.
 * Sinon → sélecteur dropdown ou recherche dans le parc client.
 * ============================================================================
 */

import { EQUIPMENT_CATEGORY_LABELS } from '../constants';
import { FormField, SelectInput } from '@apps/artisan/components/FormFields';
import { SectionTitle } from '@apps/artisan/components/FormFields';
import { AlertCircle, CheckCircle } from 'lucide-react';

const categoryOptions = Object.entries(EQUIPMENT_CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function StepEquipementType({ formData, onChange, equipment, clientEquipments }) {
  const hasEquipment = !!equipment;

  // Si équipement déjà lié → afficher un résumé read-only
  if (hasEquipment) {
    return (
      <div className="space-y-4">
        <SectionTitle>Équipement détecté</SectionTitle>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-800">
              {EQUIPMENT_CATEGORY_LABELS[equipment.category] || equipment.category}
            </p>
            <p className="text-sm text-green-700">
              {[equipment.brand, equipment.model].filter(Boolean).join(' ') || 'Marque/modèle non renseignés'}
            </p>
            {equipment.serial_number && (
              <p className="text-xs text-green-600 mt-1">N° série : {equipment.serial_number}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Si pas d'équipement lié → sélection manuelle
  return (
    <div className="space-y-4">
      <SectionTitle>Type d'équipement</SectionTitle>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700">
          Aucun équipement lié à cette intervention. Sélectionnez le type manuellement.
        </p>
      </div>

      <FormField label="Type d'équipement" required>
        <SelectInput
          value={formData.equipement_type}
          onChange={(val) => onChange('equipement_type', val)}
          options={categoryOptions}
          placeholder="Sélectionner le type..."
        />
      </FormField>

      {/* Recherche dans le parc client */}
      {clientEquipments && clientEquipments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Ou sélectionner dans le parc client :</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {clientEquipments.map(eq => (
              <button
                key={eq.id}
                type="button"
                onClick={() => {
                  onChange('equipement_type', eq.category);
                  onChange('equipment_id', eq.id);
                  onChange('equipement_marque', eq.brand || '');
                  onChange('equipement_modele', eq.model || '');
                  onChange('equipement_numero_serie', eq.serial_number || '');
                  onChange('equipement_puissance_kw', eq.metadata?.puissance_kw || null);
                  onChange('equipement_fluide', eq.metadata?.fluide || '');
                  onChange('equipement_charge_kg', eq.metadata?.charge_kg || null);
                  if (eq.install_date) {
                    onChange('equipement_annee', new Date(eq.install_date).getFullYear());
                  }
                }}
                className="w-full text-left p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <p className="text-sm font-medium text-gray-800">
                  {EQUIPMENT_CATEGORY_LABELS[eq.category] || eq.category}
                </p>
                <p className="text-xs text-gray-500">
                  {[eq.brand, eq.model].filter(Boolean).join(' ') || 'Non renseigné'}
                  {eq.serial_number && ` — N° ${eq.serial_number}`}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
