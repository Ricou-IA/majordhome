/**
 * ChantierModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale orchestrateur pour un chantier.
 * Contient : infos client, commandes, intervention, notes, transitions.
 *
 * @version 1.0.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, ArrowLeft, ArrowRight, Archive, User, MapPin, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatEuro } from '@/lib/utils';
import {
  CHANTIER_STATUSES,
  CHANTIER_TRANSITIONS,
  getChantierStatusConfig,
} from '@/shared/services/chantiers.service';
import { interventionsService } from '@/shared/services/interventions.service';
import { useChantierMutations, useInterventionSlots } from '@/shared/hooks/useChantiers';
import { useTeamMembers } from '@/shared/hooks/useAppointments';
import { FormField, TextArea } from '@apps/artisan/components/FormFields';
import { ChantierOrderSection } from './ChantierOrderSection';
import { ChantierInterventionSection } from './ChantierInterventionSection';

export function ChantierModal({ chantier, onClose, onUpdated, effectiveRole, canEditAll = true }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;

  const {
    updateChantierStatus,
    updateOrderStatus,
    updateEstimatedDate,
    updateChantierNotes,
    createChantierIntervention,
    createSlot,
    deleteSlot,
    isUpdatingStatus,
    isUpdatingOrder,
    isCreatingIntervention,
    isCreatingSlot,
  } = useChantierMutations();

  const { members } = useTeamMembers(orgId);

  // État local
  const [equipmentOrder, setEquipmentOrder] = useState(chantier?.equipment_order_status || '');
  const [materialsOrder, setMaterialsOrder] = useState(chantier?.materials_order_status || '');
  const [estimatedDate, setEstimatedDate] = useState(chantier?.estimated_date || '');
  const [notes, setNotes] = useState(chantier?.chantier_notes || '');
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // Intervention parent
  const [parentIntervention, setParentIntervention] = useState(null);
  const [loadingParent, setLoadingParent] = useState(true);

  // Charger l'intervention parent
  useEffect(() => {
    if (!chantier?.id) {
      setLoadingParent(false);
      return;
    }
    const load = async () => {
      try {
        const { data } = await interventionsService.getChantierInterventionByLeadId(chantier.id);
        setParentIntervention(data);
      } catch (err) {
        console.error('[ChantierModal] load parent error:', err);
      } finally {
        setLoadingParent(false);
      }
    };
    load();
  }, [chantier?.id]);

  // Slots de l'intervention parent
  const { slots, refresh: refreshSlots } = useInterventionSlots(parentIntervention?.id);

  if (!chantier) return null;

  const statusConfig = getChantierStatusConfig(chantier.chantier_status);
  const isTechnicien = effectiveRole === 'technicien';
  const isOwner = chantier.assigned_user_id === user?.id;
  const canEditChantier = canEditAll || isOwner;

  // Technicien : seulement planification → réalisé
  const allTransitions = CHANTIER_TRANSITIONS[chantier.chantier_status] || [];
  const allowedTransitions = isTechnicien
    ? allTransitions.filter(
        (t) => chantier.chantier_status === 'planification' && t === 'realise',
      )
    : canEditChantier
      ? allTransitions
      : [];
  const name = `${chantier.last_name || ''} ${chantier.first_name || ''}`.trim() || 'Sans nom';
  const amount = Number(chantier.order_amount_ht) || Number(chantier.estimated_revenue) || 0;

  // Handlers
  const handleOrderTransitionToast = (result) => {
    if (!result?.autoTransitioned) return;
    const newStatus = result?.data?.[0]?.chantier_status;
    if (newStatus === 'commande_recue') {
      toast.success('Commandes complètes — passage en "À planifier"');
    } else if (newStatus === 'commande_a_faire') {
      toast.info('Retour en "Commande à faire"');
    }
  };

  const handleEquipmentChange = async (val) => {
    setEquipmentOrder(val);
    try {
      const result = await updateOrderStatus(chantier.id, {
        equipmentOrderStatus: val || null,
        materialsOrderStatus: materialsOrder || null,
        currentChantierStatus: chantier.chantier_status,
      });
      handleOrderTransitionToast(result);
      onUpdated?.();
    } catch {
      toast.error('Erreur de mise à jour');
    }
  };

  const handleMaterialsChange = async (val) => {
    setMaterialsOrder(val);
    try {
      const result = await updateOrderStatus(chantier.id, {
        equipmentOrderStatus: equipmentOrder || null,
        materialsOrderStatus: val || null,
        currentChantierStatus: chantier.chantier_status,
      });
      handleOrderTransitionToast(result);
      onUpdated?.();
    } catch {
      toast.error('Erreur de mise à jour');
    }
  };

  const handleEstimatedDateChange = async (val) => {
    setEstimatedDate(val);
    try {
      await updateEstimatedDate(chantier.id, val || null);
      onUpdated?.();
    } catch {
      toast.error('Erreur de mise à jour');
    }
  };

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    try {
      await updateChantierNotes(chantier.id, notes);
      toast.success('Notes sauvegardées');
      onUpdated?.();
    } catch {
      toast.error('Erreur de sauvegarde');
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleTransition = async (newStatus) => {
    try {
      await updateChantierStatus(chantier.id, newStatus);
      toast.success(`Statut mis à jour`);
      onUpdated?.();
      onClose();
    } catch {
      toast.error('Erreur de transition');
    }
  };

  const handleCreateParent = async () => {
    const result = await createChantierIntervention({
      leadId: chantier.id,
      projectId: chantier.project_id,
      equipmentId: chantier.equipment_id || null,
      createdBy: user?.id,
    });
    if (result?.data) {
      setParentIntervention(result.data);
      // Auto-transition vers planification
      if (['commande_a_faire', 'commande_recue'].includes(chantier.chantier_status)) {
        await updateChantierStatus(chantier.id, 'planification');
        toast.success('Passage en Planification');
      }
    }
    onUpdated?.();
  };

  const handleAddSlot = async (slotData) => {
    await createSlot({
      parentId: parentIntervention.id,
      projectId: chantier.project_id,
      slotDate: slotData.slotDate,
      slotStartTime: slotData.slotStartTime || null,
      slotEndTime: slotData.slotEndTime || null,
      technicianIds: slotData.technicianIds || [],
      slotNotes: slotData.slotNotes || null,
      createdBy: user?.id,
    });
    refreshSlots();
    onUpdated?.();
  };

  const handleDeleteSlot = async (slotId) => {
    await deleteSlot(slotId);
    refreshSlots();
    onUpdated?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Contenu */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[calc(100vh-4rem)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: statusConfig.color }}
            />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900 truncate">{name}</h2>
              <p className="text-xs text-gray-500">{statusConfig.label}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Infos client */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <User className="w-4 h-4 text-gray-400" />
              <span>{name}</span>
              {amount > 0 && (
                <span className="ml-auto text-sm font-semibold text-emerald-700">
                  {formatEuro(amount)}
                </span>
              )}
            </div>
            {(chantier.postal_code || chantier.city) && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span>{[chantier.postal_code, chantier.city].filter(Boolean).join(' ')}</span>
              </div>
            )}
            {chantier.equipment_type_label && (
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                {chantier.equipment_type_label}
              </span>
            )}
          </div>

          {/* Section commandes */}
          {!isTechnicien && (
            <ChantierOrderSection
              equipmentOrderStatus={equipmentOrder}
              materialsOrderStatus={materialsOrder}
              estimatedDate={estimatedDate}
              onEquipmentChange={handleEquipmentChange}
              onMaterialsChange={handleMaterialsChange}
              onEstimatedDateChange={handleEstimatedDateChange}
              disabled={isUpdatingOrder || !canEditChantier}
            />
          )}

          {/* Section intervention */}
          {loadingParent ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : (
            <ChantierInterventionSection
              parentIntervention={parentIntervention}
              slots={slots}
              members={members}
              onCreateParent={handleCreateParent}
              onAddSlot={handleAddSlot}
              onDeleteSlot={handleDeleteSlot}
              isCreatingParent={isCreatingIntervention}
              isCreatingSlot={isCreatingSlot}
              disabled={chantier.chantier_status === 'gagne'}
            />
          )}

          {/* Notes */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Notes
            </h3>
            <FormField>
              <TextArea
                value={notes}
                onChange={canEditChantier ? setNotes : undefined}
                placeholder="Notes sur le chantier..."
                rows={3}
                disabled={!canEditChantier}
              />
            </FormField>
            {canEditChantier && notes !== (chantier.chantier_notes || '') && (
              <button
                type="button"
                onClick={handleSaveNotes}
                disabled={isSavingNotes}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50 transition-colors"
              >
                {isSavingNotes ? 'Sauvegarde...' : 'Sauvegarder les notes'}
              </button>
            )}
          </div>
        </div>

        {/* Footer : transitions */}
        {allowedTransitions.length > 0 && (() => {
          const currentOrder = statusConfig.display_order;
          const backTransitions = allowedTransitions.filter((t) => {
            const cfg = getChantierStatusConfig(t);
            return cfg.display_order < currentOrder;
          });
          const forwardTransitions = allowedTransitions.filter((t) => {
            if (t === 'archive') return true;
            const cfg = getChantierStatusConfig(t);
            return cfg.display_order > currentOrder;
          });

          return (
            <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl flex items-center gap-2 flex-wrap">
              {/* Retour arrière à gauche */}
              {backTransitions.map((targetStatus) => {
                const config = getChantierStatusConfig(targetStatus);
                return (
                  <button
                    key={targetStatus}
                    type="button"
                    onClick={() => handleTransition(targetStatus)}
                    disabled={isUpdatingStatus}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-500 bg-white transition-colors hover:shadow-sm hover:bg-gray-100 disabled:opacity-50"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    {config.label}
                  </button>
                );
              })}

              <div className="flex-1" />

              {/* Avancer à droite */}
              {forwardTransitions.map((targetStatus) => {
                if (targetStatus === 'archive') {
                  return (
                    <button
                      key={targetStatus}
                      type="button"
                      onClick={() => handleTransition(targetStatus)}
                      disabled={isUpdatingStatus}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-500 bg-gray-50 transition-colors hover:shadow-sm hover:bg-gray-100 disabled:opacity-50"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      Archiver
                    </button>
                  );
                }
                const config = getChantierStatusConfig(targetStatus);
                return (
                  <button
                    key={targetStatus}
                    type="button"
                    onClick={() => handleTransition(targetStatus)}
                    disabled={isUpdatingStatus}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors hover:shadow-sm disabled:opacity-50"
                    style={{
                      borderColor: config.color,
                      color: config.color,
                      backgroundColor: `${config.color}08`,
                    }}
                  >
                    {config.label}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default ChantierModal;
