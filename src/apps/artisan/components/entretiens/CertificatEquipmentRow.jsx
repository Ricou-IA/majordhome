/**
 * CertificatEquipmentRow.jsx - Majord'home Artisan
 * ============================================================================
 * Ligne d'un équipement dans la modale de certificats multi-équipements.
 * Affiche le type, marque/modèle, statut (à faire / rempli / conforme / néant)
 * et les actions correspondantes.
 *
 * « Conforme » = certificat allégé posé par le bureau quand le technicien n'a pas
 * rempli le sien (spec 2026-11-16) : réservé au bureau (`canConforme`), jamais
 * proposé au technicien. « Néant » garde son seul sens : équipement non entretenu.
 *
 * @version 1.0.0
 * ============================================================================
 */

import { Loader2, Ban, Undo2, BadgeCheck, FileText } from 'lucide-react';
import { CertificatLink } from '@/apps/artisan/components/certificat/CertificatLink';
import { AttestationLink } from '@/apps/artisan/components/certificat/AttestationLink';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { libelleEquipement } from '@/lib/equipmentReferential';
import { estAllege } from '@/lib/certificatConformeModel';

// ============================================================================
// HELPERS
// ============================================================================

function getChildStatus(child, certificat) {
  if (!child) return 'pending';
  if (child.workflow_status === 'realise' && child.status === 'cancelled') return 'neant';
  if (child.workflow_status === 'realise') return estAllege(certificat) ? 'conforme' : 'done';
  return 'pending';
}

const STATUS_BADGES = {
  pending: { label: 'À faire', className: 'bg-amber-100 text-amber-700' },
  done:    { label: 'Rempli',  className: 'bg-green-100 text-green-700' },
  conforme: { label: 'Conforme', className: 'bg-sky-100 text-sky-800' },
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
  orphan = false, // enfant conservé dont l'équipement a été retiré du contrat / supprimé
  certificat = null, // certificat de la ligne (allégé ou non), s'il existe
  canConforme = false, // bureau seulement, et seulement quand la liste des certificats est connue
  onConforme,
  onVoirConforme,
  canAnnulerConforme = false,
  onAnnulerConforme,
}) {
  const status = getChildStatus(childIntervention, certificat);
  const badge = STATUS_BADGES[status];

  const { index: referentiel } = useEquipmentReferential();
  const categoryLabel = orphan ? 'Équipement retiré du contrat' : libelleEquipement(equipment, referentiel);

  const detail = [equipment?.brand, equipment?.model].filter(Boolean).join(' ');

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-lg border transition-colors ${
      status === 'neant' ? 'bg-gray-50 border-gray-200 opacity-60' :
      status === 'done'  ? 'bg-green-50/50 border-green-200' :
      status === 'conforme' ? 'bg-sky-50/50 border-sky-200' :
                           'bg-white border-gray-200'
    }`}>
      {/* Info équipement */}
      <div className="flex-1 min-w-[8rem]">
        <p className="text-sm font-medium text-gray-900 truncate">{categoryLabel}</p>
        {detail && (
          <p className="text-xs text-gray-500 truncate">{detail}</p>
        )}
        {equipment?.serial_number && (
          <p className="text-[11px] text-gray-400 truncate">S/N : {equipment.serial_number}</p>
        )}
      </div>

      {/* Badge statut */}
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${badge.className}`}>
        {badge.label}
      </span>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {status === 'pending' && childIntervention && (
          <>
            <CertificatLink
              interventionId={childIntervention.id}
              isRealise={false}
              label="Remplir"
              onClick={onCloseModal}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[#1B4F72] text-white hover:bg-[#154360] transition-colors"
            />
            {canConforme && !orphan && (
              <button
                onClick={() => onConforme?.(childIntervention)}
                disabled={isLoading}
                className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-sky-300 text-sky-800 hover:bg-sky-50 transition-colors disabled:opacity-50"
                title="Entretien fait, rien d'anormal : certificat d'une page, sans saisie détaillée"
              >
                <BadgeCheck className="w-3 h-3" />
                Conforme
              </button>
            )}
            <button
              onClick={() => onMarkNeant?.(childIntervention.id)}
              disabled={isLoading}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
              title="Équipement non entretenu"
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
        {status === 'conforme' && childIntervention && (
          <button
            onClick={() => onVoirConforme?.(childIntervention)}
            disabled={isLoading}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-sky-700 text-white hover:bg-sky-800 transition-colors disabled:opacity-70"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
            Voir certificat
          </button>
        )}
        {(status === 'done' || status === 'conforme') && childIntervention && (
          <AttestationLink interventionId={childIntervention.id} onClick={onCloseModal} />
        )}
        {status === 'conforme' && childIntervention && canAnnulerConforme && (
          <button
            onClick={() => onAnnulerConforme?.(childIntervention)}
            disabled={isLoading}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
            title="Retirer le certificat conforme et remettre la ligne à faire"
          >
            <Undo2 className="w-3 h-3" />
            Annuler
          </button>
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
