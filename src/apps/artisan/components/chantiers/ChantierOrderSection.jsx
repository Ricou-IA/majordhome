/**
 * ChantierOrderSection.jsx - Majord'home Artisan
 * ============================================================================
 * Section commande dans la modale chantier.
 * Checkboxes visuelles : Commandé → Reçu pour équipement et matériaux.
 *
 * @version 1.2.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { Package, Check } from 'lucide-react';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';

/**
 * Checkbox stylisée pour le suivi commande.
 * 3 états possibles du champ DB : null/'na' → 'commande' → 'recu'
 */
function OrderCheckbox({ label, checked, onChange, disabled, color = 'blue' }) {
  const colorMap = {
    blue: {
      checked: 'bg-blue-600 border-blue-600',
      hover: 'hover:border-blue-400',
      text: 'text-blue-700',
    },
    emerald: {
      checked: 'bg-emerald-600 border-emerald-600',
      hover: 'hover:border-emerald-400',
      text: 'text-emerald-700',
    },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <label className={`flex items-center gap-2 cursor-pointer select-none ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0
          ${checked
            ? `${c.checked} text-white`
            : `border-gray-300 bg-white ${c.hover}`
          }`}
      >
        {checked && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
      </button>
      <span className={`text-sm font-medium ${checked ? c.text : 'text-gray-600'}`}>
        {label}
      </span>
    </label>
  );
}

function OrderTrack({ title, orderStatus, onStatusChange, disabled }) {
  const isCommande = orderStatus === 'commande' || orderStatus === 'recu';
  const isRecu = orderStatus === 'recu';
  const isNA = orderStatus === 'na';

  const handleCommandeToggle = (checked) => {
    if (checked) {
      onStatusChange('commande');
    } else {
      // Décocher "Commandé" reset tout
      onStatusChange(null);
    }
  };

  const handleRecuToggle = (checked) => {
    if (checked) {
      onStatusChange('recu');
    } else {
      // Décocher "Reçu" revient à "Commandé"
      onStatusChange('commande');
    }
  };

  const handleNAToggle = (checked) => {
    if (checked) {
      onStatusChange('na');
    } else {
      onStatusChange(null);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</p>
      <div className="flex items-center gap-4">
        <OrderCheckbox
          label="Commandé"
          checked={isCommande}
          onChange={handleCommandeToggle}
          disabled={disabled || isNA}
          color="blue"
        />
        <OrderCheckbox
          label="Reçu"
          checked={isRecu}
          onChange={handleRecuToggle}
          disabled={disabled || !isCommande || isNA}
          color="emerald"
        />
      </div>
      <label className={`flex items-center gap-2 cursor-pointer select-none ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <input
          type="checkbox"
          checked={isNA}
          onChange={(e) => handleNAToggle(e.target.checked)}
          disabled={disabled}
          className="w-3.5 h-3.5 rounded border-gray-300 text-gray-400 focus:ring-gray-400"
        />
        <span className="text-xs text-gray-400">N/A</span>
      </label>
    </div>
  );
}

export function ChantierOrderSection({
  equipmentOrderStatus,
  materialsOrderStatus,
  estimatedDate,
  onEquipmentChange,
  onMaterialsChange,
  onEstimatedDateChange,
  disabled = false,
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <Package className="w-4 h-4" />
        Commandes & Planification
      </h3>

      <div className="grid grid-cols-2 gap-6">
        <OrderTrack
          title="Équipement"
          orderStatus={equipmentOrderStatus}
          onStatusChange={onEquipmentChange}
          disabled={disabled}
        />
        <OrderTrack
          title="Matériaux"
          orderStatus={materialsOrderStatus}
          onStatusChange={onMaterialsChange}
          disabled={disabled}
        />
      </div>

      <FormField label="Date estimative de réalisation">
        <TextInput
          type="date"
          value={estimatedDate || ''}
          onChange={onEstimatedDateChange}
          disabled={disabled}
        />
      </FormField>
    </div>
  );
}

export default ChantierOrderSection;
