/**
 * EntretienSAVModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale détail pour un item Entretien ou SAV.
 *
 * Features :
 * - Header avec tag type + statut + lien fiche client
 * - Infos client + date dernier entretien
 * - Toggle "Réaliser Entretien" (tag la carte SAV, pas de nouvelle carte)
 * - Description SAV (SAV uniquement)
 * - Commande pièces : Commandé / Reçu (Reçu → auto-transition a_planifier)
 * - Devis : Envoyé → devis_envoye, Accepté → pieces_commandees, Refusé → stocké
 * - Notes
 * - Bouton "Enregistrer" unique pour sauvegarder tous les champs modifiés
 * - Footer : boutons transition back/forward
 * - Transition "Planifié" → ouvre le SchedulingAssistant (jour + colonnes par tech)
 *
 * @version 4.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Loader2, ArrowLeft, ArrowRight, Save,
  User, MapPin, Phone, ClipboardCheck, Wrench, Mail, FileText,
  ExternalLink, Calendar, Check, UserPlus, Archive,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { formatEuro, formatDateShortFR } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import { entretienSavKeys } from '@hooks/cacheKeys';
import {
  savService,
  getStatusConfig,
  getTransitions,
  KANBAN_COLUMNS,
} from '@services/sav.service';
import { appointmentsService } from '@services/appointments.service';
import { clientsService } from '@services/clients.service';
import { EntretienPartsSection } from './EntretienPartsSection';
import { useEntretienSAVMutations } from '@hooks/useEntretienSAV';
import { useTeamMembers } from '@hooks/useAppointments';
import { FormField, TextArea } from '@apps/artisan/components/FormFields';
import { SchedulingAssistant } from '@apps/artisan/components/planning/scheduling/SchedulingAssistant';
import { SAVPartsSection } from './SAVPartsSection';
import { SAVDevisSection } from './SAVDevisSection';
import { CertificatsSection } from './CertificatsSection';

// ============================================================================
// CONSTANTES
// ============================================================================

const TYPE_LABELS = {
  entretien: { label: 'Entretien', bgClass: 'bg-blue-100 text-blue-700', Icon: ClipboardCheck },
  sav:       { label: 'SAV',       bgClass: 'bg-orange-100 text-orange-700', Icon: Wrench },
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function EntretienSAVModal({ item, onClose, onUpdated, onCreateSAV, onOpenClient, onOpenCertificats }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const { can } = useCanAccess();
  const orgId = organization?.id;

  const {
    updateWorkflowStatus,
    updateFields,
    isUpdatingStatus,
    isSavingFields,
  } = useEntretienSAVMutations();

  // Techniciens pour le SchedulingAssistant (mode SAV-Entretien)
  const { members: teamMembers } = useTeamMembers(orgId);

  // État local — tous les champs éditables
  const [notes, setNotes] = useState(item?.report_notes || '');
  const [savDesc, setSavDesc] = useState(item?.sav_description || '');
  const [partsOrder, setPartsOrder] = useState(item?.parts_order_status || null);
  const [devisAmount, setDevisAmount] = useState(item?.devis_amount || null);
  const [devisStatus, setDevisStatus] = useState(item?.devis_status || null);
  const [includesEntretien, setIncludesEntretien] = useState(item?.includes_entretien || false);
  const [lastEntretienDate, setLastEntretienDate] = useState(null);

  // État planification
  const [showScheduling, setShowScheduling] = useState(false);
  const [schedulingLoading, setSchedulingLoading] = useState(false);

  // --- Certificats multi-équipements ---
  const isEntretien = item?.intervention_type === 'entretien';
  // Certificats : seulement une fois le RDV planifié (déclencheur de la suite),
  // pas en "Demande de contrat" ni "À planifier"
  const showCertificatsSection = isEntretien && item?.contract_id
    && !['demande_contrat', 'a_planifier'].includes(item?.workflow_status);

  // Charger la date du dernier entretien réalisé via maintenance_visits (source de vérité)
  useEffect(() => {
    if (!item?.contract_id) return;

    supabase
      .from('majordhome_maintenance_visits')
      .select('visit_date')
      .eq('contract_id', item.contract_id)
      .eq('status', 'completed')
      .order('visit_date', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0 && data[0].visit_date) {
          setLastEntretienDate(data[0].visit_date);
        }
      });
  }, [item?.contract_id]);

  // Charger les équipements du contrat
  const [contractEquipments, setContractEquipments] = useState([]);
  useEffect(() => {
    if (!item?.contract_id) return;

    supabase
      .from('majordhome_contract_pricing_items')
      .select('quantity, equipment_type_label')
      .eq('contract_id', item.contract_id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setContractEquipments(data);
        }
      });
  }, [item?.contract_id]);

  // --- Dirty check : savoir si quelque chose a changé ---
  // (déclaré AVANT early return — règle React Hooks : ordre stable)
  const isDirty = useMemo(() => {
    if (!item) return false;
    if (notes !== (item.report_notes || '')) return true;
    if (savDesc !== (item.sav_description || '')) return true;
    if (partsOrder !== (item.parts_order_status || null)) return true;
    if (devisAmount !== (item.devis_amount || null)) return true;
    if (devisStatus !== (item.devis_status || null)) return true;
    if (includesEntretien !== (item.includes_entretien || false)) return true;
    return false;
  }, [notes, savDesc, partsOrder, devisAmount, devisStatus, includesEntretien, item]);

  // --- Objet "lead-like" pour le SchedulingAssistant ---
  // (déclaré AVANT early return)
  const schedulingLead = useMemo(() => ({
    last_name: item?.client_last_name || item?.client_name || '',
    first_name: item?.client_first_name || '',
    phone: item?.client_phone || '',
    email: item?.client_email || '',
    address: item?.client_address || '',
    city: item?.client_city || '',
    postal_code: item?.client_postal_code || '',
    assigned_user_id: null,
  }), [item]);

  if (!item) return null;

  const type = item.intervention_type;
  const typeConfig = TYPE_LABELS[type] || TYPE_LABELS.entretien;
  const statusConfig = getStatusConfig(type, item.workflow_status);
  const canEditSAV = can('sav', 'edit') || can('entretiens', 'edit');
  const canCreateSAV = can('sav', 'create');

  const name = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';

  // --- Handlers ---
  const handleTransition = async (newStatus) => {
    // Intercepter "planifie" → ouvrir le panneau de planification
    if (newStatus === 'planifie') {
      setShowScheduling(true);
      return;
    }

    try {
      await updateWorkflowStatus(item.id, newStatus);
      toast.success('Statut mis à jour');
      onUpdated?.();
      onClose();
    } catch {
      toast.error('Erreur de transition');
    }
  };

  // Confirmation de la planification → crée le(s) RDV + transition planifié
  // L'assistant (Bloc B) remonte `slots[]` (multi-créneau possible).
  const handleConfirmScheduling = async (slots) => {
    if (!slots || slots.length === 0) return;
    setSchedulingLoading(true);
    try {
      // 1 appointment par créneau via createAppointmentBatch (même cycle de vie Bloc A :
      // chaque createAppointment passe par syncCardStateOnCreate via intervention_id).
      const { error: appointmentError } = await appointmentsService.createAppointmentBatch(slots, {
        coreOrgId: orgId,
        appointment_type: type === 'sav' ? 'service' : 'maintenance',
        intervention_id: item.id,
        client_id: item.client_id || null,
        client_name: item.client_last_name || item.client_name || 'Sans nom',
        client_first_name: item.client_first_name || null,
        client_phone: item.client_phone || '',
        client_email: item.client_email || null,
        address: item.client_address || null,
        city: item.client_city || null,
        postal_code: item.client_postal_code || null,
        subjectPrefix: type === 'sav' ? (includesEntretien ? 'SAV + Entretien' : 'SAV') : 'Entretien',
      });

      if (appointmentError) {
        toast.error('Erreur création du RDV');
        return;
      }

      // Mettre à jour l'intervention : workflow_status + scheduled_date (1er créneau)
      await updateWorkflowStatus(item.id, 'planifie');
      await updateFields(item.id, { scheduled_date: slots[0].date });

      // Confirmer le client draft si c'est un contact web
      if (item.client_id && item.tags?.includes('Web')) {
        await clientsService.confirmWebDraft(item.client_id);
      }

      toast.success('RDV planifié avec succès');
      onUpdated?.();
      onClose();
    } catch {
      toast.error('Erreur lors de la planification');
    } finally {
      setSchedulingLoading(false);
    }
  };

  // Bouton Enregistrer — sauvegarde groupée de tous les champs
  const handleSave = async () => {
    try {
      const fields = {};

      // Collecter les champs modifiés
      if (notes !== (item.report_notes || '')) {
        fields.report_notes = notes;
      }
      if (type === 'sav') {
        if (savDesc !== (item.sav_description || '')) {
          fields.sav_description = savDesc;
        }
        if (partsOrder !== (item.parts_order_status || null)) {
          fields.parts_order_status = partsOrder;
        }
        if (devisAmount !== (item.devis_amount || null)) {
          fields.devis_amount = devisAmount;
        }
        if (devisStatus !== (item.devis_status || null)) {
          fields.devis_status = devisStatus;
        }
        if (includesEntretien !== (item.includes_entretien || false)) {
          fields.includes_entretien = includesEntretien;
        }
      }

      // Sauvegarder les champs
      const result = await updateFields(item.id, fields);
      if (result?.error) {
        toast.error('Erreur lors de la sauvegarde');
        return;
      }

      // Auto-transitions basées sur le devis/pièces
      let workflowChanged = false;

      // Pièces "Reçu" → a_planifier
      if (fields.parts_order_status === 'recu' && item.parts_order_status !== 'recu') {
        await updateWorkflowStatus(item.id, 'a_planifier');
        toast.success('Enregistré — pièces reçues, carte en À planifier');
        workflowChanged = true;
      }

      // Devis "Envoyé" → devis_envoye
      if (fields.devis_status === 'envoye' && item.devis_status !== 'envoye') {
        await updateWorkflowStatus(item.id, 'devis_envoye');
        toast.success('Enregistré — devis envoyé');
        workflowChanged = true;
      }

      // Devis "Accepté" → pieces_commandees
      if (fields.devis_status === 'accepte' && item.devis_status !== 'accepte') {
        await updateWorkflowStatus(item.id, 'pieces_commandees');
        toast.success('Enregistré — devis accepté, carte en Pièces commandées');
        workflowChanged = true;
      }

      if (!workflowChanged) {
        toast.success('Enregistré');
      }

      onUpdated?.();
      onClose();
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  const handleCreateSAVFromEntretien = () => {
    onCreateSAV?.({
      clientId: item.client_id,
      client: {
        id: item.client_id,
        display_name: item.client_name,
        postal_code: item.client_postal_code,
        city: item.client_city,
        project_id: item.project_id,
        has_active_contract: !!item.contract_id,
      },
      contractId: item.contract_id,
    });
  };

  // Toggle "Réaliser Entretien" — tag la carte + ajoute/retire montant contrat au devis
  const handleToggleEntretien = () => {
    const contractAmount = Number(item.contract_amount) || 0;
    setIncludesEntretien((prev) => {
      const willInclude = !prev;
      if (contractAmount > 0) {
        setDevisAmount((currentAmount) => {
          const current = Number(currentAmount) || 0;
          return willInclude ? current + contractAmount : Math.max(0, current - contractAmount);
        });
      }
      return willInclude;
    });
  };

  // Ouvrir fiche client — confirme le draft si besoin puis navigue
  const handleOpenClient = async () => {
    if (item.client_id) {
      // Confirmer le client draft (le rend visible dans la liste clients)
      if (item.tags?.includes('Web')) {
        await clientsService.confirmWebDraft(item.client_id);
      }
      onClose();
      navigate(`/clients/${item.client_id}`);
    }
  };

  // "Ranger" la carte (À planifier) depuis la fiche : suppression + undo toast.
  // Miroir du bouton Archive de EntretienSAVCard — le contrat redevient
  // planifiable dans l'outil secteur (il sort de plannedContractIds).
  const handleRanger = async () => {
    const snapshot = {
      orgId,
      clientId: item.client_id,
      contractId: item.contract_id || null,
      projectId: item.project_id || item.client_project_id,
      scheduledDate: item.scheduled_date || null,
    };
    const { error } = await savService.deleteEntretienCard(item.id);
    if (error) {
      toast.error('Impossible de ranger la carte');
      return;
    }
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
    onUpdated?.();
    onClose?.();
    toast('Carte rangée', {
      description: name,
      action: {
        label: 'Annuler',
        onClick: async () => {
          const { error: rErr } = await savService.createEntretien(snapshot);
          if (rErr) toast.error('Annulation impossible');
          queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
          onUpdated?.();
        },
      },
    });
  };

  // --- Transitions ---
  const allTransitions = getTransitions(type, item.workflow_status);

  const currentColumn = KANBAN_COLUMNS.find(c => c.value === item.workflow_status);
  const currentOrder = currentColumn
    ? KANBAN_COLUMNS.indexOf(currentColumn)
    : 0;

  const backTransitions = allTransitions.filter((t) => {
    const col = KANBAN_COLUMNS.find(c => c.value === t);
    if (!col) return false; // Pas de retour vers des statuts hors-Kanban
    return KANBAN_COLUMNS.indexOf(col) < currentOrder;
  });

  const forwardTransitions = allTransitions.filter((t) => {
    // Bloquer transition → réalisé pour entretiens (certificat obligatoire)
    if (type === 'entretien' && t === 'realise') return false;
    const col = KANBAN_COLUMNS.find(c => c.value === t);
    // Statut hors-Kanban (ex: facturé) = toujours forward
    if (!col) return true;
    return KANBAN_COLUMNS.indexOf(col) > currentOrder;
  });

  // Afficher le bouton certificat si entretien (ou SAV+entretien) planifié ou réalisé
  const hasEntretien = type === 'entretien' || (type === 'sav' && item.includes_entretien);
  const showCertificatButton = hasEntretien && (item.workflow_status === 'planifie' || item.workflow_status === 'realise');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Contenu */}
      <div className={`relative bg-white rounded-xl shadow-2xl w-full max-h-[calc(100vh-4rem)] flex flex-col ${showScheduling ? 'max-w-2xl' : 'max-w-lg'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: statusConfig.color }}
            />
            <div className="min-w-0 flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 truncate">{name}</h2>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${typeConfig.bgClass}`}>
                {typeConfig.label}
              </span>
              {type === 'sav' && includesEntretien && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                  Entretien à faire
                </span>
              )}
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
          {/* ============================================================ */}
          {/* VUE PLANIFICATION (SchedulingAssistant — Bloc B) */}
          {/* ============================================================ */}
          {showScheduling ? (
            <SchedulingAssistant
              lead={schedulingLead}
              orgId={orgId}
              commercials={[]}
              onConfirm={handleConfirmScheduling}
              onCancel={() => setShowScheduling(false)}
              isLoading={schedulingLoading}
              appointmentTypeLabel={type === 'sav' ? (includesEntretien ? 'SAV + Entretien' : 'SAV') : 'Entretien'}
              appointmentTypeValue={type === 'sav' ? 'service' : 'maintenance'}
              assigneeType="technician"
              members={teamMembers || []}
              defaultDuration={
                item.estimated_time
                  ? Math.round(Number(item.estimated_time) * 60)
                  : 60
              }
              defaultSubjectPrefix={
                type === 'sav'
                  ? (includesEntretien ? 'SAV + Entretien' : 'SAV')
                  : 'Entretien'
              }
              multi
            />
          ) : (
            <>
              {/* Infos client */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <User className="w-4 h-4 text-gray-400" />
                  <span>{name}</span>
                  {/* Lien vers la fiche client */}
                  {item.client_id && (
                    <button
                      type="button"
                      onClick={handleOpenClient}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                      title="Ouvrir la fiche client"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Fiche client
                    </button>
                  )}
                </div>
                {(item.client_postal_code || item.client_city) && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    <span>{[item.client_address, item.client_postal_code, item.client_city].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {item.client_phone && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <span>{item.client_phone}</span>
                  </div>
                )}
                {item.client_email && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <span>{item.client_email}</span>
                  </div>
                )}
                {item.contract_number && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span>Contrat {item.contract_number}</span>
                    {item.contract_amount > 0 && (
                      <span className="ml-auto text-sm font-semibold text-emerald-700">
                        {formatEuro(item.contract_amount)}
                      </span>
                    )}
                  </div>
                )}

                {/* Pièces de rechange : détail + toggle « Offert » (team_leader+) */}
                <EntretienPartsSection item={item} orgId={item.org_id} />

                {/* Équipements du contrat */}
                {contractEquipments.length > 0 && (
                  <div className="flex items-start gap-2 text-sm text-gray-500">
                    <Wrench className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div className="flex flex-wrap gap-1.5">
                      {contractEquipments.map((eq, i) => (
                        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">
                          {eq.equipment_type_label || 'Équipement'}
                          {eq.quantity > 1 && ` ×${eq.quantity}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Date du dernier entretien */}
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span>
                    Dernier entretien :{' '}
                    {lastEntretienDate ? (
                      <span className="font-medium text-gray-700">
                        {formatDateShortFR(lastEntretienDate)}
                      </span>
                    ) : (
                      <span className="italic text-gray-400">Aucun</span>
                    )}
                  </span>
                </div>

                {/* CTA Compléter fiche client (contacts Web) */}
                {item.tags?.includes('Web') && item.client_id && (
                  <button
                    type="button"
                    onClick={handleOpenClient}
                    className="mt-1 w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    Compléter la fiche client
                  </button>
                )}

                {/* Toggle Réaliser Entretien (SAV uniquement) */}
                {type === 'sav' && canEditSAV && (
                  <button
                    type="button"
                    onClick={handleToggleEntretien}
                    className={`mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                      includesEntretien
                        ? 'text-blue-700 bg-blue-100 border-blue-300'
                        : 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'
                    }`}
                    title={includesEntretien ? 'Entretien inclus — cliquer pour retirer' : 'Programmer un entretien en même temps'}
                  >
                    {includesEntretien ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <ClipboardCheck className="w-3.5 h-3.5" />
                    )}
                    {includesEntretien ? 'Entretien à faire' : 'Réaliser Entretien'}
                  </button>
                )}
              </div>

              {/* Description SAV */}
              {type === 'sav' && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
                    <Wrench className="w-4 h-4" />
                    Description du problème
                  </h3>
                  <FormField>
                    <TextArea
                      value={savDesc}
                      onChange={canEditSAV ? setSavDesc : undefined}
                      placeholder="Description du problème..."
                      rows={3}
                      disabled={!canEditSAV}
                    />
                  </FormField>
                </div>
              )}

              {/* Section Pièces (SAV uniquement) */}
              {type === 'sav' && (
                <SAVPartsSection
                  partsOrderStatus={partsOrder}
                  onChange={setPartsOrder}
                  disabled={!canEditSAV}
                />
              )}

              {/* Section Devis (SAV uniquement) */}
              {type === 'sav' && (
                <SAVDevisSection
                  devisAmount={devisAmount}
                  devisStatus={devisStatus}
                  onAmountChange={setDevisAmount}
                  onStatusChange={setDevisStatus}
                  disabled={!canEditSAV}
                />
              )}

              {/* Notes */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Notes internes
                </h3>
                <p className="text-xs text-gray-400">Visibles dans la fiche client (Notes internes)</p>
                <FormField>
                  <TextArea
                    value={notes}
                    onChange={canEditSAV ? setNotes : undefined}
                    placeholder="Notes internes..."
                    rows={3}
                    disabled={!canEditSAV}
                  />
                </FormField>
              </div>

              {/* Section certificats multi-équipements (entretien uniquement) */}
              {showCertificatsSection && (
                <CertificatsSection item={item} onCloseModal={onClose} />
              )}
            </>
          )}
        </div>

        {/* Footer : Enregistrer + transitions (masqué en mode planification) */}
        {!showScheduling && (
          <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl space-y-2">
            {/* Bouton Enregistrer */}
            {canEditSAV && (
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || isSavingFields}
                  className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
                    isDirty
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {isSavingFields ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {isSavingFields ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            )}

            {/* CTA Envoyer par mail (entretien réalisé avec email client) */}
            {isEntretien && item.workflow_status === 'realise' && item.client_email && (
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => toast.info('Envoi par mail — fonctionnalité à connecter avec N8N')}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  Envoyer par mail
                </button>
              </div>
            )}

            {/* Boutons transition */}
            {canEditSAV && (backTransitions.length > 0 || forwardTransitions.length > 0) && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {/* Retour arrière à gauche */}
                {backTransitions.map((targetStatus) => {
                  const col = KANBAN_COLUMNS.find(c => c.value === targetStatus)
                    || getStatusConfig(type, targetStatus);
                  if (!col) return null;
                  return (
                    <button
                      key={targetStatus}
                      type="button"
                      onClick={() => handleTransition(targetStatus)}
                      disabled={isUpdatingStatus}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-500 bg-white transition-colors hover:shadow-sm hover:bg-gray-100 disabled:opacity-50"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      {col.label}
                    </button>
                  );
                })}

                {/* Ranger (À planifier uniquement) : retire la carte du kanban, undo via toast */}
                {item.workflow_status === 'a_planifier' && (
                  <button
                    type="button"
                    onClick={handleRanger}
                    disabled={isUpdatingStatus}
                    title="Ranger la carte (la retirer de « À planifier »)"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-500 bg-white transition-colors hover:shadow-sm hover:bg-gray-100 disabled:opacity-50"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Ranger
                  </button>
                )}

                <div className="flex-1" />

                {/* Avancer à droite */}
                {forwardTransitions.map((targetStatus) => {
                  const col = KANBAN_COLUMNS.find(c => c.value === targetStatus)
                    || getStatusConfig(type, targetStatus);
                  if (!col) return null;
                  return (
                    <button
                      key={targetStatus}
                      type="button"
                      onClick={() => handleTransition(targetStatus)}
                      disabled={isUpdatingStatus}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors hover:shadow-sm disabled:opacity-50"
                      style={{
                        borderColor: col.color,
                        color: col.color,
                        backgroundColor: `${col.color}08`,
                      }}
                    >
                      {targetStatus === 'planifie' ? 'Planifier' : col.label}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default EntretienSAVModal;
