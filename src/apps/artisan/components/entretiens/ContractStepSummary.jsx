/**
 * ContractStepSummary.jsx
 * ============================================================================
 * Étape 3 du wizard contrat : Détails du contrat + résumé
 * Extrait de CreateContractModal.jsx
 * ============================================================================
 */

import { User, Wrench } from 'lucide-react';
import { FormField, TextInput, SelectInput, TextArea } from '../FormFields';
import { MAINTENANCE_MONTHS } from '@services/contracts.service';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function Step3Contract({
  selectedClient,
  newClientData,
  clientMode,
  contractData,
  calculator,
  onContractDataChange,
}) {
  const clientName =
    clientMode === 'search'
      ? selectedClient?.display_name || `${selectedClient?.last_name || ''} ${selectedClient?.first_name || ''}`.trim()
      : `${newClientData.lastName} ${newClientData.firstName}`.trim();

  const clientLocation =
    clientMode === 'search'
      ? [selectedClient?.postal_code, selectedClient?.city].filter(Boolean).join(' ')
      : [newClientData.postalCode, newClientData.city].filter(Boolean).join(' ');

  return (
    <div className="space-y-5">
      {/* Résumé client */}
      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-blue-600" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{clientName || 'Nouveau client'}</p>
          {clientLocation && (
            <p className="text-sm text-gray-500 truncate">{clientLocation}</p>
          )}
          {clientMode === 'create' && (
            <p className="text-xs text-blue-600 mt-0.5">Nouveau client — sera créé automatiquement</p>
          )}
        </div>
      </div>

      {/* Résumé tarification */}
      {calculator.hasItems && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-800 flex items-center gap-1.5">
              <Wrench className="w-4 h-4" />
              {calculator.items.length} équipement{calculator.items.length > 1 ? 's' : ''} · {calculator.activeZone?.code}
            </span>
            <span className="text-lg font-bold text-blue-700 tabular-nums">
              {calculator.pricing.total.toFixed(2)} €
            </span>
          </div>
          <div className="space-y-1">
            {calculator.items.map((item, idx) => (
              <p key={idx} className="text-xs text-blue-700">
                • {item.equipType?.label || item.equipmentTypeCode}
                {item.quantity > 1 && ` (×${item.quantity})`}
                {' — '}{item.lineTotal?.toFixed(0)}€
              </p>
            ))}
            {calculator.pricing.discountPercent > 0 && (
              <p className="text-xs text-green-700">
                • Remise -{calculator.pricing.discountPercent}% : -{calculator.pricing.discountAmount.toFixed(0)}€
              </p>
            )}
          </div>
        </div>
      )}

      {/* Séparateur */}
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t border-gray-200" />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Détails du contrat</span>
        <div className="flex-1 border-t border-gray-200" />
      </div>

      {/* Date de début + Mois de maintenance */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date de début">
          <TextInput
            type="date"
            value={contractData.startDate}
            onChange={(val) => onContractDataChange('startDate', val)}
          />
        </FormField>
        <FormField label="Mois de maintenance">
          <SelectInput
            value={contractData.maintenanceMonth}
            onChange={(val) => onContractDataChange('maintenanceMonth', val)}
            options={MAINTENANCE_MONTHS}
            placeholder="— Choisir —"
          />
        </FormField>
      </div>

      {/* Notes */}
      <FormField label="Notes">
        <TextArea
          value={contractData.notes}
          onChange={(val) => onContractDataChange('notes', val)}
          placeholder="Notes complémentaires..."
          rows={3}
        />
      </FormField>
    </div>
  );
}
