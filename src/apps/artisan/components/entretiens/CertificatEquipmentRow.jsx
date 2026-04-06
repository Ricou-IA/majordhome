/**
 * CertificatEquipmentRow.jsx - Majord'home Artisan
 * ============================================================================
 * Ligne d'un équipement dans la modale de certificats multi-équipements.
 * Affiche le type, marque/modèle, statut (à faire / rempli / néant)
 * et les actions correspondantes.
 *
 * @version 1.0.0
 * ============================================================================
 */

import { Loader2, Ban, Undo2 } from 'lucide-react';
import { CertificatLink } from '@/apps/artisan/components/certificat/CertificatLink';
import { EQUIPMENT_CATEGORY_LABELS } from '@/apps/artisan/components/certificat/constants';

// ============================================================================
// HELPERS
// ============================================================================

function getChildStatus(child) {
  if (!child) return 'pending';
  if (child.workflow_status === 'realise' && child.status === 'cancelled') return 'neant';
  if (child.workflow_status === 'realise') return 'done';
  return 'pending';
}

const STATUS_BADGES = {
  pending: { label: 'À faire', className: 'bg-amber-100 text-amber-700' },
  done:    { label: 'Rempli',  className: 'bg-green-100 text-green-700' },
  neant:   { label: 'Néant',   className: 'bg-gray-100 text-gray-500' },
};

// ============================================================================
// COMPOSANT
// ============================================================================

export function CertificatEquipmentRow({
  equipment,
  childIntervention,
  onMarkNeant,
  onUnmarkNeant,
  isLoading = false,
  onCloseModal,
}) {
  const status = getChildStatus(childIntervention);
  const badge = STATUS_BADGES[status];

  const categoryLabel = equipment?.category
    ? (EQUIPMENT_CATEGORY_LABELS[equipment.category] || equipment.category)
    : 'Équipement';

  const detail = [equipment?.brand, equipment?.model].filter(Boolean).join(' ');

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
      status === 'neant' ? 'bg-gray-50 border-gray-200 opacity-60' :
      status === 'done'  ? 'bg-green-50/50 border-green-200' :
                           'bg-white border-gray-200'
    }`}>
      {/* Info équipement */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{categoryLabel}</p>
        {detail && (
          <p className="text-xs text-gray-500 truncate">{detail}</p>
        )}
        {equipment?.serial_number && (
          <p className="text-[10px] text-gray-400 truncate">S/N : {equipment.serial_number}</p>
        )}
      </div>

      {/* Badge statut */}
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${badge.className}`}>
        {badge.label}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {status === 'pending' && childIntervention && (
          <>
            <CertificatLink
              interventionId={childIntervention.id}
              isRealise={false}
              label="Remplir"
              onClick={onCloseModal}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#1B4F72] text-white hover:bg-[#154360] transition-colors"
            />
            <button
              onClick={() => onMarkNeant?.(childIntervention.id)}
              disabled={isLoading}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
              title="Marquer néant"
            >
              {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
              Néant
            </button>
          </>
        )}

        {status === 'done' && childIntervention && (
          <CertificatLink
            interventionId={childIntervention.id}
            isRealise={true}
            label="Voir certificat"
            onClick={onCloseModal}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
          />
        )}

        {status === 'neant' && childIntervention && (
          <button
            onClick={() => onUnmarkNeant?.(childIntervention.id)}
            disabled={isLoading}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
            title="Annuler néant"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}
