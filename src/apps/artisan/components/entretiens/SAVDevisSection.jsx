/**
 * SAVDevisSection.jsx - Majord'home Artisan
 * ============================================================================
 * Section devis dans la modale SAV.
 * Montant + statut du devis (Envoyé / Accepté / Refusé).
 * Les callbacks de changement de statut déclenchent aussi les transitions
 * workflow dans le composant parent (EntretienSAVModal).
 *
 * @version 2.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { FileText } from 'lucide-react';
import { DEVIS_STATUSES } from '@services/sav.service';

const STATUS_COLORS = {
  envoye:  'bg-blue-100 text-blue-700 border-blue-300',
  accepte: 'bg-green-100 text-green-700 border-green-300',
  refuse:  'bg-red-100 text-red-700 border-red-300',
};

export function SAVDevisSection({
  devisAmount,
  devisStatus,
  onAmountChange,
  onStatusChange,
  disabled = false,
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <FileText className="w-4 h-4" />
        Devis
      </h3>

      <div className="flex items-center gap-3">
        {/* Montant */}
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Montant HT</label>
          <div className="relative">
            <input
              type="number"
              value={devisAmount || ''}
              onChange={(e) => onAmountChange?.(e.target.value ? Number(e.target.value) : null)}
              disabled={disabled}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-50 disabled:bg-gray-50"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
          </div>
        </div>

        {/* Statut */}
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Statut</label>
          <div className="flex flex-wrap gap-1.5">
            {DEVIS_STATUSES.map((s) => {
              const isActive = devisStatus === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => onStatusChange?.(isActive ? null : s.value)}
                  disabled={disabled}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-50 ${
                    isActive
                      ? STATUS_COLORS[s.value]
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SAVDevisSection;
