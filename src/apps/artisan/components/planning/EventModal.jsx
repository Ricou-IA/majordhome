/**
 * EventModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale de création / édition de rendez-vous (appointments).
 * Utilisée par Planning.jsx pour le CRUD des événements calendrier.
 *
 * Orchestrateur : logique métier + state. Le JSX formulaire est dans :
 *   - EventFormSections.jsx (SectionType, SectionDateTime, SectionClient, SectionCommercial, SectionNotes)
 *   - EventConfirmations.jsx (CancelConfirmation, DeleteConfirmation)
 *
 * @version 3.0.0 - Refactoring extraction sous-composants
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Save, Loader2, Trash2, Ban, CalendarDays, ClipboardCheck } from 'lucide-react';
import { CertificatLink } from '@/apps/artisan/components/certificat/CertificatLink';
import { getAppointmentTypeConfig, COMMERCIAL_TYPES, APPOINTMENT_TYPES, appointmentsService } from '@services/appointments.service';
import { useClientSearch } from '@hooks/useClients';
import { useLeadSearch, leadKeys } from '@hooks/useLeads';
import { leadsService } from '@services/leads.service';
import { resolveCardForAppointment } from '@services/appointmentActivation.service';
import { appointmentKeys, interventionKeys, entretienSavKeys, kanbanCardKeys, chantierKeys } from '@hooks/cacheKeys';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { formatDateForInput, computeEndTime, computeDuration } from '@/lib/utils';
import { CancelConfirmation, DeleteConfirmation } from './EventConfirmations';
import { SchedulingAssistant } from './scheduling/SchedulingAssistant';
import {
  SectionType,
  SectionDateTime,
  SectionClient,
  SectionAssignee,
  SectionNotes,
} from './EventFormSections';

// ============================================================================
// CONSTANTES
// ============================================================================

// ID du statut "RDV planifié" (table majordhome.statuses)
const RDV_PLANIFIE_STATUS_ID = 'e23d04b8-da2e-4477-8e1c-b92868b682ae';
// ID source par défaut pour les walk-in
const DEFAULT_SOURCE_BOUCHE_A_OREILLE = '3d945733-475a-46ee-891b-50acf9e2151d';

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
  // Créneaux posés via l'assistant INTÉGRÉ (création VT/entretien/SAV/install) + état d'envoi du lot
  const [assistantSlots, setAssistantSlots] = useState([]);
  const [batchSaving, setBatchSaving] = useState(false);
  // Re-planification (édition) : ré-ouvre l'assistant créneaux pour déplacer le RDV
  // (date/heure/personne), changement de type inclus. Date/heure figées sinon.
  const [rescheduleMode, setRescheduleMode] = useState(false);

  // État recherche / liaison client & lead
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const navigate = useNavigate();

  // Hooks recherche client + lead (recherche unifiée)
  const {
    query: clientSearchQuery,
    results: clientSearchResults,
    searching: clientSearching,
    search: searchClient,
    clear: clearClientSearch,
  } = useClientSearch(orgId);
  const {
    results: leadSearchResults,
    searching: leadSearching,
    search: searchLead,
    clear: clearLeadSearch,
  } = useLeadSearch(orgId);

  const queryClient = useQueryClient();
  const { isOrgAdmin } = useAuth();

  // Tous les team_members actifs (techniciens + commerciaux + admin)
  // `members` prop = team_members from Planning.jsx, mais ne contient que les techniciens
  // On charge tous les team_members pour l'assignation dynamique par type
  const allTeamMembers = useMemo(() => {
    // members prop already contains all active team_members from useTeamMembers
    // which queries majordhome_team_members WHERE is_active = true
    return members || [];
  }, [members]);

  const isEdit = mode === 'edit';
  const isCancelled = appointment?.status === 'cancelled';

  // --------------------------------------------------------------------------
  // Assistant créneaux (Bloc B) — pilotage par type (CRÉATION ; l'édition garde le picker classique)
  // - VT (commercial) → colonnes commerciaux SÉLECTIONNABLES (pas d'owner figé
  //   ici, contrairement au pipeline) → le commercial choisi alimente assigned_commercial_id.
  // - Entretien/SAV/Installation → colonnes techniciens.
  // - « Autre » → colonnes = tous les membres (soi en 1ʳᵉ colonne), client optionnel.
  // --------------------------------------------------------------------------
  const isCommercialType = COMMERCIAL_TYPES.includes(formData.appointment_type);
  // RDV Bouclage R2 : rattachement STRICT à une carte pipeline existante (leadOnly).
  // On ne saisit jamais un client libre ; on ne crée jamais de lead (zéro doublon).
  const isClosing = formData.appointment_type === 'rdv_closing';
  // Tous les types en CRÉATION utilisent l'assistant (grille jour × colonnes par personne),
  // y compris « Autre » (colonnes = tous les membres). En édition, l'assistant revient
  // via « Modifier le RDV » (rescheduleMode) ; sinon la planification est en lecture seule.
  const usesAssistant = !isEdit || rescheduleMode;
  // Ouverture depuis une fiche client (prefillClient) → client implicite :
  // on masque entièrement le bloc Client (inutile de rappeler la fiche, on y est déjà).
  const fromFiche = !!prefillClient;
  const commercialMembers = useMemo(
    () => (allTeamMembers || []).filter((m) => ['commercial', 'admin'].includes(m.role)),
    [allTeamMembers],
  );
  // team_member de l'utilisateur connecté → pré-affectation « Autre » à soi par défaut.
  const currentMemberId = useMemo(
    () => (allTeamMembers || []).find((m) => m.user_id === userId)?.id || null,
    [allTeamMembers, userId],
  );
  // Mode colonnes de l'assistant selon le type : VT→commerciaux, entretien/SAV/install→techniciens, « Autre »→tous.
  const assistantAssigneeType = isCommercialType
    ? 'commercial'
    : (formData.appointment_type === 'other' ? 'all' : 'technician');
  // « Autre » : place l'utilisateur connecté en 1ʳᵉ colonne (défaut naturel, réaffectable en cliquant une autre colonne).
  const assistantMembers = useMemo(() => {
    if (formData.appointment_type !== 'other' || !currentMemberId) return allTeamMembers;
    const mine = (allTeamMembers || []).filter((m) => m.id === currentMemberId);
    const others = (allTeamMembers || []).filter((m) => m.id !== currentMemberId);
    return [...mine, ...others];
  }, [allTeamMembers, formData.appointment_type, currentMemberId]);
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

  // Recherche intervention entretien/SAV liée (pour CTA certificat)
  const [entretienId, setEntretienId] = useState(null);
  const [entretienStatus, setEntretienStatus] = useState(null);
  useEffect(() => {
    setEntretienId(null);
    setEntretienStatus(null);
    if (!isOpen || !isEdit || !appointment?.client_id) return;
    if (!['maintenance', 'service'].includes(appointment?.appointment_type)) return;

    async function lookupEntretien() {
      // Chercher d'abord un entretien pur, puis un SAV avec entretien inclus
      const { data } = await supabase
        .from('majordhome_entretien_sav')
        .select('id, workflow_status, intervention_type, includes_entretien')
        .eq('client_id', appointment.client_id)
        .in('workflow_status', ['planifie', 'a_planifier', 'realise'])
        .order('created_at', { ascending: false })
        .limit(10);

      // Priorité : entretien pur > SAV avec entretien inclus
      const match = data?.find(d => d.intervention_type === 'entretien')
        || data?.find(d => d.intervention_type === 'sav' && d.includes_entretien);
      if (match) {
        setEntretienId(match.id);
        setEntretienStatus(match.workflow_status);
      }
    }
    lookupEntretien();
  }, [isOpen, isEdit, appointment?.client_id, appointment?.appointment_type]);

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

    if (isEdit && appointment) {
      // Mode édition : pré-remplir avec les données existantes
      setFormData({
        subject: appointment.subject || '',
        appointment_type: appointment.appointment_type || 'rdv_technical',
        priority: appointment.priority || 'normal',
        status: appointment.status || 'scheduled',
        client_name: appointment.client_name || '',
        client_first_name: appointment.client_first_name || '',
        client_phone: appointment.client_phone || '',
        client_email: appointment.client_email || '',
        client_address: appointment.address || '',
        client_city: appointment.city || '',
        client_postal_code: appointment.postal_code || '',
        scheduled_date: formatDateForInput(appointment.scheduled_date) || '',
        scheduled_start: appointment.scheduled_start?.slice(0, 5) || '',
        scheduled_end: appointment.scheduled_end?.slice(0, 5) || '',
        duration_minutes: appointment.duration_minutes || 60,
        description: appointment.description || '',
        internal_notes: appointment.internal_notes || '',
        technicianIds: appointment.technician_ids || [],
        assigned_commercial_id: appointment.assigned_commercial_id || '',
      });

      // Restaurer le client lié
      if (appointment.client_id) {
        setSelectedClient({
          id: appointment.client_id,
          display_name: appointment.client_name || '',
          client_number: null,
          phone: appointment.client_phone || null,
          city: appointment.city || null,
        });
      } else {
        setSelectedClient(null);
      }

      // Restaurer le lead lié
      if (appointment.lead_id) {
        setSelectedLead({
          id: appointment.lead_id,
          display_name: appointment.client_name || '',
          first_name: null,
          last_name: null,
          status_label: null,
          source_name: null,
          client_id: appointment.client_id || null,
        });
      } else {
        setSelectedLead(null);
      }
    } else {
      // Mode création : valeurs par défaut
      const startTime = defaultTime || '09:00';
      const duration = 60;
      setFormData({
        subject: '',
        appointment_type: attachContext?.lockedType || 'other',
        priority: 'normal',
        status: 'scheduled',
        client_name: prefillClient?.last_name || '',
        client_first_name: prefillClient?.first_name || '',
        client_phone: prefillClient?.phone || '',
        client_email: prefillClient?.email || '',
        client_address: prefillClient?.address || '',
        client_city: prefillClient?.city || '',
        client_postal_code: prefillClient?.postal_code || '',
        scheduled_date: defaultDate || new Date().toISOString().split('T')[0],
        scheduled_start: startTime,
        scheduled_end: computeEndTime(startTime, duration),
        duration_minutes: duration,
        description: '',
        internal_notes: '',
        technicianIds: [],
        assigned_commercial_id: '',
      });
      if (prefillClient?.id) {
        setSelectedClient({
          id: prefillClient.id,
          display_name: prefillClient.display_name || [prefillClient.last_name, prefillClient.first_name].filter(Boolean).join(' '),
          client_number: prefillClient.client_number || null,
          phone: prefillClient.phone || null,
          city: prefillClient.city || null,
        });
      } else {
        setSelectedClient(null);
      }
      setSelectedLead(null);
    }

    clearClientSearch();
    clearLeadSearch();
    setShowClientDropdown(false);
  }, [isOpen, mode, appointment, defaultDate, defaultTime, prefillClient, isEdit, clearClientSearch, clearLeadSearch, attachContext]);

  // --------------------------------------------------------------------------
  // Mettre à jour un champ (avec auto-calcul heures)
  // --------------------------------------------------------------------------
  const updateField = useCallback((field, value) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };

      // Auto-calcul heure fin quand on change début ou durée
      if (field === 'scheduled_start' || field === 'duration_minutes') {
        const start = field === 'scheduled_start' ? value : prev.scheduled_start;
        const dur = field === 'duration_minutes' ? value : prev.duration_minutes;
        if (start && dur) {
          next.scheduled_end = computeEndTime(start, Number(dur));
        }
      }

      // Auto-calcul durée quand on change heure fin
      if (field === 'scheduled_end' && prev.scheduled_start) {
        next.duration_minutes = computeDuration(prev.scheduled_start, value);
      }

      return next;
    });

    // Effacer l'erreur du champ modifié
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  }, [errors]);

  // --------------------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------------------
  const validate = useCallback(() => {
    const newErrors = {};

    if (!formData.scheduled_date) newErrors.scheduled_date = 'Date requise';
    if (!formData.scheduled_start) newErrors.scheduled_start = 'Heure de début requise';
    if (formData.appointment_type !== 'other' && !formData.client_name?.trim()) newErrors.client_name = 'Nom requis';
    if (!formData.appointment_type) newErrors.appointment_type = 'Type requis';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // --------------------------------------------------------------------------
  // Sélection / déliaison client
  // --------------------------------------------------------------------------
  const handleSelectClient = useCallback(async (client) => {
    try {
      const { data, error } = await supabase
        .from('majordhome_clients')
        .select('id, display_name, first_name, last_name, email, phone, address, postal_code, city, client_number')
        .eq('id', client.id)
        .single();

      if (error || !data) {
        console.error('[EventModal] fetch client error:', error);
        return;
      }

      setSelectedClient({
        id: data.id,
        display_name: data.display_name,
        client_number: data.client_number,
        phone: data.phone,
        city: data.city,
      });
      setShowClientDropdown(false);
      clearClientSearch();

      setFormData(prev => ({
        ...prev,
        client_name: data.last_name || data.display_name || '',
        client_first_name: data.first_name || '',
        client_phone: data.phone || '',
        client_email: data.email || '',
        client_address: data.address || '',
        client_postal_code: data.postal_code || '',
        client_city: data.city || '',
      }));
    } catch (err) {
      console.error('[EventModal] fetch client error:', err);
    }
  }, [clearClientSearch]);

  const handleUnlinkClient = useCallback(() => {
    setSelectedClient(null);
    clearClientSearch();
    setFormData(prev => ({
      ...prev,
      client_name: '',
      client_first_name: '',
      client_phone: '',
      client_email: '',
      client_address: '',
      client_postal_code: '',
      client_city: '',
    }));
  }, [clearClientSearch]);

  // --------------------------------------------------------------------------
  // Sélection / déliaison lead
  // --------------------------------------------------------------------------
  const handleSelectLead = useCallback(async (lead) => {
    setSelectedLead({
      id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      display_name: lead.display_name,
      status_label: lead.status_label,
      source_name: lead.source_name,
      client_id: lead.client_id,
    });
    setShowClientDropdown(false);
    clearClientSearch();
    clearLeadSearch();

    setFormData(prev => ({
      ...prev,
      client_name: lead.last_name || '',
      client_first_name: lead.first_name || '',
      client_phone: lead.phone || '',
      client_email: lead.email || '',
      client_address: lead.address || '',
      client_postal_code: lead.postal_code || '',
      client_city: lead.city || '',
    }));

    // Si le lead est lié à un client, set aussi selectedClient
    if (lead.client_id) {
      try {
        const { data } = await supabase
          .from('majordhome_clients')
          .select('id, display_name, client_number, phone, city')
          .eq('id', lead.client_id)
          .single();
        if (data) {
          setSelectedClient({
            id: data.id,
            display_name: data.display_name,
            client_number: data.client_number,
            phone: data.phone,
            city: data.city,
          });
        }
      } catch (err) {
        console.error('[EventModal] fetch lead client error:', err);
      }
    }
  }, [clearClientSearch, clearLeadSearch]);

  const handleUnlinkLead = useCallback(() => {
    setSelectedLead(null);
  }, []);

  // --------------------------------------------------------------------------
  // Activation déduppée de la carte — SOURCE UNIQUE partagée par le chemin
  // classique (édition / « Autre » → handleSave) et le chemin assistant
  // (VT/entretien/SAV/install → handleCreateFromAssistant). Plus d'auto-lead
  // silencieux : le seul prospect créé est le walk-in inconnu (Planning, ni
  // client ni lead, type commercial). Renvoie { leadId, interventionId, error }.
  // --------------------------------------------------------------------------
  const resolveActivation = useCallback(async ({ rdvDate } = {}) => {
    const fallbackInterventionId = attachContext?.interventionId || null;

    // Walk-in inconnu (Planning, ni client ni lead, type commercial) -> vrai prospect.
    // Restreint au R1 (rdv_technical/rdv_agency) : un Bouclage R2 ne fabrique JAMAIS
    // de prospect (il exige une carte existante, cf. isClosing).
    const isWalkInProspect = !selectedClient && !selectedLead && !attachContext
      && COMMERCIAL_TYPES.includes(formData.appointment_type)
      && !isClosing;

    if (isWalkInProspect) {
      const result = await leadsService.createLead({
        orgId,
        userId,
        first_name: formData.client_first_name || null,
        last_name: formData.client_name || null,
        email: formData.client_email || null,
        phone: formData.client_phone || null,
        address: formData.client_address || null,
        postal_code: formData.client_postal_code || null,
        city: formData.client_city || null,
        source_id: DEFAULT_SOURCE_BOUCHE_A_OREILLE,
        status_id: RDV_PLANIFIE_STATUS_ID,
        notes: `Prospect créé depuis le Planning — RDV du ${rdvDate || ''}`.trim(),
      });
      if (result.error) {
        console.error('[EventModal] create prospect error:', result.error);
        return { leadId: null, interventionId: null, error: 'prospect' };
      }
      const leadId = result.data?.id || null;
      if (leadId) toast.success('Prospect créé dans le pipeline');
      return { leadId, interventionId: fallbackInterventionId, error: null };
    }

    // Rattache / matérialise la carte du client selon le type (entretien/SAV/VT).
    const resolved = await resolveCardForAppointment({
      orgId,
      userId,
      type: formData.appointment_type,
      clientId: selectedClient?.id || null,
      leadId: selectedLead?.id || attachContext?.leadId || null,
      interventionId: fallbackInterventionId,
    });
    if (resolved.error) {
      if (resolved.error !== 'client_sans_projet') {
        console.error('[EventModal] activation error:', resolved.error);
      }
      return {
        leadId: null,
        interventionId: null,
        error: resolved.error === 'client_sans_projet' ? 'client_sans_projet' : 'activation',
      };
    }
    return {
      leadId: resolved.lead_id || null,
      interventionId: resolved.intervention_id || null,
      error: null,
    };
  }, [
    selectedClient, selectedLead, attachContext, formData.appointment_type, isClosing,
    formData.client_first_name, formData.client_name, formData.client_email,
    formData.client_phone, formData.client_address, formData.client_postal_code,
    formData.client_city, orgId, userId,
  ]);

  // Mappe le code d'erreur d'activation -> toast. Renvoie true si erreur (= stop).
  const reportActivationError = useCallback((error) => {
    if (!error) return false;
    if (error === 'client_sans_projet') {
      toast.error("Ce client n'a pas de fiche projet — impossible de créer l'entretien.");
    } else if (error === 'bouclage_requiert_carte') {
      toast.error('Sélectionnez la carte du pipeline à boucler.');
    } else if (error === 'prospect') {
      toast.error('Erreur lors de la création du prospect');
    } else {
      toast.error("Erreur lors de l'activation de la carte");
    }
    return true;
  }, []);

  // --------------------------------------------------------------------------
  // Enregistrer (chemin CLASSIQUE) : édition (1 RDV) + création « Autre ».
  // Les types VT/entretien/SAV/install en création passent par l'assistant
  // intégré (handleCreateFromAssistant), bouton « Créer le RDV ».
  // --------------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!validate()) return;

    let leadId = selectedLead?.id || attachContext?.leadId || null;
    let interventionId = isEdit
      ? (appointment?.intervention_id || null)
      : (attachContext?.interventionId || null);

    // Correction de type inline par un org_admin sur un RDV existant (god-mode) :
    // un RDV mal catégorisé (ex. « Autre » au lieu d'« Entretien ») ne déclenche pas
    // le workflow lié. On re-résout la carte cible comme à la re-planification —
    // mais SANS re-choix de créneau (date/heure conservées).
    const typeChangedInEdit = isEdit && formData.appointment_type !== appointment?.appointment_type;

    let subject = formData.subject?.trim() || null;

    if (!isEdit) {
      const act = await resolveActivation({ rdvDate: formData.scheduled_date });
      if (reportActivationError(act.error)) return;
      leadId = act.leadId;
      interventionId = act.interventionId;
    } else if (typeChangedInEdit) {
      const act = await resolveActivation({ rdvDate: formData.scheduled_date });
      if (reportActivationError(act.error)) return;
      leadId = act.leadId;
      interventionId = act.interventionId;

      // Rafraîchir l'objet auto (type — client) si l'utilisateur n'a pas saisi
      // d'objet custom (un objet écrit à la main reste intact).
      const oldLabel = getAppointmentTypeConfig(appointment?.appointment_type).label;
      const newLabel = getAppointmentTypeConfig(formData.appointment_type).label;
      const clientLabel = [formData.client_name, formData.client_first_name].filter(Boolean).join(' ').trim();
      const looksAuto = !subject || subject === oldLabel
        || subject.startsWith(`${oldLabel} —`) || subject.startsWith(`${oldLabel}—`);
      if (looksAuto) subject = clientLabel ? `${newLabel} — ${clientLabel}` : newLabel;
    }

    // Construire les données à envoyer
    const data = {
      subject,
      appointment_type: formData.appointment_type,
      priority: formData.priority,
      status: formData.status,
      client_name: formData.client_name?.trim() || null,
      client_first_name: formData.client_first_name?.trim() || null,
      client_phone: formData.client_phone || null,
      client_email: formData.client_email || null,
      address: formData.client_address || null,
      city: formData.client_city || null,
      postal_code: formData.client_postal_code || null,
      client_id: selectedClient?.id || null,
      lead_id: leadId,
      intervention_id: interventionId,
      scheduled_date: formData.scheduled_date,
      scheduled_start: formData.scheduled_start,
      scheduled_end: formData.scheduled_end || null,
      duration_minutes: Number(formData.duration_minutes) || 60,
      description: formData.description || null,
      internal_notes: formData.internal_notes || null,
      technicianIds: formData.technicianIds,
      assigned_commercial_id: formData.assigned_commercial_id || null,
    };

    await onSave(data);

    if (leadId) {
      queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    }
    // Re-typage : la carte cible a changé (ancienne refluée, nouvelle avancée par le
    // service appointments) → rafraîchir kanbans / interventions / entretiens.
    if (typeChangedInEdit) {
      queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
      if (interventionId || appointment?.intervention_id) {
        queryClient.invalidateQueries({ queryKey: interventionKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      }
    }
  }, [validate, selectedLead, attachContext, isEdit, appointment, resolveActivation, reportActivationError, formData, onSave, selectedClient, orgId, queryClient]);

  // --------------------------------------------------------------------------
  // Créer depuis l'assistant INTÉGRÉ (chemin CRÉATION VT/entretien/SAV/install).
  // `assistantSlots` est alimenté en continu par l'assistant inline ; on résout
  // la carte UNE fois, puis on crée N RDV via createAppointmentBatch (réutilise
  // createAppointment → syncCardStateOnCreate + sync Google par RDV, cycle Bloc A préservé).
  // Objet/notes/description viennent de la modale (SectionType/SectionNotes), pas de l'assistant.
  // --------------------------------------------------------------------------
  const handleCreateFromAssistant = useCallback(async () => {
    if (assistantSlots.length === 0) {
      toast.error('Choisissez au moins un créneau');
      return;
    }
    // Bouclage R2 : une carte pipeline existante DOIT être sélectionnée (jamais de doublon).
    if (isClosing && !selectedLead) {
      toast.error('Sélectionnez la carte du pipeline à boucler.');
      return;
    }
    // Nom client requis pour les RDV liés à un client (VT/entretien/SAV/install) hors fiche.
    // « Autre » : client optionnel (RDV perso / interne). R2 : identité portée par la carte.
    if (formData.appointment_type !== 'other' && !isClosing && !fromFiche && !formData.client_name?.trim()) {
      setErrors((prev) => ({ ...prev, client_name: 'Nom requis' }));
      toast.error('Nom du client requis');
      return;
    }
    setBatchSaving(true);
    try {
      const act = await resolveActivation({ rdvDate: assistantSlots[0]?.date });
      if (reportActivationError(act.error)) { setBatchSaving(false); return; }

      // VT depuis EventModal = commercial sélectionnable → le commercial choisi
      // (colonne) est porté par slot.assignedCommercialId. Entretien/SAV/install : null.
      const assignedCommercialId = isCommercialType ? (assistantSlots[0]?.assignedCommercialId || null) : null;

      // Objet AUTO (type + client) — pas de champ Objet/Notes dans le flux assistant
      // (RDV rapide = type + créneau). Notes éditables après coup via l'édition du RDV.
      const typeLabel = getAppointmentTypeConfig(formData.appointment_type).label;
      const clientLabel = [formData.client_name, formData.client_first_name].filter(Boolean).join(' ').trim();
      const autoSubject = clientLabel
        ? `${typeLabel} — ${clientLabel}`
        : (formData.appointment_type === 'other' ? 'Rendez-vous' : typeLabel);
      const slots = assistantSlots.map((s) => ({ ...s, subject: autoSubject, notes: null }));

      const { error: batchErr } = await appointmentsService.createAppointmentBatch(slots, {
        coreOrgId: orgId,
        appointment_type: formData.appointment_type,
        lead_id: act.leadId,
        intervention_id: act.interventionId,
        client_id: selectedClient?.id || null,
        client_name: formData.client_name?.trim() || null,
        client_first_name: formData.client_first_name?.trim() || null,
        client_phone: formData.client_phone || null,
        client_email: formData.client_email || null,
        address: formData.client_address || null,
        city: formData.client_city || null,
        postal_code: formData.client_postal_code || null,
        assigned_commercial_id: assignedCommercialId,
        description: null,
        subjectPrefix: autoSubject,
      });
      if (batchErr) {
        console.error('[EventModal] batch create error:', batchErr);
        toast.error('Erreur lors de la création du RDV');
        setBatchSaving(false);
        return;
      }

      // Invalidations ciblées selon la destination de la carte.
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
      if (act.leadId) {
        queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
        if (formData.appointment_type === 'installation') {
          queryClient.invalidateQueries({ queryKey: chantierKeys.all(orgId) });
        }
      }
      if (act.interventionId) {
        queryClient.invalidateQueries({ queryKey: interventionKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      }

      toast.success(slots.length > 1 ? `${slots.length} RDV créés` : 'RDV créé avec succès');
      onClose();
    } catch (err) {
      console.error('[EventModal] handleCreateFromAssistant error:', err);
      toast.error('Une erreur est survenue');
      setBatchSaving(false);
    }
  }, [assistantSlots, fromFiche, isClosing, selectedLead, resolveActivation, reportActivationError, isCommercialType, orgId, formData, selectedClient, queryClient, onClose]);

  // --------------------------------------------------------------------------
  // Re-planifier (édition) : 1 créneau choisi dans l'assistant → update du RDV
  // existant. Si le type change, la carte cible est re-résolue (resolveActivation)
  // et appointments.service refait le sync carte (reflux ancienne / avancée nouvelle).
  // Le drag & drop calendrier reste l'autre chemin (date/heure uniquement).
  // --------------------------------------------------------------------------
  const handleRescheduleSave = useCallback(async () => {
    const slot = assistantSlots[0];
    if (!slot) {
      toast.error('Choisissez un créneau');
      return;
    }
    setBatchSaving(true);
    try {
      const typeChanged = formData.appointment_type !== appointment?.appointment_type;
      let leadId = appointment?.lead_id || null;
      let interventionId = appointment?.intervention_id || null;

      if (typeChanged) {
        const act = await resolveActivation({ rdvDate: slot.date });
        if (reportActivationError(act.error)) {
          setBatchSaving(false);
          return;
        }
        leadId = act.leadId;
        interventionId = act.interventionId;
      }

      // Objet recalculé si le type change (cohérence type — client), conservé sinon
      const typeLabel = getAppointmentTypeConfig(formData.appointment_type).label;
      const clientLabel = [formData.client_name, formData.client_first_name].filter(Boolean).join(' ').trim();
      const subject = typeChanged
        ? (clientLabel ? `${typeLabel} — ${clientLabel}` : typeLabel)
        : (formData.subject || null);

      const ok = await onSave({
        appointment_type: formData.appointment_type,
        subject,
        scheduled_date: slot.date,
        scheduled_start: slot.startTime,
        scheduled_end: slot.endTime || null,
        duration_minutes: slot.duration || Number(formData.duration_minutes) || 60,
        status: 'scheduled', // un RDV re-planifié redevient actif (ex: no_show)
        lead_id: leadId,
        intervention_id: interventionId,
        technicianIds: slot.technicianIds || [],
        assigned_commercial_id: isCommercialType
          ? (slot.assignedCommercialId || null)
          : (formData.assigned_commercial_id || null),
      });

      if (ok !== false) {
        // Cartes liées (ancienne et nouvelle cible) : rafraîchir les kanbans
        if (leadId || appointment?.lead_id) {
          queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
          queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
        }
        if (interventionId || appointment?.intervention_id) {
          queryClient.invalidateQueries({ queryKey: interventionKeys.all(orgId) });
          queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
        }
      }
    } catch (err) {
      console.error('[EventModal] handleRescheduleSave error:', err);
      toast.error('Une erreur est survenue');
    } finally {
      setBatchSaving(false);
    }
  }, [
    assistantSlots, formData, appointment, resolveActivation, reportActivationError,
    isCommercialType, onSave, orgId, queryClient,
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
    const allowed = ['rdv_technical', 'rdv_closing', 'maintenance', 'service', 'other'];
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

      {/* Panel modale — taille uniforme pour tous les types de RDV (largeur de la grille assistant) */}
      <div className="fixed inset-y-4 right-4 w-full max-w-2xl bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: typeConfig.color + '20' }}
            >
              <CalendarDays className="w-5 h-5" style={{ color: typeConfig.color }} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {isEdit ? 'Modifier le RDV' : 'Nouveau RDV'}
              </h2>
              {isEdit && appointment?.client_name && (
                <p className="text-sm text-gray-500 truncate">{appointment.client_name}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ---- Contenu scrollable ---- */}
        <div className="flex-1 overflow-y-auto p-6">
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
                allowTypeChange={rescheduleMode || canRetypeInline}
                retypeHint={canRetypeInline && !rescheduleMode
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
                />
              )}

              {/* Client : masqué si on vient d'une fiche (implicite). Sinon recherche/lien
                  (« Autre » inclus → lié au client, sans carte kanban).
                  Bouclage R2 : toujours affiché (même depuis une fiche) en mode leadOnly —
                  la sélection d'une carte pipeline existante est obligatoire. */}
              {(!fromFiche || isClosing) && (
                <SectionClient
                  formData={formData}
                  updateField={updateField}
                  errors={errors}
                  isCancelled={isCancelled}
                  showContactDetails={isEdit}
                  leadOnly={isClosing}
                  selectedClient={selectedClient}
                  selectedLead={selectedLead}
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
                  defaultDuration={Number(formData.duration_minutes) || 60}
                  initialDate={rescheduleMode ? (formData.scheduled_date || null) : null}
                  multi={!rescheduleMode && formData.appointment_type === 'installation'}
                />
              )}

              {/* Assigné classique : édition + « Autre » (sinon l'assistant gère les colonnes) */}
              {!usesAssistant && (
                <SectionAssignee
                  formData={formData}
                  updateField={updateField}
                  allTeamMembers={allTeamMembers}
                  isCancelled={isCancelled}
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

              {/* CTA Certificat d'entretien */}
              {isEdit && !rescheduleMode && entretienId && ['maintenance', 'service'].includes(formData.appointment_type) && !isCancelled && (
                <div className={`${entretienStatus === 'realise' ? 'bg-green-50 border-green-200' : 'bg-emerald-50 border-emerald-200'} border rounded-lg p-4`}>
                  <CertificatLink
                    interventionId={entretienId}
                    isRealise={entretienStatus === 'realise'}
                    onClick={onClose}
                    className="flex items-center gap-3 w-full text-left"
                  >
                    <div className={`w-10 h-10 rounded-full ${entretienStatus === 'realise' ? 'bg-green-600' : 'bg-[#1B4F72]'} flex items-center justify-center shrink-0`}>
                      <ClipboardCheck className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {entretienStatus === 'realise' ? 'Voir le certificat d\'entretien' : 'Remplir le certificat d\'entretien'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {entretienStatus === 'realise' ? 'Certificat d\'entretien complété' : 'Formulaire réglementaire obligatoire'}
                      </p>
                    </div>
                  </CertificatLink>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- Footer ---- */}
        {!confirmAction && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
            {/* Actions danger (mode edit seulement, hors re-planification) */}
            <div className="flex items-center gap-2">
              {isEdit && !isCancelled && !rescheduleMode && (
                <>
                  <button
                    onClick={() => setConfirmAction('cancel')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                    title="Annuler le RDV"
                  >
                    <Ban className="w-4 h-4" />
                    Annuler
                  </button>
                  <button
                    onClick={() => setConfirmAction('delete')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                    title="Supprimer le RDV"
                  >
                    <Trash2 className="w-4 h-4" />
                    Supprimer
                  </button>
                </>
              )}
            </div>

            {/* Actions principales */}
            <div className="flex items-center gap-3">
              {rescheduleMode ? (
                <button
                  onClick={() => {
                    setAssistantSlots([]);
                    setRescheduleMode(false);
                  }}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Retour
                </button>
              ) : (
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Fermer
                </button>
              )}
              {!isCancelled && (
                usesAssistant ? (
                  <button
                    onClick={rescheduleMode ? handleRescheduleSave : handleCreateFromAssistant}
                    disabled={batchSaving || assistantSlots.length === 0 || (isClosing && !rescheduleMode && !selectedLead)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {batchSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {rescheduleMode ? 'Enregistrement...' : 'Création...'}
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        {rescheduleMode ? 'Enregistrer le créneau' : 'Créer le RDV'}
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Enregistrement...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        {isEdit ? 'Enregistrer' : 'Créer le RDV'}
                      </>
                    )}
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default EventModal;
