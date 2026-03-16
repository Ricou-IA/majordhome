/**
 * SchedulingTransitionModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale plein écran déclenchée au drag vers "Planifié" ou via bouton transition.
 * Wrapper autour de SchedulingPanel (contextuel v3.0) avec :
 * - Toggle "Réaliser l'entretien" (SAV uniquement)
 * - Affichage montant total si entretien inclus
 *
 * @version 1.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState, useMemo, useCallback } from 'react';
import { X, ClipboardCheck, Check } from 'lucide-react';
import { useTeamMembers } from '@hooks/useAppointments';
import { formatEuro } from '@/lib/utils';
import { SchedulingPanel } from '@apps/artisan/components/pipeline/SchedulingPanel';

// ============================================================================
// COMPOSANT
// ============================================================================

export function SchedulingTransitionModal({ item, orgId, onConfirm, onCancel }) {
  const { members: teamMembers } = useTeamMembers(orgId);

  const [includesEntretien, setIncludesEntretien] = useState(item?.includes_entretien || false);
  const [loading, setLoading] = useState(false);

  if (!item) return null;

  const type = item.intervention_type;
  const isSAV = type === 'sav';
  const name = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';

  const contractAmount = Number(item.contract_amount) || 0;
  const devisAmount = Number(item.devis_amount) || 0;
  const totalAmount = isSAV && includesEntretien ? devisAmount + contractAmount : devisAmount;

  // Objet "lead-like" pour le SchedulingPanel
  const schedulingLead = useMemo(() => ({
    last_name: item.client_last_name || item.client_name || '',
    first_name: item.client_first_name || '',
    phone: item.client_phone || '',
    email: item.client_email || '',
    address: item.client_address || '',
    city: item.client_city || '',
    postal_code: item.client_postal_code || '',
    assigned_user_id: null,
  }), [item]);

  // Props contextuelles du SchedulingPanel
  const appointmentTypeLabel = isSAV
    ? (includesEntretien ? 'SAV + Entretien' : 'SAV')
    : 'Entretien';
  const appointmentTypeValue = isSAV ? 'service' : 'maintenance';
  const defaultSubjectPrefix = appointmentTypeLabel;

  const defaultDuration = item.estimated_time
    ? Math.round(Number(item.estimated_time) * 60)
    : 60;

  // Toggle entretien
  const handleToggleEntretien = () => {
    setIncludesEntretien(prev => !prev);
  };

  // Confirmation planning
  const handleConfirmScheduling = useCallback(async (schedulingData) => {
    setLoading(true);
    try {
      await onConfirm(schedulingData, includesEntretien);
    } finally {
      setLoading(false);
    }
  }, [onConfirm, includesEntretien]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onCancel} />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-full max-w-lg max-h-[calc(100vh-4rem)] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-base font-semibold text-gray-900">
            Planifier — {name}
          </h2>
          <button
            onClick={onCancel}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Toggle Entretien (SAV uniquement) */}
          {isSAV && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
              <button
                type="button"
                onClick={handleToggleEntretien}
                className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-all w-full justify-center ${
                  includesEntretien
                    ? 'text-blue-700 bg-blue-100 border-blue-300'
                    : 'text-blue-700 bg-white border-blue-200 hover:bg-blue-50'
                }`}
              >
                {includesEntretien ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <ClipboardCheck className="w-4 h-4" />
                )}
                {includesEntretien ? 'Entretien inclus' : 'Réaliser l\'entretien'}
              </button>

              {includesEntretien && contractAmount > 0 && (
                <div className="flex items-center justify-between text-xs text-blue-700">
                  <span>Montant total (devis + entretien)</span>
                  <span className="font-bold">{formatEuro(totalAmount)}</span>
                </div>
              )}
            </div>
          )}

          {/* SchedulingPanel */}
          <SchedulingPanel
            lead={schedulingLead}
            orgId={orgId}
            commercials={[]}
            onConfirm={handleConfirmScheduling}
            onCancel={onCancel}
            isLoading={loading}
            appointmentTypeLabel={appointmentTypeLabel}
            appointmentTypeValue={appointmentTypeValue}
            assigneeType="technician"
            members={teamMembers || []}
            defaultDuration={defaultDuration}
            defaultSubjectPrefix={defaultSubjectPrefix}
          />
        </div>
      </div>
    </>
  );
}

export default SchedulingTransitionModal;
