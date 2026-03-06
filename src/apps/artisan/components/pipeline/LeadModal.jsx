/**
 * LeadModal.jsx - Majord'home Artisan
 * ============================================================================
 * Slide-over droite pour créer ou éditer un lead.
 * Sections : Contact, Pipeline, Action suivante, Notes + Timeline
 *
 * @version 1.0.0 - Sprint 4 Pipeline Commercial
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Save,
  Loader2,
  UserCheck,
  ArrowRightLeft,
  ChevronDown,
  Phone,
  Mail,
  MapPin,
  Euro,
  Target,
  CalendarDays,
  Search,
  UserCircle,
  PenLine,
  Unlink,
  Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import {
  useLead,
  useLeadActivities,
  useLeadStatuses,
  useLeadSources,
  useLeadCommercials,
  useLeadMutations,
} from '@/shared/hooks/useLeads';
import { usePricingEquipmentTypes, useClientSearch } from '@/shared/hooks/useClients';
import { supabase } from '@/lib/supabaseClient';
import { appointmentsService } from '@/shared/services/appointments.service';
import { LeadActivityTimeline } from './LeadActivityTimeline';
import { SchedulingPanel } from './SchedulingPanel';

// Labels catégories équipements (même que EquipmentFormModal)
const EQUIPMENT_CATEGORY_LABELS = {
  poeles: 'Poêles',
  chaudieres: 'Chaudières',
  climatisation: 'Climatisation / PAC',
  eau_chaude: 'Eau chaude',
  energie: 'Énergie',
};

// Causes de perte prédéfinies
const LOST_REASONS = [
  { value: 'Prix', label: 'Prix' },
  { value: 'Ghost', label: 'Ghost' },
  { value: 'Délai', label: 'Délai' },
  { value: 'Qualif', label: 'Qualif' },
  { value: 'Annulé', label: 'Annulé' },
  { value: 'Tech', label: 'Tech' },
];

// ============================================================================
// UTILITAIRES
// ============================================================================

const formatPhone = (value) => {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 10);
  return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
};

const formatDateInput = (dateStr) => {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
};

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

const FormField = ({ label, required, children, className = '' }) => (
  <div className={className}>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

const inputClass =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-500 min-h-[44px]';

const selectClass = `${inputClass} appearance-none bg-white`;

const SectionTitle = ({ children }) => (
  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mt-6 mb-3 first:mt-0">
    {children}
  </h3>
);

/**
 * Transitions autorisées par statut
 * Nouveau → Contacté, RDV planifié, Perdu
 * Contacté → RDV planifié, Perdu
 * RDV planifié → Devis envoyé, Perdu
 * Devis envoyé → Gagné, Perdu
 * Gagné / Perdu → terminaux (pas de transition)
 */
const ALLOWED_TRANSITIONS = {
  'Nouveau': ['Contacté', 'RDV planifié', 'Perdu'],
  'Contacté': ['RDV planifié', 'Perdu'],
  'RDV planifié': ['Devis envoyé', 'Perdu'],
  'Devis envoyé': ['Gagné', 'Perdu'],
  'Gagné': [],
  'Perdu': [],
};


/**
 * Retourne les statuts autorisés comme prochaine étape
 */
function getAllowedNextStatuses(currentLabel, allStatuses) {
  const allowedLabels = ALLOWED_TRANSITIONS[currentLabel];
  if (!allowedLabels || allowedLabels.length === 0) return [];
  return allStatuses.filter((s) => allowedLabels.includes(s.label));
}

/**
 * Dropdown statut avec pastilles colorées, filtré par transitions autorisées
 */
