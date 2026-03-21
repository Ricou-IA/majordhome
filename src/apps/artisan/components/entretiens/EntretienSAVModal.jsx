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
 * - Transition "Planifié" → ouvre le SchedulingPanel (mini-calendrier)
 *
 * @version 4.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Loader2, ArrowLeft, ArrowRight, Save,
  User, MapPin, Phone, ClipboardCheck, Wrench, Mail, FileText,
  ExternalLink, Calendar, Check, UserPlus,
} from 'lucide-react';
import { CertificatLink } from '@/apps/artisan/components/certificat/CertificatLink';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { formatEuro, formatDateShortFR } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import {
  getStatusConfig,
  getTransitions,
  KANBAN_COLUMNS,
} from '@services/sav.service';
import { appointmentsService } from '@services/appointments.service';
import { clientsService } from '@services/clients.service';
import { useEntretienSAVMutations } from '@hooks/useEntretienSAV';
import { useTeamMembers } from '@hooks/useAppointments';
import { FormField, TextArea } from '@apps/artisan/components/FormFields';
import { SchedulingPanel } from '@apps/artisan/components/pipeline/SchedulingPanel';
import { SAVPartsSection } from './SAVPartsSection';
import { SAVDevisSection } from './SAVDevisSection';

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

export function EntretienSAVModal({ item, onClose, onUpdated, onCreateSAV, onOpenClient }) {
  const navigate = useNavigate();
  const { organization } = useAuth();
  const { can } = useCanAccess();
  const orgId = organization?.id;

  const {
    updateWorkflowStatus,
    updateFields,
    isUpdatingStatus,
    isSavingFields,
  } = useEntretienSAVMutations();

  // Techniciens pour le SchedulingPanel (mode SAV-Entretien)
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

  // Charger la date du dernier entretien réalisé pour ce client
  useEffect(() => {
    if (!item?.client_id) return;

    supabase
      .from('majordhome_entretien_sav')
      .select('updated_at')
      .eq('client_id', item.client_id)
      .eq('intervention_type', 'entretien')
      .eq('workflow_status', 'realise')
      .order('updated_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setLastEntretienDate(data[0].updated_at);
        }
      });
  }, [item?.client_id]);

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

  if (!item) return null;

  const type = item.intervention_type;
  const typeConfig = TYPE_LABELS[type] || TYPE_LABELS.entretien;
  const statusConfig = getStatusConfig(type, item.workflow_status);
  const canEditSAV = can('sav', 'edit') || can('entretiens', 'edit');
  const canCreateSAV = can('sav', 'create');

  const name = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';

  // --- Dirty check : savoir si quelque chose a changé ---
  const isDirty = useMemo(() => {
    if (notes !== (item.report_notes || '')) return true;
    if (savDesc !== (item.sav_description || '')) return true;
    if (partsOrder !== (item.parts_order_status || null)) return true;
    if (devisAmount !== (item.devis_amount || null)) return true;
    if (devisStatus !== (item.devis_status || null)) return true;
    if (includesEntretien !== (item.includes_entretien || false)) return true;
    return false;
  }, [notes, savDesc, partsOrder, devisAmount, devisStatus, includesEntretien, item]);

  // --- Objet "lead-like" pour le SchedulingPanel ---
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

  // Confirmation de la planification → crée le RDV + transition planifié
  const handleConfirmScheduling = async (schedulingData) => {
    setSchedulingLoading(true);
    try {
      // Le SchedulingPanel envoie maintenant le bon type et les techniciens
      const { error: appointmentError } = await appointmentsService.createAppointment({
        coreOrgId: orgId,
        technicianIds: schedulingData.technicianIds || [],
        appointment_type: schedulingData.appointmentType,
        subject: schedulingData.subject,
        scheduled_date: schedulingData.date,
        scheduled_start: schedulingData.startTime,
        scheduled_end: schedulingData.endTime,
        duration_minutes: schedulingData.duration,
        client_name: item.client_last_name || item.client_name || 'Sans nom',
        client_first_name: item.client_first_name || null,
        client_phone: item.client_phone || '',
        client_email: item.client_email || null,
        address: item.client_address || null,
        city: item.client_city || null,
        postal_code: item.client_postal_code || null,
        client_id: item.client_id || null,
        status: 'scheduled',
        priority: 'normal',
        internal_notes: schedulingData.notes || null,
      });

      if (appointmentError) {
        toast.error('Erreur création du RDV');
        return;
      }

      // Mettre à jour l'intervention : workflow_status + scheduled_date
      await updateWorkflowStatus(item.id, 'planifie');

      // Enregistrer la date planifiée sur l'intervention
      await updateFields(item.id, { scheduled_date: schedulingData.date });

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

  // --- Transitions ---
  const allTransitions = getTransitions(type, item.workflow_status);

  const currentColumn = KANBAN_COLUMNS.find(c => c.value === item.workflow_status);
  const currentOrder = currentColumn
    ? KANBAN_COLUMNS.indexOf(currentColumn)
    : 0;

  const backTransitions = allTransitions.filter((t) => {
    const col = KANBAN_COLUMNS.find(c => c.value === t);
    return col ? KANBAN_COLUMNS.indexOf(col) < currentOrder : false;
  });

  const forwardTransitions = allTransitions.filter((t) => {
    // Bloquer transition → réalisé pour entretiens (certificat obligatoire)
    if (type === 'entretien' && t === 'realise') return false;
    const col = KANBAN_COLUMNS.find(c => c.value === t);
    return col ? KANBAN_COLUMNS.indexOf(col) > currentOrder : false;
  });

  // Afficher le bouton certificat si entretien (ou SAV+entretien) planifié ou réalisé
  const hasEntretien = type === 'entretien' || (type === 'sav' && item.includes_entretien);
  const showCertificatButton = hasEntretien && (item.workflow_status === 'planifie' || item.workflow_status === 'realise');

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
          {/* VUE PLANIFICATION (SchedulingPanel) */}
          {/* ============================================================ */}
          {showScheduling ? (
            <SchedulingPanel
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
                  Notes
                </h3>
                <FormField>
                  <TextArea
                    value={notes}
                    onChange={canEditSAV ? setNotes : undefined}
                    placeholder="Notes..."
                    rows={3}
                    disabled={!canEditSAV}
                  />
                </FormField>
              </div>

              {/* CTA Créer SAV (entretien uniquement, admin/team_leader) */}
              {type === 'entretien' && canCreateSAV && item.workflow_status === 'realise' && (
                <div className="pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleCreateSAVFromEntretien}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
                  >
                    <Wrench className="w-4 h-4" />
                    Créer un SAV
                  </button>
                  <p className="text-xs text-gray-400 mt-1">
                    Crée une demande SAV rattachée au même client
                  </p>
                </div>
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

            {/* Bouton certificat entretien (planifié → remplir, réalisé → voir) */}
            {showCertificatButton && (
              <div className="flex items-center justify-center">
                <CertificatLink
                  interventionId={item.id}
                  isRealise={item.workflow_status === 'realise'}
                  label={item.workflow_status === 'realise' ? 'Voir le certificat' : "Remplir le certificat d'entretien"}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors shadow-sm disabled:opacity-70 ${
                    item.workflow_status === 'realise'
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : 'bg-[#1B4F72] text-white hover:bg-[#154360]'
                  }`}
                />
              </div>
            )}

            {/* Boutons transition */}
            {canEditSAV && (backTransitions.length > 0 || forwardTransitions.length > 0) && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {/* Retour arrière à gauche */}
                {backTransitions.map((targetStatus) => {
                  const col = KANBAN_COLUMNS.find(c => c.value === targetStatus);
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

                <div className="flex-1" />

                {/* Avancer à droite */}
                {forwardTransitions.map((targetStatus) => {
                  const col = KANBAN_COLUMNS.find(c => c.value === targetStatus);
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
                      {col.label}
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
