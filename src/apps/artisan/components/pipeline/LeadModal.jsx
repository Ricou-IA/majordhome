/**
 * LeadModal.jsx - Majord'home Artisan
 * ============================================================================
 * Slide-over droite pour créer ou éditer un lead.
 * Sections : Contact, Pipeline, Action suivante, Notes + Timeline
 *
 * Sous-composants extraits dans :
 *   ./LeadStatusConfig.js   — ALLOWED_TRANSITIONS, getAllowedNextStatuses, LOST_REASONS
 *   ./LeadFormSections.jsx  — SectionClientLinking, SectionContact, SectionPipeline, etc.
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
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
import { formatDateForInput } from '@/lib/utils';
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
    createLead, updateLead, updateLeadStatus, convertLead, addNote,
    isCreating, isUpdating, isChangingStatus, isConverting, isAddingNote,
  } = useLeadMutations();

  // État formulaire
  const [form, setForm] = useState({
    first_name: '', last_name: '', company_name: '',
    email: '', phone: '', phone_secondary: '',
    address: '', address_complement: '', postal_code: '', city: '',
    source_id: '', status_id: '', assigned_user_id: '',
    equipment_type_id: '', order_amount_ht: '', estimated_revenue: '',
    probability: '50', next_action: '', next_action_date: '',
    notes: '', lost_reason: '',
    appointment_date: '', quote_sent_date: '', won_date: '',
  });

  const [showConvertConfirm, setShowConvertConfirm] = useState(false);
  const [linkedClient, setLinkedClient] = useState(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [editClientMode, setEditClientMode] = useState(false);
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [pendingLostStatusId, setPendingLostStatusId] = useState(null);
  const [lostReasonInput, setLostReasonInput] = useState('');
  const [pendingRdvStatusId, setPendingRdvStatusId] = useState(null);
  const [schedulingLoading, setSchedulingLoading] = useState(false);

  // Pré-remplir le formulaire en mode édition OU reset en mode création
  useEffect(() => {
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
        next_action_date: formatDateForInput(lead.next_action_date) || '',
        notes: lead.notes || '',
        lost_reason: lead.lost_reason || '',
        appointment_date: formatDateForInput(lead.appointment_date) || '',
        quote_sent_date: formatDateForInput(lead.quote_sent_date) || '',
        won_date: formatDateForInput(lead.won_date) || '',
      });
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
      setForm({
        first_name: '', last_name: '', company_name: '',
        email: '', phone: '', phone_secondary: '',
        address: '', address_complement: '', postal_code: '', city: '',
        source_id: '', status_id: defaultStatus?.id || '', assigned_user_id: '',
        equipment_type_id: '', order_amount_ht: '', estimated_revenue: '',
        probability: '50', next_action: '', next_action_date: '',
        notes: '', lost_reason: '',
        appointment_date: '', quote_sent_date: '', won_date: '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditing, lead]);

  // ========== HANDLERS ==========

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

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

      const clientExistantSource = sources.find((s) => s.name === 'Client Existant');

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
    client_id: linkedClient?.id || null,
  }), [form, linkedClient]);

  const handleSave = async () => {
    if (!form.last_name.trim()) {
      toast.error('Le nom de famille est requis');
      return;
    }
    try {
      const payload = buildPayload();
      let savedLeadId = leadId;
      if (isEditing) {
        await updateLead(leadId, payload);
      } else {
        const result = await createLead({ orgId, userId, ...payload });
        savedLeadId = result?.data?.id || null;
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
        ).catch(err => console.warn('[LeadModal] Géocodage async échoué:', err));
      }

      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[LeadModal] Erreur sauvegarde:', err);
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  const handleStatusChange = async (newStatusId) => {
    if (!isEditing || newStatusId === form.status_id) return;
    const targetStatus = statuses.find((s) => s.id === newStatusId);
    if (targetStatus?.label === 'Perdu') {
      setPendingLostStatusId(newStatusId);
      setLostReasonInput('');
      return;
    }
    if (targetStatus?.label === 'RDV planifié') {
      setPendingRdvStatusId(newStatusId);
      return;
    }
    try {
      const payload = buildPayload();
      await updateLead(leadId, payload);
      await syncClientFields();
      const result = await updateLeadStatus(leadId, newStatusId, userId);
      const targetLabel = statuses.find((s) => s.id === newStatusId)?.label;
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

  const handleConfirmScheduling = async (schedulingData) => {
    if (!pendingRdvStatusId) return;
    setSchedulingLoading(true);
    try {
      const payload = buildPayload();
      await updateLead(leadId, payload);
      await syncClientFields();
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

  // ========== COMPUTED ==========

  const groupedEquipmentTypes = useMemo(() => {
    const groups = {};
    for (const type of equipmentTypes) {
      const cat = type.category || 'autre';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(type);
    }
    return groups;
  }, [equipmentTypes]);

  const currentStatus = statuses.find((s) => s.id === form.status_id);
  const isWon = currentStatus?.is_won === true;
  const isFinal = currentStatus?.is_final === true;
  const isSaving = isCreating || isUpdating;

  const allowedNext = isEditing && currentStatus
    ? getAllowedNextStatuses(currentStatus.label, statuses)
    : [];

  const contactFieldsDisabled = !!linkedClient && !editClientMode;

  if (!isOpen) return null;

  // ========== RENDER ==========

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
              />

              <SectionContact
                form={form}
                setField={setField}
                contactFieldsDisabled={contactFieldsDisabled}
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
              />

              {/* Suivi pipeline (uniquement en édition, order >= 2) */}
              {isEditing && currentStatus && currentStatus.display_order >= 2 && (
                <SectionSuivi
                  form={form}
                  setField={setField}
                  currentStatus={currentStatus}
                  isWon={isWon}
                  lead={lead}
                />
              )}

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
              />

              <SectionNotes
                form={form}
                setField={setField}
                isEditing={isEditing}
                activities={activities}
                loadingActivities={loadingActivities}
                handleAddNote={handleAddNote}
                isAddingNote={isAddingNote}
              />
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