const StatusSelect = ({ value, statuses, onChange, disabled, allowedStatuses }) => {
  const displayStatuses = allowedStatuses && allowedStatuses.length > 0 ? allowedStatuses : statuses;
  return (
    <div className="relative">
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={selectClass}
      >
        <option value="">— Choisir un statut —</option>
        {displayStatuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
    </div>
  );
};

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
export function LeadModal({ leadId, isOpen, onClose, onSaved }) {
  const isEditing = !!leadId;
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;

  // Données
  const { lead, isLoading: loadingLead } = useLead(isEditing ? leadId : null);
  const { activities, isLoading: loadingActivities } = useLeadActivities(isEditing ? leadId : null);
  const { statuses } = useLeadStatuses();
  const { sources } = useLeadSources();
  const { commercials } = useLeadCommercials(orgId);
  const { equipmentTypes } = usePricingEquipmentTypes();
  const { query: clientSearchQuery, results: clientResults, searching: clientSearching, search: searchClient, clear: clearClientSearch } = useClientSearch(orgId);
  const {
    createLead,
    updateLead,
    updateLeadStatus,
    assignLead,
    convertLead,
    addNote,
    isCreating,
    isUpdating,
    isChangingStatus,
    isConverting,
    isAddingNote,
  } = useLeadMutations();

  // État formulaire
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    company_name: '',
    email: '',
    phone: '',
    phone_secondary: '',
    address: '',
    address_complement: '',
    postal_code: '',
    city: '',
    source_id: '',
    status_id: '',
    assigned_user_id: '',
    equipment_type_id: '',
    order_amount_ht: '',
    estimated_revenue: '',
    probability: '50',
    next_action: '',
    next_action_date: '',
    notes: '',
    lost_reason: '',
    // Dates pipeline
    appointment_date: '',
    quote_sent_date: '',
    won_date: '',
  });

  const [showConvertConfirm, setShowConvertConfirm] = useState(false);
  const [linkedClient, setLinkedClient] = useState(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [editClientMode, setEditClientMode] = useState(false);
  const [showLinkSearch, setShowLinkSearch] = useState(false);

  // Pré-remplir le formulaire en mode édition OU reset en mode création
  useEffect(() => {
    // Ne rien faire si la modale est fermée (évite les boucles infinies)
    if (!isOpen) return;

    if (isEditing && lead) {
      setForm({
        first_name: lead.first_name || '',
        last_name: lead.last_name || '',
        company_name: lead.company_name || '',
        email: lead.email || '',
        phone: lead.phone || '',
        phone_secondary: lead.phone_secondary || '',
        address: lead.address || '',
        address_complement: lead.address_complement || '',
        postal_code: lead.postal_code || '',
        city: lead.city || '',
        source_id: lead.source_id || '',
        status_id: lead.status_id || '',
        assigned_user_id: lead.assigned_user_id || '',
        equipment_type_id: lead.equipment_type_id || '',
        order_amount_ht: lead.order_amount_ht ?? '',
        estimated_revenue: lead.estimated_revenue ?? '',
        probability: lead.probability ?? '50',
        next_action: lead.next_action || '',
        next_action_date: formatDateInput(lead.next_action_date) || '',
        notes: lead.notes || '',
        lost_reason: lead.lost_reason || '',
        // Dates pipeline
        appointment_date: formatDateInput(lead.appointment_date) || '',
        quote_sent_date: formatDateInput(lead.quote_sent_date) || '',
        won_date: formatDateInput(lead.won_date) || '',
      });
      // Reset mode modification client et planification à chaque ouverture
      setEditClientMode(false);
      setShowLinkSearch(false);
      setPendingRdvStatusId(null);
      setSchedulingLoading(false);
      // Afficher le client lié en mode édition (données depuis la vue enrichie)
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
      // Mode création — statut par défaut "Nouveau"
      setLinkedClient(null);
      setEditClientMode(false);
      setShowLinkSearch(false);
      setPendingRdvStatusId(null);
      setSchedulingLoading(false);
      clearClientSearch();
      const defaultStatus = statuses.find((s) => s.display_order === 1);
      setForm({
        first_name: '',
        last_name: '',
        company_name: '',
        email: '',
        phone: '',
        phone_secondary: '',
        address: '',
        address_complement: '',
        postal_code: '',
        city: '',
        source_id: '',
        status_id: defaultStatus?.id || '',
        assigned_user_id: '',
        equipment_type_id: '',
        order_amount_ht: '',
        estimated_revenue: '',
        probability: '50',
        next_action: '',
        next_action_date: '',
        notes: '',
        lost_reason: '',
        appointment_date: '',
        quote_sent_date: '',
        won_date: '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditing, lead]);

  // Handlers
  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Sélectionner un client existant → auto-remplir les champs contact + source + client_id
  const handleSelectClient = useCallback(async (client) => {
    try {
      const { data, error } = await supabase
        .from('majordhome_clients')
        .select('id, display_name, first_name, last_name, company_name, email, phone, phone_secondary, address, address_complement, postal_code, city, client_number')
        .eq('id', client.id)
        .single();

      if (error || !data) {
        console.error('[LeadModal] fetch client error:', error);
        return;
      }

      setLinkedClient(data);
      setShowClientDropdown(false);
      setEditClientMode(false);
      setShowLinkSearch(false);
      clearClientSearch();

      // Trouver la source "Client Existant" pour l'auto-sélectionner
      const clientExistantSource = sources.find((s) => s.name === 'Client Existant');

      // Auto-remplir les champs contact + source + company_name depuis le client
      setForm((prev) => ({
        ...prev,
        first_name: data.first_name || '',
        last_name: data.last_name || data.display_name || '',
        company_name: data.company_name || '',
        email: data.email || '',
        phone: data.phone || '',
        phone_secondary: data.phone_secondary || '',
        address: data.address || '',
        address_complement: data.address_complement || '',
        postal_code: data.postal_code || '',
        city: data.city || '',
        source_id: clientExistantSource?.id || prev.source_id,
      }));
    } catch (err) {
      console.error('[LeadModal] fetch client error:', err);
    }
  }, [clearClientSearch, sources]);

  const handleUnlinkClient = useCallback(() => {
    setLinkedClient(null);
    setEditClientMode(false);
    setShowLinkSearch(false);
    clearClientSearch();
    toast.info('Client délié — vous pouvez en rechercher un autre ou laisser vide');
  }, [clearClientSearch]);

  // Synchronise les champs contact vers la fiche client liée (si mode modification actif)
  const syncClientFields = useCallback(async () => {
    if (!linkedClient?.id || !editClientMode) return false;

    const clientPayload = {
      first_name: form.first_name.trim() || null,
      last_name: form.last_name.trim(),
      company_name: form.company_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      phone_secondary: form.phone_secondary.trim() || null,
      address: form.address.trim() || null,
      address_complement: form.address_complement.trim() || null,
      postal_code: form.postal_code.trim() || null,
      city: form.city.trim() || null,
    };

    const { error } = await supabase
      .from('majordhome_clients')
      .update(clientPayload)
      .eq('id', linkedClient.id);

    if (error) {
      console.error('[LeadModal] Erreur sync client:', error);
      toast.error('Erreur lors de la mise à jour de la fiche client');
      return false;
    }
    return true;
  }, [linkedClient, editClientMode, form]);

  // Construit le payload depuis l'état du formulaire (réutilisé par save, status change, convert)
  const buildPayload = useCallback(() => ({
    first_name: form.first_name.trim() || null,
    last_name: form.last_name.trim(),
    company_name: form.company_name.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    phone_secondary: form.phone_secondary.trim() || null,
    address: form.address.trim() || null,
    address_complement: form.address_complement.trim() || null,
    postal_code: form.postal_code.trim() || null,
    city: form.city.trim() || null,
    source_id: form.source_id || null,
    status_id: form.status_id || null,
    assigned_user_id: form.assigned_user_id || null,
    equipment_type_id: form.equipment_type_id || null,
    order_amount_ht: form.order_amount_ht ? Number(form.order_amount_ht) : null,
    estimated_revenue: form.order_amount_ht ? Number(form.order_amount_ht) : null,
    probability: form.probability ? Number(form.probability) : 50,
    next_action: form.next_action.trim() || null,
    next_action_date: form.next_action_date || null,
    notes: form.notes.trim() || null,
    lost_reason: form.lost_reason.trim() || null,
    appointment_date: form.appointment_date || null,
    quote_sent_date: form.quote_sent_date || null,
    won_date: form.won_date || null,
    // Lien client (persisté si sélectionné)
    client_id: linkedClient?.id || null,
  }), [form, linkedClient]);

  const handleSave = async () => {
    if (!form.last_name.trim()) {
      toast.error('Le nom de famille est requis');
      return;
    }

    try {
      const payload = buildPayload();

      if (isEditing) {
        await updateLead(leadId, payload);
      } else {
        await createLead({ orgId, userId, ...payload });
      }

      // Sync les champs contact vers la fiche client si mode modification actif
      const synced = await syncClientFields();
      if (synced) {
        toast.success(isEditing ? 'Lead et fiche client mis à jour' : 'Lead créé — fiche client mise à jour');
      } else {
        toast.success(isEditing ? 'Lead mis à jour' : 'Lead créé');
      }

      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[LeadModal] Erreur sauvegarde:', err);
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  const [pendingLostStatusId, setPendingLostStatusId] = useState(null);
  const [lostReasonInput, setLostReasonInput] = useState('');
  const [pendingRdvStatusId, setPendingRdvStatusId] = useState(null);
  const [schedulingLoading, setSchedulingLoading] = useState(false);

  const handleStatusChange = async (newStatusId) => {
    if (!isEditing || newStatusId === form.status_id) return;

    // Vérifier si c'est un passage en "Perdu" → demander le motif
    const targetStatus = statuses.find((s) => s.id === newStatusId);
    if (targetStatus?.label === 'Perdu') {
      setPendingLostStatusId(newStatusId);
      setLostReasonInput('');
      return;
    }

    // Passage en "RDV planifié" → afficher le panneau de planification
    if (targetStatus?.label === 'RDV planifié') {
      setPendingRdvStatusId(newStatusId);
      return;
    }

    try {
      // Auto-save le formulaire AVANT le changement de statut
      // pour que la conversion lead→client utilise les données à jour
      const payload = buildPayload();
      await updateLead(leadId, payload);
      // Sync client si mode modification actif
      await syncClientFields();

      const result = await updateLeadStatus(leadId, newStatusId, userId);
      const targetLabel = statuses.find((s) => s.id === newStatusId)?.label;

      // Si une fiche client a été créée automatiquement (passage "Devis envoyé")
      if (result?.clientCreated) {
        const clientName = result.clientCreated.display_name || result.clientCreated.client_number;
        toast.success(`Lead passé en "${targetLabel}" — Fiche client créée : ${clientName}`, { duration: 5000 });
      } else {
        toast.success(`Lead passé en "${targetLabel}"`);
      }

      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[LeadModal] Erreur statut:', err);
      toast.error('Erreur lors du changement de statut');
    }
  };

  const handleConfirmLost = async () => {
    if (!lostReasonInput) {
      toast.error('Veuillez sélectionner un motif de perte');
      return;
    }
    try {
      // Auto-save le formulaire AVANT le changement de statut
      const payload = buildPayload();
      await updateLead(leadId, payload);
      await syncClientFields();

      await updateLeadStatus(leadId, pendingLostStatusId, userId, {
        lostReason: lostReasonInput.trim(),
      });
      setPendingLostStatusId(null);
      toast.success('Lead marqué comme perdu');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[LeadModal] Erreur passage perdu:', err);
      toast.error('Erreur lors du changement de statut');
    }
  };

  // Handler planification RDV — appelé par SchedulingPanel.onConfirm
  const handleConfirmScheduling = async (schedulingData) => {
    if (!pendingRdvStatusId) return;
    setSchedulingLoading(true);

    try {
      // 1. Auto-save le formulaire lead
      const payload = buildPayload();
      await updateLead(leadId, payload);
      await syncClientFields();

      // 2. Créer le RDV dans appointments
      const appointmentPayload = {
        coreOrgId: orgId,
        technicianIds: schedulingData.technicianIds,
        appointment_type: schedulingData.appointmentType,
        subject: schedulingData.subject,
        scheduled_date: schedulingData.date,
        scheduled_start: schedulingData.startTime,
        scheduled_end: schedulingData.endTime || null,
        duration_minutes: schedulingData.duration,
        client_name: form.last_name || 'Sans nom',
        client_first_name: form.first_name || null,
        client_phone: form.phone || '',
        client_email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        postal_code: form.postal_code || null,
        lead_id: leadId,
        client_id: linkedClient?.id || null,
        assigned_commercial_id: form.assigned_user_id || null,
        status: 'scheduled',
        priority: 'normal',
        internal_notes: schedulingData.notes || null,
      };

      const { data: appointment, error: aptError } = await appointmentsService.createAppointment(appointmentPayload);

      if (aptError) {
        console.error('[LeadModal] Erreur création RDV:', aptError);
        toast.error('Erreur lors de la création du RDV');
        setSchedulingLoading(false);
        return;
      }

      // 3. Changer le statut du lead + stocker appointment_id et appointment_date
      await updateLeadStatus(leadId, pendingRdvStatusId, userId, {
        appointmentDate: schedulingData.date,
        appointmentId: appointment?.id || null,
      });

      setPendingRdvStatusId(null);
      toast.success('RDV planifié avec succès');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[LeadModal] Erreur planification RDV:', err);
      toast.error('Erreur lors de la planification du RDV');
    } finally {
      setSchedulingLoading(false);
    }
  };

  const handleConvert = async () => {
    try {
      // Auto-save le formulaire AVANT la conversion
      // pour que le client soit créé avec les données à jour
      const payload = buildPayload();
      await updateLead(leadId, payload);
      await syncClientFields();

      const result = await convertLead(leadId, orgId, userId);
      if (result?.data?.skipped) {
        toast.info('Ce lead est déjà lié à un client');
      } else if (result?.data?.client) {
        const clientName = result.data.client.display_name || result.data.client.client_number;
        toast.success(`Fiche client créée : ${clientName}`, { duration: 5000 });
      } else {
        toast.success('Lead converti en client !');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[LeadModal] Erreur conversion:', err);
      toast.error('Erreur lors de la conversion');
    }
  };

  const handleAddNote = async (description) => {
    await addNote(leadId, orgId, userId, description);
    toast.success('Note ajoutée');
  };

  // Grouper les types d'équipement par catégorie
  const groupedEquipmentTypes = useMemo(() => {
    const groups = {};
    for (const type of equipmentTypes) {
      const cat = type.category || 'autre';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(type);
    }
    return groups;
  }, [equipmentTypes]);

  // Info statut courant
  const currentStatus = statuses.find((s) => s.id === form.status_id);
  const isWon = currentStatus?.is_won === true;
  const isFinal = currentStatus?.is_final === true;
  const isSaving = isCreating || isUpdating;

  // Transitions autorisées (en édition seulement)
  const allowedNext = isEditing && currentStatus
    ? getAllowedNextStatuses(currentStatus.label, statuses)
    : [];

  // Champs contact verrouillés quand un client est lié (sauf mode modification activé)
  const contactFieldsDisabled = !!linkedClient && !editClientMode;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Slide-over */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-white sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {isEditing ? 'Modifier le lead' : 'Nouveau lead'}
            </h2>
            {isEditing && currentStatus && (
              <Badge
                className="mt-1 text-xs text-white"
                style={{ backgroundColor: currentStatus.color }}
              >
                {currentStatus.label}
              </Badge>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body (scroll) */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
          {loadingLead ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              {/* ==================== CLIENT LIÉ / RECHERCHE ==================== */}
              {/* Affiche le client lié OU bouton/recherche pour en lier un */}
              <div className="mb-2">
                  {linkedClient ? (
                    <>
                      <div className="flex items-center gap-2">
                        <SectionTitle>Client lié</SectionTitle>
                        <button
                          type="button"
                          onClick={handleUnlinkClient}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors -mt-1"
                          title="Délier le client"
                        >
                          <Unlink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                        <UserCircle className="h-5 w-5 text-blue-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-blue-800 truncate block">
                            {linkedClient.display_name}
                          </span>
                          {(linkedClient.city || linkedClient.client_number) && (
                            <span className="text-xs text-blue-600">
                              {linkedClient.client_number}{linkedClient.city ? ` — ${linkedClient.city}` : ''}
                            </span>
                          )}
                        </div>
                        {/* Toggle mode modification infos client */}
                        <button
                          type="button"
                          onClick={() => setEditClientMode(!editClientMode)}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors shrink-0 ${
                            editClientMode
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                          }`}
                          title={editClientMode ? 'Désactiver la modification' : 'Modifier les infos client'}
                        >
                          <PenLine className="h-3 w-3" />
                          {editClientMode ? 'Modification' : 'Modifier'}
                        </button>
                      </div>
                      {/* Avertissement sync client */}
                      {editClientMode && (
                        <div className="mt-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                          Les modifications des champs contact seront répercutées sur la fiche client à l'enregistrement
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* En édition sans client lié : bouton pour ouvrir la recherche */}
                      {isEditing && !showLinkSearch ? (
                        <button
                          type="button"
                          onClick={() => setShowLinkSearch(true)}
                          className="flex items-center gap-2 w-full px-3 py-2.5 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors"
                        >
                          <Link2 className="h-4 w-4" />
                          Lier à un client existant
                        </button>
                      ) : (
                        <>
                          {/* Mode création OU recherche ouverte en édition */}
                          <div className="flex items-center gap-2">
                            <SectionTitle>Client existant</SectionTitle>
                            {isEditing && (
                              <button
                                type="button"
                                onClick={() => { setShowLinkSearch(false); clearClientSearch(); }}
                                className="flex items-center text-xs text-gray-400 hover:text-gray-600 transition-colors -mt-1"
                                title="Fermer la recherche"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="relative">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                              <input
                                type="text"
                                value={clientSearchQuery}
                                onChange={(e) => {
                                  searchClient(e.target.value);
                                  setShowClientDropdown(true);
                                }}
                                onFocus={() => {
                                  if (clientSearchQuery.length >= 2) setShowClientDropdown(true);
                                }}
                                onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                                className={`${inputClass} pl-9`}
                                placeholder="Rechercher un client existant..."
                              />
                              {clientSearching && (
                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                              )}
                            </div>
                            {showClientDropdown && clientResults.length > 0 && (
                              <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                {clientResults.map((client) => (
                                  <button
                                    key={client.id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => handleSelectClient(client)}
                                    className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
                                  >
                                    <span className="text-sm font-medium text-gray-900 block truncate">
                                      {client.display_name}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {client.client_number}{client.city ? ` — ${client.city}` : ''}{client.phone ? ` — ${client.phone}` : ''}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {showClientDropdown && clientSearchQuery.length >= 2 && !clientSearching && clientResults.length === 0 && (
                              <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-3 text-sm text-gray-500 italic">
                                Aucun client trouvé
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}
              </div>

              {/* ==================== CONTACT ==================== */}
              <SectionTitle>Contact</SectionTitle>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Prénom">
                  <input
                    type="text"
                    value={form.first_name}
                    onChange={(e) => setField('first_name', e.target.value)}
                    className={inputClass}
                    placeholder="Prénom"
                    disabled={contactFieldsDisabled}
                  />
                </FormField>
                <FormField label="Nom" required>
                  <input
                    type="text"
                    value={form.last_name}
                    onChange={(e) => setField('last_name', e.target.value)}
                    className={inputClass}
                    placeholder="Nom *"
                    disabled={contactFieldsDisabled}
                  />
                </FormField>
              </div>

              <FormField label="Société / Entreprise" className="mt-3">
                <input
                  type="text"
                  value={form.company_name}
                  onChange={(e) => setField('company_name', e.target.value)}
                  className={inputClass}
                  placeholder="Optionnel — rempli si B2B"
                  disabled={contactFieldsDisabled}
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <FormField label="Téléphone">
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setField('phone', formatPhone(e.target.value))}
                      className={`${inputClass} pl-9`}
                      placeholder="06 00 00 00 00"
                      disabled={contactFieldsDisabled}
                    />
                  </div>
                </FormField>
                <FormField label="Tél. secondaire">
                  <input
                    type="tel"
                    value={form.phone_secondary}
                    onChange={(e) => setField('phone_secondary', formatPhone(e.target.value))}
                    className={inputClass}
                    placeholder="Optionnel"
                    disabled={contactFieldsDisabled}
                  />
                </FormField>
              </div>

              <FormField label="Email" className="mt-3">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    className={`${inputClass} pl-9`}
                    placeholder="email@exemple.fr"
                    disabled={contactFieldsDisabled}
                  />
                </div>
              </FormField>

              <FormField label="Adresse" className="mt-3">
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setField('address', e.target.value)}
                    className={`${inputClass} pl-9`}
                    placeholder="Adresse"
                    disabled={contactFieldsDisabled}
                  />
                </div>
              </FormField>

              <input
                type="text"
                value={form.address_complement}
                onChange={(e) => setField('address_complement', e.target.value)}
                className={`${inputClass} mt-2`}
                placeholder="Complément d'adresse"
                disabled={contactFieldsDisabled}
              />

              <div className="grid grid-cols-3 gap-3 mt-2">
                <FormField label="CP">
                  <input
                    type="text"
                    value={form.postal_code}
                    onChange={(e) => setField('postal_code', e.target.value.replace(/\D/g, '').slice(0, 5))}
                    className={inputClass}
                    placeholder="81600"
                    maxLength={5}
                    disabled={contactFieldsDisabled}
                  />
                </FormField>
                <FormField label="Ville" className="col-span-2">
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => setField('city', e.target.value)}
                    className={inputClass}
                    placeholder="Gaillac"
                    disabled={contactFieldsDisabled}
                  />
                </FormField>
              </div>

              {/* ==================== PIPELINE ==================== */}
              <SectionTitle>Pipeline</SectionTitle>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Source">
                  <div className="relative">
                    <select
                      value={form.source_id}
                      onChange={(e) => setField('source_id', e.target.value)}
                      className={selectClass}
                    >
                      <option value="">— Source —</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  </div>
                </FormField>

                <FormField label="Statut">
                  {isEditing ? (
                    <div
                      className="px-3 py-2.5 border rounded-lg text-sm font-medium min-h-[44px] flex items-center gap-2"
                      style={{
                        borderColor: `${currentStatus?.color}40`,
                        backgroundColor: `${currentStatus?.color}10`,
                        color: currentStatus?.color,
                      }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: currentStatus?.color }}
                      />
                      {currentStatus?.label || '—'}
                    </div>
                  ) : (
                    <StatusSelect
                      value={form.status_id}
                      statuses={statuses}
                      onChange={(v) => setField('status_id', v)}
                    />
                  )}
                </FormField>
              </div>

              {/* Formulaire motif de perte (inline quand passage en Perdu) */}
              {pendingLostStatusId && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
                  <p className="text-sm font-medium text-red-800">
                    Motif de perte (objection) *
                  </p>
                  <select
                    value={lostReasonInput}
                    onChange={(e) => setLostReasonInput(e.target.value)}
                    className={`${inputClass} border-red-300 focus:ring-red-500 focus:border-red-500`}
                    autoFocus
                  >
                    <option value="">— Sélectionner —</option>
                    {LOST_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleConfirmLost}
                      disabled={isChangingStatus}
                      className="bg-red-600 hover:bg-red-700 min-h-[36px]"
                    >
                      {isChangingStatus ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Confirmer Perdu'
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPendingLostStatusId(null)}
                      className="min-h-[36px]"
                    >
                      Annuler
                    </Button>
                  </div>
                </div>
              )}

              {/* Panneau de planification RDV (inline quand passage en RDV planifié) */}
              {pendingRdvStatusId && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <SchedulingPanel
                    lead={lead || form}
                    orgId={orgId}
                    commercials={commercials}
                    onConfirm={handleConfirmScheduling}
                    onCancel={() => setPendingRdvStatusId(null)}
                    isLoading={schedulingLoading}
                  />
                </div>
              )}

              <FormField label="Équipement concerné" className="mt-3">
                <div className="relative">
                  <select
                    value={form.equipment_type_id}
                    onChange={(e) => setField('equipment_type_id', e.target.value)}
                    className={selectClass}
                  >
                    <option value="">—</option>
                    {Object.entries(groupedEquipmentTypes).map(([category, types]) => (
                      <optgroup key={category} label={EQUIPMENT_CATEGORY_LABELS[category] || category}>
                        {types.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>
              </FormField>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <FormField label="Commercial assigné">
                  <div className="relative">
                    <select
                      value={form.assigned_user_id}
                      onChange={(e) => setField('assigned_user_id', e.target.value)}
                      className={selectClass}
                    >
                      <option value="">— Non assigné —</option>
                      {commercials.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  </div>
                </FormField>

                <FormField label="Probabilité (%)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.probability}
                    onChange={(e) => setField('probability', e.target.value)}
                    className={inputClass}
                  />
                </FormField>
              </div>

              <FormField label="Montant HT (€)" className="mt-3">
                <div className="relative">
                  <Euro className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={form.order_amount_ht}
                    onChange={(e) => setField('order_amount_ht', e.target.value)}
                    className={`${inputClass} pl-9`}
                    placeholder="0"
                  />
                </div>
              </FormField>

              {/* Raison perdue (si statut Perdu) */}
              {isFinal && !isWon && (
                <FormField label="Raison de perte" className="mt-3">
                  <select
                    value={form.lost_reason}
                    onChange={(e) => setField('lost_reason', e.target.value)}
                    className={inputClass}
                  >
                    <option value="">— Sélectionner —</option>
                    {LOST_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </FormField>
              )}

              {/* ==================== SUIVI PIPELINE ==================== */}
              {isEditing && currentStatus && currentStatus.display_order >= 2 && (
                <>
                  <SectionTitle>Suivi pipeline</SectionTitle>

                  {/* Contacté : appels (lecture seule, auto-rempli) */}
                  {currentStatus.display_order >= 2 && (
                    <div className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg">
                      <Phone className="h-4 w-4 text-amber-500 shrink-0" />
                      <div className="flex-1 text-sm">
                        <span className="font-medium text-gray-700">Appels :</span>
                        {' '}
                        {lead?.call_count > 0 ? (
                          <span className="text-gray-600">
                            {lead.call_count} appel{lead.call_count > 1 ? 's' : ''}
                            {lead?.last_call_date && (
                              <span className="text-gray-400">
                                {' — dernier le '}
                                {new Date(lead.last_call_date).toLocaleDateString('fr-FR')}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400 italic">Aucun appel enregistré</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* RDV planifié : date du RDV */}
                  {currentStatus.display_order >= 3 && (
                    <FormField label="Date du RDV" className="mt-3">
                      <div className="relative">
                        <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="date"
                          value={form.appointment_date}
                          onChange={(e) => setField('appointment_date', e.target.value)}
                          className={`${inputClass} pl-9`}
                        />
                      </div>
                    </FormField>
                  )}

                  {/* Devis envoyé : date d'envoi */}
                  {currentStatus.display_order >= 4 && (
                    <FormField label="Date d'envoi du devis" className="mt-3">
                      <div className="relative">
                        <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="date"
                          value={form.quote_sent_date}
                          onChange={(e) => setField('quote_sent_date', e.target.value)}
                          className={`${inputClass} pl-9`}
                        />
                      </div>
                    </FormField>
                  )}

                  {/* Gagné : date de signature */}
                  {isWon && (
                    <FormField label="Date de signature" className="mt-3">
                      <div className="relative">
                        <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="date"
                          value={form.won_date}
                          onChange={(e) => setField('won_date', e.target.value)}
                          className={`${inputClass} pl-9`}
                        />
                      </div>
                    </FormField>
                  )}
                </>
              )}

              {/* ==================== ACTION SUIVANTE ==================== */}
              {isEditing && allowedNext.length > 0 && (
                <>
                  <SectionTitle>Action suivante</SectionTitle>
                  <div className="flex flex-wrap gap-2">
                    {allowedNext.map((status) => {
                      const isPerdu = status.label === 'Perdu';
                      return (
                        <button
                          key={status.id}
                          type="button"
                          onClick={() => handleStatusChange(status.id)}
                          disabled={isChangingStatus}
                          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]
                            ${isPerdu
                              ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                              : 'text-white hover:opacity-90'
                            }`}
                          style={isPerdu ? {} : { backgroundColor: status.color }}
                        >
                          {isChangingStatus ? (
                            <Loader2 className="h-4 w-4 animate-spin inline mr-1" />
                          ) : (
                            <ArrowRightLeft className="h-4 w-4 inline mr-1" />
                          )}
                          {status.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {isFinal && (
                <div className="mt-6 px-3 py-2.5 bg-gray-50 rounded-lg text-sm text-gray-500 italic flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  {isWon ? 'Lead gagné — prêt à convertir en client' : 'Lead clôturé'}
                </div>
              )}

              {/* ==================== NOTES ==================== */}
              <SectionTitle>Notes</SectionTitle>

              <textarea
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                className={`${inputClass} min-h-[100px] resize-y`}
                placeholder="Notes internes..."
                rows={3}
              />

              {/* ==================== ACTIONS LEAD ==================== */}
              {isEditing && (
                <>
                  <SectionTitle>Actions</SectionTitle>
                  <div className="flex flex-wrap gap-2">
                    {/* Convertir en client (si gagné et pas encore lié) */}
                    {isWon && !lead?.client_id && !lead?.converted_date && (
                      <>
                        {showConvertConfirm ? (
                          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg w-full">
                            <UserCheck className="h-5 w-5 text-emerald-600 shrink-0" />
                            <span className="text-sm text-emerald-800 flex-1">
                              Créer un client à partir de ce lead ?
                            </span>
                            <Button
                              size="sm"
                              onClick={handleConvert}
                              disabled={isConverting}
                              className="bg-emerald-600 hover:bg-emerald-700 min-h-[36px]"
                            >
                              {isConverting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                'Confirmer'
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setShowConvertConfirm(false)}
                              className="min-h-[36px]"
                            >
                              Annuler
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowConvertConfirm(true)}
                            className="gap-1 min-h-[40px] border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          >
                            <UserCheck className="h-4 w-4" />
                            Convertir en client
                          </Button>
                        )}
                      </>
                    )}

                    {(lead?.converted_date || lead?.client_id) && (
                      <div className="text-sm text-emerald-600 font-medium flex items-center gap-1.5 px-3 py-2 bg-emerald-50 rounded-lg">
                        <UserCheck className="h-4 w-4" />
                        {lead?.converted_date
                          ? `Converti le ${new Date(lead.converted_date).toLocaleDateString('fr-FR')}`
                          : 'Client lié'}
                        {lead?.client_display_name && (
                          <span className="text-emerald-500 ml-1">
                            — {lead.client_display_name}
                          </span>
                        )}
                      </div>
                    )}

                  </div>
                </>
              )}

              {/* ==================== TIMELINE ==================== */}
              {isEditing && (
                <>
                  <SectionTitle>Historique</SectionTitle>
                  <LeadActivityTimeline
                    activities={activities}
                    isLoading={loadingActivities}
                    onAddNote={handleAddNote}
                    isAddingNote={isAddingNote}
                  />
                </>
              )}
            </>
          )}
        </div>

        {/* Footer sticky */}
        <div className="border-t bg-white px-6 py-4 flex items-center justify-between sticky bottom-0">
          <Button variant="outline" onClick={onClose} className="min-h-[44px]">
            Annuler
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="gap-2 min-h-[44px] bg-blue-600 hover:bg-blue-700"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isEditing ? 'Enregistrer' : 'Créer le lead'}
          </Button>
        </div>
      </div>
    </>
  );
}

export default LeadModal;
