/**
 * LeadModal.jsx - Majord'home Artisan
 * ============================================================================
 * Slide-over droite pour créer ou éditer un lead.
 * Sections : Contact, Pipeline, Action suivante, Notes + Timeline
 *
 * Sous-modules extraits :
 *   ./LeadStatusConfig.js         — ALLOWED_TRANSITIONS, getAllowedNextStatuses, LOST_REASONS
 *   ./LeadFormSections.jsx        — SectionClientLinking, SectionContact, SectionPipeline, etc.
 *   @/lib/leadForm.js             — état du formulaire et payloads (pur)
 *   ./useLeadStatusTransitions.js — gestes de statut (Contacté, RDV, Devis, Perdu, Gagné, appels)
 *   ./useLeadRequalification.js   — requalification en Entretien
 *   ./useLeadClientLinking.js     — liaison à une fiche client (MDH / Pennylane)
 *   ./LeadHardDeleteDialog.jsx    — suppression définitive (org_admin)
 *   ./LeadModalFrame.jsx          — en-tête et pied du slide-over
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { MergeLeadDialog } from './MergeLeadDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import {
  useLead,
  useLeadActivities,
  useLeadAuditTrail,
  useLeadStatuses,
  useLeadSources,
  useLeadCommercials,
  useLeadMutations,
} from '@hooks/useLeads';
import { useAuditResolvers } from '@hooks/useAuditResolvers';
import { buildAuditEntry, mergeTimeline } from '@/lib/auditTrail';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { grouperTypesParCategorie } from '@/lib/equipmentReferential';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildDevisConfig, famillesActives } from '@/lib/devisConfig.js';
import { supabase } from '@/lib/supabaseClient';
import { leadsService } from '@services/leads.service';
import { logger } from '@lib/logger';
import { hasPhoneNumber } from '@/lib/phoneUtils';
import { dureeImposee } from '@/lib/planningEvents';
import { geocodeAndAssignLead } from '@services/geocoding.service';

// Sous-composants extraits
import { getAllowedNextStatuses } from './LeadStatusConfig';
import {
  SectionClientLinking,
  SectionContact,
  SectionPipeline,
  SectionSuivi,
  SectionActions,
  SectionNotes,
} from './LeadFormSections';
import { EMPTY_LEAD_FORM, newLeadForm, leadToForm, contactPayload, buildLeadPayload } from '@/lib/leadForm';
import { useLeadStatusTransitions, VT_PHONE_REQUIRED_MESSAGE } from './useLeadStatusTransitions';
import { useLeadRequalification } from './useLeadRequalification';
import { useLeadClientLinking } from './useLeadClientLinking';
import { LeadHardDeleteDialog } from './LeadHardDeleteDialog';
import { LeadModalHeader, LeadModalFooter } from './LeadModalFrame';
import SectionDevis from '../devis/SectionDevis';
import { SchedulingAssistant } from '@apps/artisan/components/planning/scheduling/SchedulingAssistant';
import { FicheTechniqueModal } from './FicheTechniqueModal';
import { CallModal } from './CallModal';
import { QuoteModal } from './QuoteModal';
import { QuoteCandidatesModal } from './QuoteCandidatesModal';
import { MarkWonQuoteModal } from './MarkWonQuoteModal';
import { LinkedQuotesPanel } from './LinkedQuotesPanel';
import { DuplicateLeadDialog } from '../shared/DuplicateLeadDialog';
import { DuplicateClientDialog } from '../shared/DuplicateClientPanel';
import { usePennylaneEnabled } from '@hooks/useOrgSettings';
import { useLinkedPennylaneQuotes } from '@hooks/usePennylane';
import CreateDevisModal from '../devis/CreateDevisModal';
import DevisModal from '../devis/DevisModal';
import { useDevisMutations } from '@hooks/useDevis';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * @param {Object} props
 * @param {string|null} props.leadId - ID du lead à éditer (null = création)
 * @param {boolean} props.isOpen - Afficher le slide-over
 * @param {Function} props.onClose - Fermer
 * @param {Function} props.onSaved - Callback après save/create
 */
