/**
 * SAVPartsSection.jsx - Majord'home Artisan
 * ============================================================================
 * Section commande de pièces dans la modale SAV.
 * Seulement Commandé / Reçu.
 * Quand "Reçu" → callback auto-transition vers "À planifier".
 *
 * @version 2.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { Package, Check, Clock } from 'lucide-react';
import { PARTS_ORDER_STATUSES } from '@services/sav.service';

const STATUS_ICONS = {
  commande: { Icon: Clock, color: 'text-amber-500' },
  recu:     { Icon: Check, color: 'text-green-500' },
};

function StatusButton({ statusValue, currentStatus, onChange, disabled }) {
  const config = PARTS_ORDER_STATUSES.find(s => s.value === statusValue);
  const iconConfig = STATUS_ICONS[statusValue];
  if (!config || !iconConfig) return null;

  const isActive = currentStatus === statusValue;
  const { Icon, color } = iconConfig;

  return (
    <button
      type="button"
      onClick={() => onChange(isActive ? null : statusValue)}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all disabled:opacity-50 ${
        isActive
          ? 'border-gray-400 bg-gray-50 shadow-sm'
          : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <Icon className={`w-4 h-4 ${isActive ? color : 'text-gray-400'}`} />
      {config.label}
    </button>
  );
}

export function SAVPartsSection({ partsOrderStatus, onChange, disabled = false }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <Package className="w-4 h-4" />
        Commande pièces
      </h3>

      <div className="flex flex-wrap gap-2">
        {PARTS_ORDER_STATUSES.map((status) => (
          <StatusButton
            key={status.value}
            statusValue={status.value}
            currentStatus={partsOrderStatus}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}

export default SAVPartsSection;
