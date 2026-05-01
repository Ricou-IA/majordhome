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
import { useNavigate } from 'react-router-dom';
import { X, Loader2, ArrowLeft, ArrowRight, Archive, User, MapPin, FileText, ExternalLink, CheckCircle2, PenTool, ScrollText, CalendarDays, Car } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatEuro } from '@/lib/utils';
import { getDrivingFromAddress } from '@/lib/zoneDetection';
import {
  CHANTIER_TRANSITIONS,
  getChantierStatusConfig,
  chantiersService,
} from '@services/chantiers.service';
import { interventionsService } from '@services/interventions.service';
import { useChantierMutations, useInterventionSlots } from '@hooks/useChantiers';
import { useTeamMembers } from '@hooks/useAppointments';
import { usePennylaneQuoteLines } from '@hooks/usePennylane';
import { contractsService } from '@services/contracts.service';
import { supabase } from '@/lib/supabaseClient';
import { FormField, TextInput, TextArea } from '@apps/artisan/components/FormFields';
import { CreateContractModal } from '../entretiens/CreateContractModal';
import { ChantierReceptionSection } from './ChantierReceptionSection';
import { ChantierInterventionSection } from './ChantierInterventionSection';

export function ChantierModal({ chantier, onClose, onUpdated, effectiveRole, canEditAll = true }) {
  const { organization, user } = useAuth();
  const navigate = useNavigate();
  const orgId = organization?.id;

  const {
    updateChantierStatus,
    updateEstimatedDate,
    updateChantierNotes,
    createChantierIntervention,
    createSlot,
    deleteSlot,
    isUpdatingStatus,
    isCreatingIntervention,
    isCreatingSlot,
  } = useChantierMutations();

  const { members } = useTeamMembers(orgId);

  // État local
  const [estimatedDate, setEstimatedDate] = useState(chantier?.estimated_date || '');
  const [notes, setNotes] = useState(chantier?.chantier_notes || '');
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // PV de réception
  const [pvPath] = useState(chantier?.pv_reception_path || null);

  // Proposition contrat d'entretien
  const [showContractModal, setShowContractModal] = useState(false);
  const [clientForContract, setClientForContract] = useState(null);
  const [loadingContract, setLoadingContract] = useState(false);

  // Intervention parent
  const [parentIntervention, setParentIntervention] = useState(null);
  const [loadingParent, setLoadingParent] = useState(true);

  // Devis Pennylane lié — pour récupérer le montant HT validé (cache partagé
  // avec ChantierReceptionSection via React Query, donc 1 seul appel réseau)
  const { quote: pennylaneQuote } = usePennylaneQuoteLines(chantier?.pennylane_quote_id);

  // Trajet depuis le siège (Gaillac) — calcul Mapbox idempotent (cache module)
  const [drivingInfo, setDrivingInfo] = useState(null);
  const [isLoadingDriving, setIsLoadingDriving] = useState(false);

  useEffect(() => {
    if (!chantier?.postal_code && !chantier?.city) {
      setDrivingInfo(null);
      return;
    }
    let cancelled = false;
    setIsLoadingDriving(true);
    getDrivingFromAddress(
      chantier.address || '',
      chantier.postal_code || '',
      chantier.city || ''
    )
      .then((result) => {
        if (cancelled) return;
        setDrivingInfo(result.durationMinutes != null ? result : null);
      })
      .catch(() => {
        if (!cancelled) setDrivingInfo(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDriving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chantier?.id, chantier?.address, chantier?.postal_code, chantier?.city]);

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
  // Priorité au montant HT du devis Pennylane validé (source de vérité quand devis lié) ;
  // sinon fallback sur estimation pipeline (order_amount_ht / estimated_revenue)
  const amount = Number(pennylaneQuote?.amount_ht) || Number(chantier.order_amount_ht) || Number(chantier.estimated_revenue) || 0;

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

  const handleViewPv = async () => {
    const { url, error } = await chantiersService.getPvReceptionUrl(pvPath);
    if (error || !url) {
      toast.error('Impossible de charger le PV');
      return;
    }
    window.open(url, '_blank');
  };

  const handleSignPv = () => {
    onClose();
    navigate(`/chantiers/${chantier.id}/pv-reception`);
  };

  const handleTransition = async (newStatus) => {
    // Bloquer transition vers réceptionné sans PV
    if (newStatus === 'realise' && !pvPath) {
      toast.error('Veuillez d\'abord téléverser le PV de réception');
      return;
    }
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

  const handleProposeContract = async () => {
    if (!chantier.client_id) {
      toast.error('Aucun client lié à ce chantier');
      return;
    }
    setLoadingContract(true);
    try {
      // Vérifier si le client a déjà un contrat (UNIQUE constraint sur client_id)
      const { data: existing } = await contractsService.getContractByClientId(chantier.client_id);
      if (existing) {
        toast.error('Ce client possède déjà un contrat');
        return;
      }
      // Charger les données client (adresse, etc.) pour le pré-remplissage
      const { data: client, error: clientErr } = await supabase
        .from('majordhome_clients')
        .select('id, display_name, first_name, last_name, address, postal_code, city, has_active_contract, project_id')
        .eq('id', chantier.client_id)
        .single();
      if (clientErr || !client) {
        toast.error('Impossible de charger les données client');
        return;
      }
      setClientForContract(client);
      setShowContractModal(true);
    } catch {
      toast.error('Erreur lors de la vérification');
    } finally {
      setLoadingContract(false);
    }
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
    <>
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Contenu */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[calc(100vh-4rem)] flex flex-col">
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
            {(chantier.address || chantier.postal_code || chantier.city) && (
              <div className="flex items-start gap-2 text-sm text-gray-500">
                <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div>
                    {[
                      chantier.address,
                      [chantier.postal_code, chantier.city].filter(Boolean).join(' '),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                  {isLoadingDriving && (
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Calcul du trajet…
                    </div>
                  )}
                  {!isLoadingDriving && drivingInfo && (
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <Car className="w-3 h-3" />
                      {drivingInfo.durationMinutes} min · {drivingInfo.distanceKm} km depuis Gaillac
                    </div>
                  )}
                </div>
              </div>
            )}
            {chantier.equipment_type_label && (
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                {chantier.equipment_type_label}
              </span>
            )}
          </div>

          {/* Section réception marchandise (devis Pennylane ligne par ligne) */}
          {!isTechnicien && (
            <>
              <ChantierReceptionSection
                chantier={chantier}
                onUpdated={onUpdated}
                disabled={!canEditChantier}
              />

              {/* Date estimative de réalisation (déconnectée des commandes) */}
              <FormField label="Date estimative de réalisation">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
                  <TextInput
                    type="date"
                    value={estimatedDate || ''}
                    onChange={handleEstimatedDateChange}
                    disabled={!canEditChantier}
                  />
                </div>
              </FormField>
            </>
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

          {/* PV de réception — visible dès planification */}
          {['planification', 'realise', 'facture'].includes(chantier.chantier_status) && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4" />
                PV de Réception
              </h3>

              {pvPath ? (
                <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                  <span className="text-sm text-green-800 font-medium flex-1">PV signé</span>
                  <button
                    type="button"
                    onClick={handleViewPv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-green-300 text-green-700 hover:bg-green-100 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Voir le PV
                  </button>
                  {canEditChantier && (
                    <button
                      type="button"
                      onClick={handleSignPv}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                      <PenTool className="w-3.5 h-3.5" />
                      Refaire
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-amber-800 mb-3">
                    Le PV de réception signé est requis pour passer en « Réceptionné ».
                  </p>
                  {canEditChantier && (
                    <button
                      type="button"
                      onClick={handleSignPv}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-green-300 text-green-700 hover:bg-green-50 bg-green-50 transition-colors"
                    >
                      <PenTool className="w-4 h-4" />
                      Signer le PV de réception
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Proposition contrat d'entretien — visible au statut réceptionné */}
          {chantier.chantier_status === 'realise' && !isTechnicien && canEditChantier && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
                <ScrollText className="w-4 h-4" />
                Contrat d'entretien
              </h3>
              <button
                type="button"
                onClick={handleProposeContract}
                disabled={loadingContract}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                {loadingContract ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Vérification...
                  </>
                ) : (
                  <>
                    <ScrollText className="w-4 h-4" />
                    Proposer un contrat d'entretien
                  </>
                )}
              </button>
            </div>
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
                const needsPv = targetStatus === 'realise' && !pvPath;
                return (
                  <button
                    key={targetStatus}
                    type="button"
                    onClick={() => handleTransition(targetStatus)}
                    disabled={isUpdatingStatus || needsPv}
                    title={needsPv ? 'PV de réception requis' : undefined}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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

    {/* Modale création contrat (couche z-index supérieure) */}
    {showContractModal && (
      <CreateContractModal
        isOpen={showContractModal}
        onClose={() => setShowContractModal(false)}
        onSuccess={() => {
          setShowContractModal(false);
          onUpdated?.();
        }}
        preSelectedClient={clientForContract}
        preSelectedEquipmentTypeId={chantier.equipment_type_id || null}
        contractDefaults={{ status: 'pending', workflowStatus: 'nouveau', source: 'chantier' }}
      />
    )}
    </>
  );
}

export default ChantierModal;
