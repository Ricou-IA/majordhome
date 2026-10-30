/**
 * EventModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale de création / édition de rendez-vous (appointments).
 * Utilisée par Planning.jsx pour le CRUD des événements calendrier.
 *
 * Orchestrateur : état + composition. Extraits :
 *   - EventFormSections.jsx (SectionType, SectionDateTime, SectionClient, SectionAssignee, SectionNotes, SectionSouplesse)
 *   - EventConfirmations.jsx (CancelConfirmation, DeleteConfirmation)
 *   - AppointmentHistorySection.jsx (mouchard : historique des écritures du RDV)
 *   - @/lib/eventForm.js (formulaire ↔ RDV, validation, objet auto — pur)
 *   - eventActivation.js (carte du RDV : walk-in, filet doublon, carte du client)
 *   - useEventClientLinking.js (client / carte pipeline liés)
 *   - useEventSaveActions.js (classique, assistant, re-planification, suite)
 *   - useAppointmentEntretien.js (entretien lié, pour les certificats)
 *   - EventModalFrame.jsx (en-tête / pied)
 * ============================================================================
 */

import { estTypeAdaptable } from '@/lib/souplesse';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CertificatsSection } from '@/apps/artisan/components/entretiens/CertificatsSection';
import { getAppointmentTypeConfig, COMMERCIAL_TYPES, APPOINTMENT_TYPES, FREE_TYPES } from '@services/appointments.service';
import { useLeadCommercials } from '@hooks/useLeads';
import { useLinkedPennylaneQuotes } from '@hooks/usePennylane';
import { resolveCommercialMemberId, dureeImposee } from '@/lib/planningEvents';
import { useAuth } from '@/contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useDureeContratClient } from '@hooks/useTournees';
import { construireReglages } from '@/lib/tournee/reglages.js';
import { toast } from 'sonner';
import { MODAL_PANEL_PHONE } from '@/lib/modalClasses';
import { CancelConfirmation, DeleteConfirmation } from './EventConfirmations';
import { SchedulingAssistant } from './scheduling/SchedulingAssistant';
import { DuplicateLeadDialog } from '../shared/DuplicateLeadDialog';
import { AppointmentHistorySection } from './AppointmentHistorySection';
import {
  SectionType,
  SectionDateTime,
  SectionClient,
  SectionAssignee,
  SectionNotes,
  SectionSouplesse,
} from './EventFormSections';
import { Ban } from 'lucide-react';
import {
  VT_PHONE_REQUIRED_MESSAGE, appointmentToForm, newEventForm, linkedClientFromAppointment,
  linkedLeadFromAppointment, linkedClientFromPrefill, applyFieldChange, validateEventForm,
} from '@/lib/eventForm';
import { useEventClientLinking } from './useEventClientLinking';
import { useEventSaveActions } from './useEventSaveActions';
import { useAppointmentEntretien } from './useAppointmentEntretien';
import { EventModalHeader, EventModalFooter } from './EventModalFrame';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * Modale création / édition de rendez-vous
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {'create'|'edit'} props.mode
 * @param {Object|null} props.appointment - Données RDV (mode edit)
 * @param {string|null} props.defaultDate - Date par défaut (mode create, YYYY-MM-DD)
 * @param {string|null} props.defaultTime - Heure par défaut (mode create, HH:MM)
 * @param {Object|null} props.prefillClient - Client à pré-lier (mode create) — pré-remplit les champs et lie le RDV au client
 * @param {Array} props.members - Liste des techniciens
 * @param {string} [props.orgId] - core org_id (pour recherche client/lead)
 * @param {string} [props.userId] - user id (pour création lead auto)
 * @param {Function} props.onClose
 * @param {Function} props.onSave - (formData) => Promise<boolean>
 * @param {Function} props.onDelete - () => Promise
 * @param {Function} props.onCancel - (reason) => Promise
 * @param {boolean} props.isSaving
 * @param {Object|null} [props.attachContext] - Rattachement direct depuis un kanban : { leadId?, interventionId?, lockedType? }. Le type est figé et la carte pré-liée.
 */
