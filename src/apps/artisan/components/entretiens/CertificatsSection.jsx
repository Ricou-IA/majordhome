/**
 * CertificatsSection.jsx - Majord'home Artisan
 * ============================================================================
 * Section certificats multi-équipements intégrée dans EntretienSAVModal.
 *
 * Encapsule :
 * - Chargement des équipements du contrat
 * - Lazy create des interventions enfants (1 par équipement)
 * - Barre de progression
 * - Liste CertificatEquipmentRow avec actions Remplir/Néant
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { contractsService } from '@services/contracts.service';
import { equipmentsService } from '@services/equipments.service';
import { useCertificatChildren, useCertificatEntretienMutations } from '@hooks/useCertificatEntretien';
import { CertificatEquipmentRow } from './CertificatEquipmentRow';

// ============================================================================
// COMPOSANT
// ============================================================================

/**
 * @param {Object} props
 * @param {Object} props.item - Intervention parent (entretien)
 * @param {Function} props.onCloseModal - Ferme la modale parente (pour CertificatLink navigation)
 */
export function CertificatsSection({ item, onCloseModal }) {
  // --- Hooks certificats ---
  const { children, isLoading: childrenLoading, refetch } = useCertificatChildren(item?.id);
  const { createChildren, markNeant, unmarkNeant } = useCertificatEntretienMutations();

  // --- State local ---
  const [equipments, setEquipments] = useState([]);
  const [equipmentsLoading, setEquipmentsLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState(null);
  const creatingRef = useRef(false);

  // --- Charger les équipements du contrat (fallback: équipements du client) ---
  useEffect(() => {
    if (!item?.contract_id) {
      setEquipmentsLoading(false);
      return;
    }
    contractsService.getContractEquipments(item.contract_id).then(async ({ data }) => {
      if (data && data.length > 0) {
        setEquipments(data);
      } else if (item.client_id) {
        // Fallback : contrats legacy sans contract_equipments
        const fallback = await equipmentsService.getClientEquipments(item.client_id);
        setEquipments(fallback.data || []);
      }
      setEquipmentsLoading(false);
    });
  }, [item?.contract_id, item?.client_id]);

  // --- Lazy create children si absents ---
  useEffect(() => {
    if (
      creatingRef.current ||
      childrenLoading ||
      equipmentsLoading ||
      children.length > 0 ||
      equipments.length === 0 ||
      !item
    ) return;

    creatingRef.current = true;
    createChildren(item.id, equipments, {
      projectId: item.project_id || item.client_project_id,
      clientId: item.client_id,
      contractId: item.contract_id,
    }).then(() => refetch());
  }, [childrenLoading, equipmentsLoading, children.length, equipments.length, item, createChildren, refetch]);

  // --- Handlers ---
  const handleMarkNeant = useCallback(async (childId) => {
    setMutatingId(childId);
    try { await markNeant(childId, item.id); } finally { setMutatingId(null); }
  }, [markNeant, item?.id]);

  const handleUnmarkNeant = useCallback(async (childId) => {
    setMutatingId(childId);
    try { await unmarkNeant(childId, item.id); } finally { setMutatingId(null); }
  }, [unmarkNeant, item?.id]);

  // --- Derived ---
  const childByEquipId = Object.fromEntries(children.map((c) => [c.equipment_id, c]));
  const doneCount = children.filter((c) => c.workflow_status === 'realise').length;
  const totalCount = children.length;

  // Ne rien afficher si pas encore chargé ou pas d'équipements
  if (equipmentsLoading || equipments.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4" />
        Certificats
      </h3>

      {/* Barre de progression */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              doneCount === totalCount ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
          />
        </div>
        <span className="text-xs text-gray-500">{doneCount}/{totalCount}</span>
      </div>

      {/* Liste équipements */}
      {equipments.map((eq) => (
        <CertificatEquipmentRow
          key={eq.id}
          equipment={eq}
          childIntervention={childByEquipId[eq.id] || null}
          onMarkNeant={handleMarkNeant}
          onUnmarkNeant={handleUnmarkNeant}
          isLoading={mutatingId === childByEquipId[eq.id]?.id}
          onCloseModal={onCloseModal}
        />
      ))}
    </div>
  );
}