export function LeadModal({ leadId, isOpen, onClose, onSaved, autoSchedule = false, autoQuote = false, onOpenLead = null }) {
  const isEditing = !!leadId;
  const { organization, user, effectiveRole } = useAuth();
  const { can } = useCanAccess();
  const orgId = organization?.id;
  const userId = user?.id;
  // Filet anti-doublon à la création : candidats actifs partageant téléphone/email/nom
  const [duplicateCandidates, setDuplicateCandidates] = useState(null);

  // Données
  const { lead, isLoading: loadingLead } = useLead(isEditing ? leadId : null);
  const { activities, isLoading: loadingActivities } = useLeadActivities(isEditing ? leadId : null);
  // Mouchard : écritures réelles sur le lead et ses RDV (trigger DB), fusionnées
  // avec les activités déclaratives dans l'Historique.
  const { rows: auditRows } = useLeadAuditTrail(isEditing ? leadId : null);
  const auditResolvers = useAuditResolvers();
  const timelineEntries = useMemo(
    () => mergeTimeline(activities, auditRows.map((row) => buildAuditEntry(row, { resolvers: auditResolvers }))),
    [activities, auditRows, auditResolvers],
  );
  const { statuses } = useLeadStatuses();
  const { sources } = useLeadSources();
  const { commercials } = useLeadCommercials(orgId);
  const { equipmentTypes, index: referentiel } = useEquipmentReferential();
  const { settings: orgSettings } = useOrgSettings();
  const pennylaneActive = usePennylaneEnabled();
  const {
    createLead, updateLead, updateLeadStatus, convertLead, addNote, deleteLead, hardDeleteLead,
    isCreating, isUpdating, isChangingStatus, isConverting, isAddingNote, isHardDeleting,
  } = useLeadMutations();
  // Envoi des devis MDH (flux hors Pennylane) : mutation qui rejette sur refus et
  // invalide le cache devis — un appel direct au service masquerait le refus.
  const { sendQuote } = useDevisMutations(isEditing ? leadId : null);
  const isAdmin = effectiveRole === 'org_admin';

  // État formulaire
  const [form, setForm] = useState(() => ({ ...EMPTY_LEAD_FORM }));

  // Commercial par défaut à la création :
  // - Commercial/team_leader → lui-même (match profile_id)
  // - Admin → le team_leader (responsable commercial)
  const defaultCommercialId = useMemo(() => {
    if (!commercials.length || !userId) return '';
    // Si le user est dans la liste des commerciaux → lui-même
    const self = commercials.find((c) => c.profile_id === userId);
    if (self) return self.id;
    // Admin : assigner au team_leader (responsable)
    if (effectiveRole === 'org_admin') {
      const leader = commercials.find((c) => c.app_role === 'team_leader');
      if (leader) return leader.id;
    }
    return '';
  }, [commercials, userId, effectiveRole]);

  const [showConvertConfirm, setShowConvertConfirm] = useState(false);
  const {
    linkedClient, setLinkedClient, showClientDropdown, setShowClientDropdown,
    editClientMode, setEditClientMode, showLinkSearch, setShowLinkSearch,
    clientSearchQuery, clientResults, clientSearching, searchClient, clearClientSearch,
    pennylaneResults, pennylaneSearching, isImportingPennylane,
    handleSelectClient, handleUnlinkClient, handleImportPennylane,
  } = useLeadClientLinking({ orgId, pennylaneActive, sources, setForm });
  // Devis PL attachés (lecture, pour le branchement Gagné). Fetch léger via vue
  // publique, staleTime 30s côté hook → pas de surcoût notable.
  const { linkedQuotes } = useLinkedPennylaneQuotes(pennylaneActive && isEditing ? leadId : null);
  const [showFicheTechnique, setShowFicheTechnique] = useState(false);
  const [showCreateDevis, setShowCreateDevis] = useState(false);
  const [openDevisId, setOpenDevisId] = useState(null);
  const [mailingCampaigns, setMailingCampaigns] = useState([]);
  const [showHardDelete, setShowHardDelete] = useState(false);
  // God mode — fusion d'un doublon dans cette carte (org_admin, RPC lead_merge)
  const [showMerge, setShowMerge] = useState(false);

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const syncClientFields = useCallback(async () => {
    if (!linkedClient?.id || !editClientMode) return false;
    const { error } = await supabase
      .from('majordhome_clients')
      .update(contactPayload(form))
      .eq('id', linkedClient.id);
    if (error) {
      logger.error('[LeadModal] Erreur sync client:', error);
      toast.error('Erreur lors de la mise à jour de la fiche client');
      return false;
    }
    return true;
  }, [linkedClient, editClientMode, form]);

  const buildPayload = useCallback(() => buildLeadPayload(form, linkedClient?.id), [form, linkedClient]);

  // Enregistre le formulaire en cours (lead + fiche client liée) avant tout geste qui en dépend.
  const persistForm = useCallback(async () => {
    await updateLead(leadId, buildPayload());
    await syncClientFields();
  }, [updateLead, leadId, buildPayload, syncClientFields]);

  const {
    pendingLostStatusId, setPendingLostStatusId, lostReasonInput, setLostReasonInput,
    pendingRdvStatusId, setPendingRdvStatusId, schedulingLoading, setSchedulingLoading,
    pendingContactStatusId, setPendingContactStatusId,
    callModalForLog, setCallModalForLog, callLoading,
    followupModalOpen, setFollowupModalOpen, followupLoading,
    pendingQuoteStatusId, setPendingQuoteStatusId, quoteLoading,
    showQuoteCandidates, setShowQuoteCandidates, showMarkWon, setShowMarkWon,
    handleStatusChange, handleConfirmLost, handleConfirmScheduling, handleConfirmContact,
    handleConfirmQuote, handleSendDevis, handleLogCall, handleLogFollowup, handleConvert,
  } = useLeadStatusTransitions({
    leadId, isEditing, orgId, userId, form, setForm, statuses, linkedClientId: linkedClient?.id,
    pennylaneActive, linkedQuotes, persistForm,
    updateLeadStatus, convertLead, sendQuote, onSaved, onClose,
  });

  const {
    requalify, isRequalifying,
    duplicateCandidates: clientDuplicateCandidates, setDuplicateCandidates: setClientDuplicateCandidates,
  } = useLeadRequalification({ orgId, userId, lead, form, deleteLead, onClose });

  // Charger les mailings envoyés au lead
  useEffect(() => {
    if (!isOpen || !isEditing || !leadId) {
      setMailingCampaigns([]);
      return;
    }
    supabase
      .from('majordhome_mailing_logs')
      .select('campaign_name, sent_at')
      .eq('lead_id', leadId)
      .order('sent_at', { ascending: false })
      .then(({ data }) => setMailingCampaigns(data || []));
  }, [isOpen, isEditing, leadId]);

  // Pré-remplir le formulaire en mode édition OU reset en mode création
  useEffect(() => {
    if (!isOpen) return;

    if (isEditing && lead) {
      setForm(leadToForm(lead));
      setEditClientMode(false);
      setShowLinkSearch(false);
      setPendingRdvStatusId(null);
      setSchedulingLoading(false);
      if (lead.client_id) {
        setLinkedClient({
          id: lead.client_id,
          display_name: lead.client_display_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
          client_number: lead.client_number || null,
        });
      } else {
        setLinkedClient(null);
      }
    } else if (!isEditing) {
      setLinkedClient(null);
      setEditClientMode(false);
      setShowLinkSearch(false);
      setPendingRdvStatusId(null);
      setSchedulingLoading(false);
      clearClientSearch();
      const defaultStatus = statuses.find((s) => s.display_order === 1);
      setForm(newLeadForm({ statusId: defaultStatus?.id || '', assignedUserId: defaultCommercialId }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditing, lead]);

  // Appliquer le commercial par défaut quand la liste se charge (mode création uniquement)
  useEffect(() => {
    if (isOpen && !isEditing && defaultCommercialId && !form.assigned_user_id) {
      setForm((prev) => ({ ...prev, assigned_user_id: defaultCommercialId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form.assigned_user_id volontairement omis : le défaut ne s'applique qu'à l'ouverture/chargement, pas quand l'utilisateur vide le champ
  }, [isOpen, isEditing, defaultCommercialId]);

  // Auto-schedule : ouvrir directement l'assistant de planification après chargement du lead
  useEffect(() => {
    if (!autoSchedule || !isOpen || !isEditing || !lead || !statuses.length) return;
    const rdvStatus = statuses.find((s) => s.label === 'RDV planifié');
    if (!rdvStatus) return;
    // Pas de visite technique sans numéro : la fiche reste ouverte pour le saisir.
    if (!hasPhoneNumber(lead.phone)) {
      toast.error(VT_PHONE_REQUIRED_MESSAGE);
      return;
    }
    setPendingRdvStatusId(rdvStatus.id);
  }, [autoSchedule, isOpen, isEditing, lead, statuses, setPendingRdvStatusId]);

  // Auto-quote : ouvrir directement la modale d'attache de devis Pennylane
  // (drag kanban → « Devis envoyé » sur une org PL). Le rattachement d'un devis
  // est obligatoire pour basculer en « Devis envoyé » (invariant garanti côté
  // DB par le trigger enforce_devis_envoye_requires_quote).
  useEffect(() => {
    if (!autoQuote || !isOpen || !isEditing || !lead || !pennylaneActive) return;
    setShowQuoteCandidates(true);
  }, [autoQuote, isOpen, isEditing, lead, pennylaneActive, setShowQuoteCandidates]);

  // ========== HANDLERS ==========

  const handleSave = async (maybeDecision) => {
    // Reprise après le dialogue doublon (l'event DOM d'un onClick n'a pas d'action)
    const skipDupCheck = maybeDecision?.action === 'create';
    if (!form.last_name.trim()) {
      toast.error('Le nom de famille est requis');
      return;
    }
    try {
      // Filet anti-doublon (création uniquement) : un lead actif partageant
      // téléphone / email / nom+prénom doit être un choix explicite, pas un accident.
      // Best-effort : une erreur de la recherche ne bloque pas la création.
      if (!isEditing && !skipDupCheck) {
        const dup = await leadsService.findPotentialDuplicates({
          orgId,
          phone: form.phone,
          email: form.email,
          firstName: form.first_name,
          lastName: form.last_name,
        });
        if (dup.data?.length) {
          setDuplicateCandidates(dup.data);
          return;
        }
      }
      const payload = buildPayload();
      let savedLeadId = leadId;
      if (isEditing) {
        // Détecter changement de commercial assigné
        const oldCommercialId = lead?.assigned_user_id || null;
        const newCommercialId = form.assigned_user_id || null;
        if (oldCommercialId !== newCommercialId && newCommercialId) {
          const oldName = commercials?.find((c) => c.id === oldCommercialId)?.name || 'Non assigné';
          const newName = commercials?.find((c) => c.id === newCommercialId)?.name || '?';
          leadsService._createActivity({
            leadId,
            orgId,
            userId,
            type: 'lead_assigned',
            description: `Commercial assigné : ${oldName} → ${newName}`,
          }).catch(() => {});
        }
        await updateLead(leadId, payload);
      } else {
        const created = await createLead({ orgId, userId, ...payload });
        savedLeadId = created?.id || null;
      }
      const synced = await syncClientFields();
      if (synced) {
        toast.success(isEditing ? 'Lead et fiche client mis à jour' : 'Lead créé — fiche client mise à jour');
      } else {
        toast.success(isEditing ? 'Lead mis à jour' : 'Lead créé');
      }

      // Fire-and-forget : géocoder + assigner zone/commercial
      if (savedLeadId && (form.postal_code || form.address)) {
        geocodeAndAssignLead(
          savedLeadId,
          form.address?.trim() || null,
          form.postal_code?.trim() || null,
          form.city?.trim() || null,
        ).catch(() => {});
      }

      onSaved?.();
      onClose();
    } catch (err) {
      logger.error('[LeadModal] Erreur sauvegarde:', err);
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  const handleAddNote = async (description) => {
    await addNote(leadId, orgId, userId, description);
    toast.success('Note ajoutée');
  };

  // ========== COMPUTED ==========

  // [{ category, label, types }] : libellés de catégorie du référentiel de l'org
  const groupedEquipmentTypes = useMemo(
    () => grouperTypesParCategorie(referentiel, equipmentTypes),
    [referentiel, equipmentTypes],
  );
  // « Projet » = familles de devis actives de l'org (liste commerciale, découplée du référentiel d'entretien)
  const projectFamilies = useMemo(() => famillesActives(buildDevisConfig(orgSettings)), [orgSettings]);

  const currentStatus = statuses.find((s) => s.id === form.status_id);
  const isWon = currentStatus?.is_won === true;
  const isFinal = currentStatus?.is_final === true;
  const isSaving = isCreating || isUpdating;

  // Quitter le mode planification RDV (ouvert par l'assistant auto : on referme tout)
  const cancelScheduling = () => {
    setPendingRdvStatusId(null);
    if (autoSchedule) onClose();
  };

  // Bloquer le passage manuel à "Perdu" et "Gagné" si le lead a au moins un devis PL attaché
  // (Pennylane canonical — quote_status pilote le placement Kanban via majordhome_kanban_cards).
  // L'user doit marquer le devis accepté/refusé dans Pennylane, le sync propagera.
  const hasLinkedPlQuotes = (linkedQuotes?.length || 0) > 0;
  const PL_DRIVEN_STATUSES = ['Perdu', 'Gagné'];
  const allowedNext = isEditing && currentStatus
    ? getAllowedNextStatuses(currentStatus.label, statuses)
        .filter((s) => !(hasLinkedPlQuotes && PL_DRIVEN_STATUSES.includes(s.label)))
    : [];

  // Contact disabled si :
  //  - client lié et pas en mode édition (flow MDH actuel), OU
  //  - bridge Pennylane actif avec >=1 devis attaché (les coordonnées du lead
  //    sont synchronisées depuis Pennylane — cf spec §9)
  const pennylaneSyncedContact = pennylaneActive && (linkedQuotes?.length || 0) > 0;
  const contactFieldsDisabled = pennylaneSyncedContact || (!!linkedClient && !editClientMode);

  if (!isOpen) return null;

  // ========== RENDER ==========

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Slide-over */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-xl flex flex-col animate-in slide-in-from-right duration-200">
        <LeadModalHeader
          isEditing={isEditing}
          currentStatus={currentStatus}
          pennylaneActive={pennylaneActive}
          onAttachQuotes={() => setShowQuoteCandidates(true)}
          scheduling={!!pendingRdvStatusId}
          contactName={`${form.first_name || ''} ${form.last_name || ''}`}
          onBack={cancelScheduling}
          onClose={onClose}
        />

        {/* Body (scroll) */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
          {loadingLead ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : pendingRdvStatusId ? (
            /* ── Mode planification RDV (VT) : overlay plein body ──
               Assistant en mode commercial — affiche la dispo du SEUL commercial
               assigné à la carte (figé), 1 créneau, sortie assigned_commercial_id. */
            <SchedulingAssistant
              assigneeType="commercial"
              fixedAssigneeId={lead?.assigned_user_id || form?.assigned_user_id || null}
              multi={false}
              commercials={commercials}
              appointmentTypeLabel="Visite technique"
              appointmentTypeValue="rdv_technical"
              // Une VT se pose en bloc de 1 h au clic (Eric, 2026-10-10), comme depuis le planning.
              defaultDuration={dureeImposee('rdv_technical')}
              fixedDuration={dureeImposee('rdv_technical')}
              lead={lead || form}
              orgId={orgId}
              onConfirm={handleConfirmScheduling}
              onCancel={cancelScheduling}
              isLoading={schedulingLoading}
            />
          ) : (
            <>
              {/* PR 4/5 bridge — devis Pennylane attachés (read-only) */}
              {pennylaneActive && linkedQuotes && linkedQuotes.length > 0 && (
                <LinkedQuotesPanel quotes={linkedQuotes} />
              )}

              <SectionClientLinking
                linkedClient={linkedClient}
                editClientMode={editClientMode}
                setEditClientMode={setEditClientMode}
                handleUnlinkClient={handleUnlinkClient}
                isEditing={isEditing}
                showLinkSearch={showLinkSearch}
                setShowLinkSearch={setShowLinkSearch}
                clientSearchQuery={clientSearchQuery}
                searchClient={searchClient}
                showClientDropdown={showClientDropdown}
                setShowClientDropdown={setShowClientDropdown}
                clientSearching={clientSearching}
                clientResults={clientResults}
                handleSelectClient={handleSelectClient}
                clearClientSearch={clearClientSearch}
                pennylaneResults={pennylaneActive ? pennylaneResults : []}
                pennylaneSearching={pennylaneActive ? pennylaneSearching : false}
                handleImportPennylane={handleImportPennylane}
                isImportingPennylane={isImportingPennylane}
              />

              <SectionContact
                form={form}
                setField={setField}
                contactFieldsDisabled={contactFieldsDisabled}
                pennylaneSynced={pennylaneSyncedContact}
              />

              <SectionPipeline
                form={form}
                setField={setField}
                isEditing={isEditing}
                currentStatus={currentStatus}
                statuses={statuses}
                sources={sources}
                commercials={commercials}
                groupedEquipmentTypes={groupedEquipmentTypes}
                projectFamilies={projectFamilies}
                isFinal={isFinal}
                isWon={isWon}
                pendingLostStatusId={pendingLostStatusId}
                lostReasonInput={lostReasonInput}
                setLostReasonInput={setLostReasonInput}
                handleConfirmLost={handleConfirmLost}
                setPendingLostStatusId={setPendingLostStatusId}
                isChangingStatus={isChangingStatus}
                pendingRdvStatusId={pendingRdvStatusId}
                setPendingRdvStatusId={setPendingRdvStatusId}
                lead={lead}
                orgId={orgId}
                handleConfirmScheduling={handleConfirmScheduling}
                schedulingLoading={schedulingLoading}
                canAssign={can('pipeline', 'assign')}
              />

              {/* Suivi pipeline (uniquement en édition, order >= 2) */}
              {isEditing && currentStatus && currentStatus.display_order >= 2 && (
                <SectionSuivi
                  form={form}
                  setField={setField}
                  currentStatus={currentStatus}
                  isWon={isWon}
                  lead={lead}
                  onLogCall={() => setCallModalForLog(true)}
                  onLogFollowup={() => setFollowupModalOpen(true)}
                  callActivities={activities?.filter(a => a.activity_type === 'phone_call') || []}
                  followupActivities={activities?.filter(a => a.activity_type === 'followup') || []}
                  mailingCampaigns={mailingCampaigns}
                />
              )}

              <SectionNotes
                form={form}
                setField={setField}
                isEditing={isEditing}
                timelineEntries={timelineEntries}
                loadingActivities={loadingActivities}
                handleAddNote={handleAddNote}
                isAddingNote={isAddingNote}
                leadId={leadId}
                onOpenFicheTechnique={() => setShowFicheTechnique(true)}
                devisSlot={
                  <SectionDevis
                    leadId={leadId}
                    isEditing={isEditing}
                    onCreateDevis={() => setShowCreateDevis(true)}
                    onOpenDevis={(id) => setOpenDevisId(id)}
                    onSendDevis={handleSendDevis}
                  />
                }
              />

              <SectionActions
                isEditing={isEditing}
                allowedNext={allowedNext}
                isChangingStatus={isChangingStatus}
                handleStatusChange={handleStatusChange}
                isFinal={isFinal}
                isWon={isWon}
                lead={lead}
                showConvertConfirm={showConvertConfirm}
                setShowConvertConfirm={setShowConvertConfirm}
                handleConvert={handleConvert}
                isConverting={isConverting}
                currentStatus={currentStatus}
                onRequalifyEntretien={() => requalify()}
                isRequalifying={isRequalifying}
              />
            </>
          )}
        </div>

        {/* Footer sticky — masqué en mode planification RDV */}
        {!pendingRdvStatusId && (
          <LeadModalFooter
            isEditing={isEditing}
            isAdmin={isAdmin}
            isSaving={isSaving}
            isHardDeleting={isHardDeleting}
            onCancel={onClose}
            onMerge={() => setShowMerge(true)}
            onHardDelete={() => setShowHardDelete(true)}
            onSave={handleSave}
          />
        )}
      </div>

      {/* Fiche technique terrain */}
      <FicheTechniqueModal
        lead={lead}
        isOpen={showFicheTechnique}
        onClose={() => setShowFicheTechnique(false)}
      />

      {/* Modale appel — transition vers Contacté */}
      <CallModal
        isOpen={!!pendingContactStatusId}
        onClose={() => setPendingContactStatusId(null)}
        onConfirm={handleConfirmContact}
        loading={callLoading}
      />

      {/* Modale appel — ajout appel supplémentaire */}
      <CallModal
        isOpen={callModalForLog}
        onClose={() => setCallModalForLog(false)}
        onConfirm={handleLogCall}
        loading={callLoading}
      />

      {/* Modale relance — suivi devis envoyé */}
      <CallModal
        isOpen={followupModalOpen}
        onClose={() => setFollowupModalOpen(false)}
        onConfirm={handleLogFollowup}
        loading={followupLoading}
        title="Enregistrer une relance"
        variant="followup"
      />

      {/* Modale devis — transition vers Devis envoyé (mode MDH classique) */}
      <QuoteModal
        isOpen={!!pendingQuoteStatusId}
        onClose={() => setPendingQuoteStatusId(null)}
        onConfirm={handleConfirmQuote}
        loading={quoteLoading}
        defaultAmount={form.order_amount_ht || form.estimated_revenue || ''}
      />

      {/* PR 4 bridge — multi-attach Pennylane si org activée */}
      {pennylaneActive && isEditing && leadId && (
        <QuoteCandidatesModal
          isOpen={showQuoteCandidates}
          onClose={() => setShowQuoteCandidates(false)}
          leadId={leadId}
          orgId={orgId}
          // Sauve les modifs en cours du form + sync client AVANT la RPC
          onBeforeAttach={persistForm}
          onAttached={() => {
            onSaved?.();
            onClose();
          }}
        />
      )}

      {/* PR 5 bridge — choix du devis canonique sur bascule Gagné */}
      {pennylaneActive && isEditing && leadId && (
        <MarkWonQuoteModal
          isOpen={showMarkWon}
          onClose={() => setShowMarkWon(false)}
          leadId={leadId}
          orgId={orgId}
          userId={userId}
          onBeforeMark={persistForm}
          onMarked={() => {
            onSaved?.();
            onClose();
          }}
        />
      )}

      {/* Création devis fournisseur */}
      {showCreateDevis && (
        <CreateDevisModal
          lead={lead}
          onClose={() => setShowCreateDevis(false)}
          onCreated={() => setShowCreateDevis(false)}
        />
      )}

      {/* Détail devis fournisseur */}
      {openDevisId && (
        <DevisModal
          quoteId={openDevisId}
          leadId={leadId}
          onClose={() => setOpenDevisId(null)}
          onStatusChange={() => {}}
        />
      )}

      {/* God mode — fusion additive d'un doublon dans cette carte (org_admin) */}
      {isEditing && isAdmin && (
        <MergeLeadDialog
          open={showMerge}
          onOpenChange={setShowMerge}
          lead={lead}
          orgId={organization?.id}
          onMerged={() => onSaved?.()}
        />
      )}

      <LeadHardDeleteDialog
        open={showHardDelete}
        onOpenChange={setShowHardDelete}
        leadId={leadId}
        hardDeleteLead={hardDeleteLead}
        isHardDeleting={isHardDeleting}
        onDeleted={() => {
          onSaved?.();
          onClose();
        }}
      />

      {/* Filet anti-doublon CLIENT à la requalification : rattacher la fiche existante ou en créer une */}
      <DuplicateClientDialog
        open={clientDuplicateCandidates.length > 0}
        candidates={clientDuplicateCandidates}
        chooseLabel="Utiliser cette fiche"
        onChoose={(existing) => {
          setClientDuplicateCandidates([]);
          requalify({ existingClientId: existing.id });
        }}
        onCreateAnyway={() => {
          setClientDuplicateCandidates([]);
          requalify({ skipDuplicateCheck: true });
        }}
        onCancel={() => setClientDuplicateCandidates([])}
      />

      {/* Filet anti-doublon à la création : ouvrir la carte existante ou créer quand même */}
      <DuplicateLeadDialog
        open={!!duplicateCandidates}
        candidates={duplicateCandidates || []}
        primaryActionLabel={onOpenLead ? 'Ouvrir cette carte' : null}
        onPrimaryAction={onOpenLead ? (c) => {
          setDuplicateCandidates(null);
          onOpenLead(c.id);
        } : null}
        onCreateAnyway={() => {
          setDuplicateCandidates(null);
          handleSave({ action: 'create' });
        }}
        onCancel={() => setDuplicateCandidates(null)}
      />
    </>
  );
}

export default LeadModal;