export function EventModal({
  isOpen,
  mode = 'create',
  appointment = null,
  defaultDate = null,
  defaultTime = null,
  prefillClient = null,
  members = [],
  orgId,
  userId,
  onClose,
  onSave,
  onDelete,
  onCancel,
  isSaving = false,
  attachContext = null,
}) {
  // État du formulaire
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [confirmAction, setConfirmAction] = useState(null); // 'cancel' | 'delete' | null
  // Créneaux posés via l'assistant INTÉGRÉ (création VT/entretien/SAV/install)
  const [assistantSlots, setAssistantSlots] = useState([]);
  // Re-planification (édition) : ré-ouvre l'assistant créneaux pour déplacer le RDV
  // (date/heure/personne), changement de type inclus. Date/heure figées sinon.
  const [rescheduleMode, setRescheduleMode] = useState(false);
  // Programmer une suite (édition) : ré-ouvre l'assistant pour AJOUTER un ou
  // plusieurs RDV sur la même carte (chantier pas fini le jour prévu, 2ᵉ visite
  // d'entretien). Le RDV courant n'est pas touché.
  const [continuationMode, setContinuationMode] = useState(false);
  const navigate = useNavigate();

  const { isOrgAdmin } = useAuth();
  const { settings: orgSettings } = useOrgSettings();
  const souplesseDefaut = construireReglages(orgSettings).souplesse_defaut_minutes;

  // `members` prop = team_members actifs (techniciens + commerciaux + admin) de Planning.jsx,
  // assignés dynamiquement selon le type.
  const allTeamMembers = useMemo(() => members || [], [members]);

  const isEdit = mode === 'edit';
  const isCancelled = appointment?.status === 'cancelled';

  // Client et carte pipeline liés (recherche unifiée, sélection, fiche complétée)
  const {
    selectedClient, setSelectedClient, selectedClientView, selectedLead, setSelectedLead,
    showClientDropdown, setShowClientDropdown,
    clientSearchQuery, clientSearchResults, clientSearching, searchClient, clearClientSearch,
    leadSearchResults, leadSearching, searchLead, clearLeadSearch, recentPipelineCards,
    handleSelectClient, handleUnlinkClient, handleSelectLead, handleUnlinkLead,
  } = useEventClientLinking({ orgId, isOpen, isEdit, appointment, appointmentType: formData.appointment_type, setFormData });

  // Installation = un chantier : lien vers le(s) devis Pennylane de la carte.
  // Filtré par chantier quand le RDV en porte un (un lead peut avoir plusieurs
  // chantiers) ; devis validés d'abord, sinon tout ce qui est rattaché.
  const installLeadId = isEdit && appointment?.appointment_type === 'installation'
    ? appointment?.lead_id || null
    : null;
  const { linkedQuotes: installQuotesAll } = useLinkedPennylaneQuotes(installLeadId, {
    chantierId: appointment?.chantier_id || null,
  });
  const installQuotes = useMemo(() => {
    const validated = installQuotesAll.filter((q) => q.is_validated);
    return validated.length > 0 ? validated : installQuotesAll;
  }, [installQuotesAll]);

  // --------------------------------------------------------------------------
  // Assistant créneaux (Bloc B) — pilotage par type (CRÉATION ; l'édition garde le picker classique)
  // - VT (commercial) → colonnes commerciaux SÉLECTIONNABLES (pas d'owner figé
  //   ici, contrairement au pipeline) → le commercial choisi alimente assigned_commercial_id.
  // - Entretien/SAV/Installation → colonnes techniciens.
  // - « Autre » → colonnes = tous les membres (soi en 1ʳᵉ colonne), client optionnel.
  // --------------------------------------------------------------------------
  const isCommercialType = COMMERCIAL_TYPES.includes(formData.appointment_type);
  // « Autre » / « Congés » : sans client ni carte — nom facultatif, personnes = toute l'équipe.
  const isFreeType = FREE_TYPES.includes(formData.appointment_type);
  // Congés : pas de bloc Client du tout, journée entière au clic, un objet par personne.
  const isLeave = formData.appointment_type === 'leave';
  // RDV Bouclage R2 : rattachement STRICT à une carte pipeline existante (leadOnly).
  // On ne saisit jamais un client libre ; on ne crée jamais de lead (zéro doublon).
  const isClosing = formData.appointment_type === 'rdv_closing';
  // Tous les types en CRÉATION utilisent l'assistant (grille jour × colonnes par personne),
  // y compris « Autre » (colonnes = tous les membres). En édition, l'assistant revient
  // via « Modifier le RDV » (rescheduleMode) ou « Programmer une suite » (continuationMode) ;
  // sinon la planification est en lecture seule.
  const usesAssistant = !isEdit || rescheduleMode || continuationMode;
  // Vue édition « au repos » (ni re-planification ni suite) : sections annexes + actions danger.
  const editIdle = isEdit && !rescheduleMode && !continuationMode;
  // Bloc contrat (R5) : un Entretien posé à la main prend la durée du contrat du client.
  const { dureeMinutes: dureeContratClient } = useDureeContratClient(
    orgId, selectedClient?.id || null, usesAssistant && formData.appointment_type === 'maintenance',
  );
  // Ouverture depuis une fiche client (prefillClient) → client implicite :
  // on masque entièrement le bloc Client (inutile de rappeler la fiche, on y est déjà).
  const fromFiche = !!prefillClient;
  const commercialMembers = useMemo(
    () => (allTeamMembers || []).filter((m) => ['commercial', 'admin'].includes(m.role)),
    [allTeamMembers],
  );
  // Édition classique d'un RDV commercial : la personne est `assigned_commercial_id`.
  // L'id stocké vient du pipeline (commercials.id) ou du planning (team_members.id) →
  // résolu en team_members.id à chaque rendu (jamais figé : `commercials` arrive en
  // async). Null si non commercial. Sert à l'affichage (SectionAssignee), à la garde
  // « une personne » (validate) et au save (report du legacy « commercial en technicien »).
  const { commercials } = useLeadCommercials(orgId);
  const commercialMemberId = useMemo(() => (
    isCommercialType
      ? resolveCommercialMemberId({
        assignedCommercialId: formData.assigned_commercial_id || null,
        technicianIds: formData.technicianIds || [],
        members: commercialMembers,
        commercials,
      })
      : null
  ), [isCommercialType, formData.assigned_commercial_id, formData.technicianIds, commercialMembers, commercials]);
  // team_member de l'utilisateur connecté → pré-affectation « Autre » à soi par défaut.
  const currentMemberId = useMemo(
    () => (allTeamMembers || []).find((m) => m.user_id === userId)?.id || null,
    [allTeamMembers, userId],
  );
  // Mode colonnes de l'assistant selon le type : VT→commerciaux, entretien/SAV/install→techniciens, « Autre »/« Congés »→tous.
  const assistantAssigneeType = isCommercialType
    ? 'commercial'
    : (isFreeType ? 'all' : 'technician');
  // « Autre » / « Congés » : place l'utilisateur connecté en 1ʳᵉ colonne (défaut naturel, réaffectable en cliquant une autre colonne).
  const assistantMembers = useMemo(() => {
    if (!isFreeType || !currentMemberId) return allTeamMembers;
    const mine = (allTeamMembers || []).filter((m) => m.id === currentMemberId);
    const others = (allTeamMembers || []).filter((m) => m.id !== currentMemberId);
    return [...mine, ...others];
  }, [allTeamMembers, isFreeType, currentMemberId]);
  // Objet « lead-like » consommé par l'assistant (pré-remplit nom/objet). Pas
  // d'owner figé depuis EventModal → assigned_user_id null (colonnes sélectionnables).
  const schedulingLead = useMemo(() => ({
    last_name: formData.client_name || '',
    first_name: formData.client_first_name || '',
    phone: formData.client_phone || '',
    email: formData.client_email || '',
    address: formData.client_address || '',
    city: formData.client_city || '',
    postal_code: formData.client_postal_code || '',
    assigned_user_id: null,
  }), [
    formData.client_name, formData.client_first_name, formData.client_phone,
    formData.client_email, formData.client_address, formData.client_city,
    formData.client_postal_code,
  ]);

  // Entretien/SAV lié (pour la section certificats)
  const entretien = useAppointmentEntretien({
    isOpen, isEdit, clientId: appointment?.client_id, appointmentType: appointment?.appointment_type,
  });
  const entretienStatus = entretien?.workflow_status || null;

  // Mettre à jour un champ (avec auto-calcul heures) et effacer son erreur
  const updateField = useCallback((field, value) => {
    setFormData((prev) => applyFieldChange(prev, field, value));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  }, [errors]);

  // Validation du chemin classique (édition, création « Autre »)
  const validate = useCallback(() => {
    const { errors: newErrors, phoneMissing } = validateEventForm(formData, {
      isFreeType, isCommercialType, commercialMemberId, isEdit, originalType: appointment?.appointment_type,
    });
    if (phoneMissing) toast.error(VT_PHONE_REQUIRED_MESSAGE);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, isCommercialType, isFreeType, commercialMemberId, isEdit, appointment]);

  const {
    batchSaving, setBatchSaving, duplicatePrompt, setDuplicatePrompt, resumeDuplicate,
    handleSave, handleCreateFromAssistant, handleRescheduleSave, handleContinuationSave,
  } = useEventSaveActions({
    orgId, userId, isEdit, appointment, attachContext, formData, setErrors, validate,
    selectedClient, selectedLead, isCommercialType, isFreeType, isLeave, isClosing, fromFiche,
    commercialMemberId, allTeamMembers, assistantSlots, onSave, onClose,
  });

  // --------------------------------------------------------------------------
  // Initialiser le formulaire
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;

    setErrors({});
    setConfirmAction(null);
    setAssistantSlots([]);
    setBatchSaving(false);
    setRescheduleMode(false);
    setContinuationMode(false);

    if (isEdit && appointment) {
      // Mode édition : pré-remplir avec les données existantes, restaurer client et carte liés
      setFormData(appointmentToForm(appointment));
      setSelectedClient(linkedClientFromAppointment(appointment));
      setSelectedLead(linkedLeadFromAppointment(appointment));
    } else {
      // Mode création : valeurs par défaut
      setFormData(newEventForm({ defaultDate, defaultTime, lockedType: attachContext?.lockedType, prefillClient }));
      setSelectedClient(linkedClientFromPrefill(prefillClient));
      setSelectedLead(null);
    }

    clearClientSearch();
    clearLeadSearch();
    setShowClientDropdown(false);
  }, [
    isOpen, mode, appointment, defaultDate, defaultTime, prefillClient, isEdit, clearClientSearch, clearLeadSearch, attachContext,
    setBatchSaving, setSelectedClient, setSelectedLead, setShowClientDropdown,
  ]);

  // Type config pour le badge coloré
  const typeConfig = useMemo(
    () => getAppointmentTypeConfig(formData.appointment_type),
    [formData.appointment_type]
  );

  // Types proposés selon le point d'entrée (Bloc A)
  // - kanban (attachContext.lockedType) -> type figé
  // - fiche / planning -> Visite Technique / Entretien / SAV / Autre (PAS Installation,
  //   PAS RDV Commercial legacy). On garde toujours le type courant pour l'affichage en édition.
  const typeLocked = Boolean(attachContext?.lockedType);
  // Déverrouillage inline du type en édition, réservé à l'org_admin (god-mode) :
  // corriger un RDV mal catégorisé sans repasser par la re-planification. Le picker
  // classique reste verrouillé pour les autres rôles (chemin « Modifier le RDV »).
  const canRetypeInline = isEdit && isOrgAdmin && !isCancelled && !typeLocked;
  const availableTypes = useMemo(() => {
    if (attachContext?.lockedType) {
      return APPOINTMENT_TYPES.filter(t => t.value === attachContext.lockedType);
    }
    const allowed = ['rdv_technical', 'rdv_closing', 'maintenance', 'service', 'leave', 'other'];
    return APPOINTMENT_TYPES.filter(
      t => allowed.includes(t.value) || t.value === formData.appointment_type
    );
  }, [attachContext, formData.appointment_type]);

  // Si fermée, on ne rend rien
  if (!isOpen) return null;

  // ==========================================================================
  // RENDU
  // ==========================================================================
  return (
    <>
      {/* Overlay transparent — laisse passer les clics sur le calendrier */}
      <div className="fixed inset-0 z-40 pointer-events-none" />

      {/* Panel modale — taille uniforme pour tous les types de RDV (largeur de la grille assistant).
          Sous `sm` (téléphone) le gabarit partagé MODAL_PANEL_PHONE le passe en plein écran. */}
      <div className={`fixed sm:inset-y-4 sm:left-auto sm:right-4 sm:w-full max-w-2xl bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden ${MODAL_PANEL_PHONE}`}>
        <EventModalHeader
          typeConfig={typeConfig}
          title={continuationMode ? 'Programmer une suite' : (isEdit ? 'Modifier le RDV' : 'Nouveau RDV')}
          subtitle={isEdit ? appointment?.client_name : null}
          onClose={onClose}
        />

        {/* ---- Contenu scrollable ---- */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Confirmation annulation */}
          {confirmAction === 'cancel' && (
            <CancelConfirmation
              onConfirm={onCancel}
              onBack={() => setConfirmAction(null)}
              isSaving={isSaving}
            />
          )}

          {/* Confirmation suppression */}
          {confirmAction === 'delete' && (
            <DeleteConfirmation
              appointmentSubject={formData.subject || formData.client_name}
              onConfirm={onDelete}
              onBack={() => setConfirmAction(null)}
              isSaving={isSaving}
            />
          )}

          {/* Formulaire principal */}
          {!confirmAction && (
            <div className="space-y-6">
              {/* Badge annulé */}
              {isCancelled && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <Ban className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-medium text-red-700">Ce rendez-vous a été annulé</span>
                  {appointment?.cancellation_reason && (
                    <span className="text-sm text-red-600 ml-1">
                      — {appointment.cancellation_reason}
                    </span>
                  )}
                </div>
              )}

              <SectionType
                formData={formData}
                updateField={updateField}
                errors={errors}
                isEdit={isEdit}
                isCancelled={isCancelled}
                selectedLead={selectedLead}
                availableTypes={availableTypes}
                typeLocked={typeLocked}
                hideSubject={usesAssistant}
                allowTypeChange={rescheduleMode || (canRetypeInline && !continuationMode)}
                retypeHint={canRetypeInline && !rescheduleMode && !continuationMode
                  ? 'Admin : corriger le type recrée la carte liée (entretien, visite…) et conserve la date.'
                  : null}
              />

              {/* Date/heure (édition) : lecture seule + bouton « Modifier le RDV » →
                  assistant créneaux. Le déplacement reste possible par drag & drop calendrier. */}
              {!usesAssistant && (
                <SectionDateTime
                  formData={formData}
                  updateField={updateField}
                  errors={errors}
                  isCancelled={isCancelled}
                  readOnly={isEdit}
                  onRequestReschedule={() => {
                    setAssistantSlots([]);
                    setRescheduleMode(true);
                  }}
                  // « Suite » sans carte liée (RDV « Autre » / « Congés » libre) = simple nouveau RDV : pas proposé.
                  onRequestContinuation={
                    (appointment?.lead_id || appointment?.intervention_id || !isFreeType)
                      ? () => {
                        setAssistantSlots([]);
                        setContinuationMode(true);
                      }
                      : null
                  }
                />
              )}

              {/* Client : masqué si on vient d'une fiche (implicite) et pour des Congés
                  (une absence n'a pas de client). Sinon recherche/lien (« Autre » inclus →
                  lié au client, sans carte kanban).
                  Bouclage R2 : toujours affiché (même depuis une fiche) en mode leadOnly —
                  la sélection d'une carte pipeline existante est obligatoire. */}
              {((!fromFiche || isClosing) && !isLeave) && (
                <SectionClient
                  formData={formData}
                  updateField={updateField}
                  errors={errors}
                  isCancelled={isCancelled}
                  showContactDetails={isEdit}
                  leadOnly={isClosing}
                  browseLeads={recentPipelineCards}
                  selectedClient={selectedClientView}
                  selectedLead={selectedLead}
                  quotes={installQuotes}
                  navigate={navigate}
                  handleUnlinkClient={handleUnlinkClient}
                  handleUnlinkLead={handleUnlinkLead}
                  clientSearchQuery={clientSearchQuery}
                  searchClient={searchClient}
                  searchLead={searchLead}
                  showClientDropdown={showClientDropdown}
                  setShowClientDropdown={setShowClientDropdown}
                  clientSearching={clientSearching}
                  leadSearching={leadSearching}
                  clientSearchResults={clientSearchResults}
                  leadSearchResults={leadSearchResults}
                  handleSelectClient={handleSelectClient}
                  handleSelectLead={handleSelectLead}
                />
              )}

              {/* Assistant créneaux INTÉGRÉ : création VT/entretien/SAV/install.
                  Colonnes filtrées par type (VT→commerciaux/direction, entretien/SAV→techs).
                  key=type → remise à zéro propre des créneaux quand on change de type. */}
              {usesAssistant && (
                <SchedulingAssistant
                  key={formData.appointment_type}
                  embedded
                  onSlotsChange={setAssistantSlots}
                  lead={schedulingLead}
                  orgId={orgId}
                  assigneeType={assistantAssigneeType}
                  fixedAssigneeId={null}
                  commercials={commercialMembers}
                  members={assistantMembers}
                  appointmentTypeLabel={typeConfig.label}
                  appointmentTypeValue={formData.appointment_type}
                  defaultDuration={dureeContratClient || dureeImposee(formData.appointment_type) || Number(formData.duration_minutes) || 60}
                  // Bloc entier au clic : entretien = durée du contrat, VT = 1 h (dureeImposee).
                  fixedDuration={formData.appointment_type === 'maintenance' ? dureeContratClient : dureeImposee(formData.appointment_type)}
                  initialDate={(rescheduleMode || continuationMode)
                    ? (formData.scheduled_date || null)
                    // Création depuis un créneau du calendrier : l'assistant s'ouvre sur ce jour.
                    : (!isEdit ? defaultDate : null)}
                  // Installation : N jours ; Congés : N jours d'absence en une saisie, un clic
                  // sur la personne = sa journée (une partie de journée reste possible au glisser).
                  multi={!rescheduleMode && (formData.appointment_type === 'installation' || isLeave)}
                  fullDayClick={isLeave}
                  // Congés : un RDV par personne, chacun sur SES horaires (jamais l'horaire
                  // du premier cliqué pour tous : la fin de journée des autres restait libre).
                  regrouperJournees={!isLeave}
                />
              )}

              {/* Assigné classique : édition + « Autre » (sinon l'assistant gère les colonnes) */}
              {!usesAssistant && (
                <SectionAssignee
                  formData={formData}
                  updateField={updateField}
                  allTeamMembers={allTeamMembers}
                  commercialMemberId={commercialMemberId}
                  errors={errors}
                  isCancelled={isCancelled}
                />
              )}

              {/* Souplesse : édition uniquement (à la création par l'assistant, la
                  souplesse est demandée à la pose ; « Autre » prend le défaut d'org). */}
              {isEdit && !continuationMode && estTypeAdaptable(formData.appointment_type) && (
                <SectionSouplesse
                  formData={formData}
                  updateField={updateField}
                  isCancelled={isCancelled}
                  souplesseDefaut={souplesseDefaut}
                />
              )}

              {/* Notes : édition + « Autre » uniquement. Dans le flux assistant, le RDV va
                  droit au but (type + créneau) ; objet auto, notes éditables après coup. */}
              {!usesAssistant && (
                <SectionNotes
                  formData={formData}
                  updateField={updateField}
                  isCancelled={isCancelled}
                />
              )}

              {/* Mouchard : qui a créé / déplacé / annulé ce RDV, et par où (édition seule). */}
              {editIdle && appointment?.id && (
                <AppointmentHistorySection appointmentId={appointment.id} />
              )}

              {/* Certificats d'entretien — un par equipement.
                  Meme section que la fiche entretien : le technicien saisit
                  depuis son RDV, chaque certificat reste rattache a son
                  equipement et le compteur avance. */}
              {editIdle && entretien && ['maintenance', 'service'].includes(formData.appointment_type) && !isCancelled && (
                <div className={`${entretienStatus === 'realise' ? 'bg-green-50 border-green-200' : 'bg-emerald-50 border-emerald-200'} border rounded-lg p-4`}>
                  <CertificatsSection item={entretien} onCloseModal={onClose} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- Footer ---- */}
        {!confirmAction && (
          <EventModalFooter
            showDangerActions={editIdle && !isCancelled}
            onRequestCancel={() => setConfirmAction('cancel')}
            onRequestDelete={() => setConfirmAction('delete')}
            inAssistantMode={rescheduleMode || continuationMode}
            onBack={() => {
              setAssistantSlots([]);
              setRescheduleMode(false);
              setContinuationMode(false);
            }}
            onClose={onClose}
            isCancelled={isCancelled}
            usesAssistant={usesAssistant}
            rescheduleMode={rescheduleMode}
            continuationMode={continuationMode}
            slotCount={assistantSlots.length}
            assistantDisabled={batchSaving || assistantSlots.length === 0 || (isClosing && !rescheduleMode && !continuationMode && !selectedLead)}
            batchSaving={batchSaving}
            onAssistantSubmit={continuationMode ? handleContinuationSave : (rescheduleMode ? handleRescheduleSave : handleCreateFromAssistant)}
            isEdit={isEdit}
            isSaving={isSaving}
            onSave={handleSave}
          />
        )}
      </div>

      {/* Filet anti-doublon walk-in : lier la carte existante ou créer quand même */}
      <DuplicateLeadDialog
        open={!!duplicatePrompt}
        candidates={duplicatePrompt?.candidates || []}
        primaryActionLabel="Lier le RDV à cette carte"
        onPrimaryAction={(c) => resumeDuplicate({ action: 'link', leadId: c.id })}
        onCreateAnyway={() => resumeDuplicate({ action: 'create' })}
        onCancel={() => setDuplicatePrompt(null)}
      />
    </>
  );
}

export default EventModal;
