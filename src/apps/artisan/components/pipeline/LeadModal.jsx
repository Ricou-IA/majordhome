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
import { X, Save, Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import {
  useLead,
  useLeadActivities,
  useLeadStatuses,
  useLeadSources,
  useLeadCommercials,
  useLeadMutations,
} from '@hooks/useLeads';
import { usePricingEquipmentTypes, useClientSearch } from '@hooks/useClients';
import { supabase } from '@/lib/supabaseClient';
import { appointmentsService } from '@services/appointments.service';
import { leadsService } from '@services/leads.service';
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
import SectionDevis from '../devis/SectionDevis';
import { SchedulingPanel } from './SchedulingPanel';
import { FicheTechniqueModal } from './FicheTechniqueModal';
import { CallModal } from './CallModal';
import { QuoteModal } from './QuoteModal';
import CreateDevisModal from '../devis/CreateDevisModal';
import DevisModal from '../devis/DevisModal';
import { devisService } from '@services/devis.service';

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
export function LeadModal({ leadId, isOpen, onClose, onSaved, autoSchedule = false }) {
  const isEditing = !!leadId;
  const { organization, user, effectiveRole } = useAuth();
  const { can, canEdit, isOwner } = useCanAccess();
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
    email_sent: false,
  });

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
  const [linkedClient, setLinkedClient] = useState(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [editClientMode, setEditClientMode] = useState(false);
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [pendingLostStatusId, setPendingLostStatusId] = useState(null);
  const [lostReasonInput, setLostReasonInput] = useState('');
  const [pendingRdvStatusId, setPendingRdvStatusId] = useState(null);
  const [pendingContactStatusId, setPendingContactStatusId] = useState(null);
  const [callModalForLog, setCallModalForLog] = useState(false);
  const [callLoading, setCallLoading] = useState(false);
  const [followupModalOpen, setFollowupModalOpen] = useState(false);
  const [followupLoading, setFollowupLoading] = useState(false);
  const [pendingQuoteStatusId, setPendingQuoteStatusId] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [schedulingLoading, setSchedulingLoading] = useState(false);
  const [showFicheTechnique, setShowFicheTechnique] = useState(false);
  const [showCreateDevis, setShowCreateDevis] = useState(false);
  const [openDevisId, setOpenDevisId] = useState(null);

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
        source_id: '', status_id: defaultStatus?.id || '', assigned_user_id: defaultCommercialId,
        equipment_type_id: '', order_amount_ht: '', estimated_revenue: '',
        probability: '50', next_action: '', next_action_date: '',
        notes: '', lost_reason: '',
        appointment_date: '', quote_sent_date: '', won_date: '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditing, lead]);

  // Appliquer le commercial par défaut quand la liste se charge (mode création uniquement)
  useEffect(() => {
    if (isOpen && !isEditing && defaultCommercialId && !form.assigned_user_id) {
      setForm((prev) => ({ ...prev, assigned_user_id: defaultCommercialId }));
    }
  }, [isOpen, isEditing, defaultCommercialId]);

  // Auto-schedule : ouvrir directement le SchedulingPanel après chargement du lead
  useEffect(() => {
    if (!autoSchedule || !isOpen || !isEditing || !lead || !statuses.length) return;
    const rdvStatus = statuses.find((s) => s.label === 'RDV planifié');
    if (rdvStatus) {
      setPendingRdvStatusId(rdvStatus.id);
    }
  }, [autoSchedule, isOpen, isEditing, lead, statuses]);

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
    email_sent: form.email_sent || false,
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
        ).catch(() => {});
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
    if (targetStatus?.label === 'Contacté') {
      setPendingContactStatusId(newStatusId);
      return;
    }
    if (targetStatus?.label === 'RDV planifié') {
      setPendingRdvStatusId(newStatusId);
      return;
    }
    if (targetStatus?.label === 'Devis envoyé') {
      setPendingQuoteStatusId(newStatusId);
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

  // Confirmer transition vers Contacté (depuis bouton statut)
  const handleConfirmContact = async (callData) => {
    if (!pendingContactStatusId) return;
    setCallLoading(true);
    try {
      const payload = buildPayload();
      await updateLead(leadId, payload);
      await syncClientFields();
      await updateLeadStatus(leadId, pendingContactStatusId, userId, {
        callResult: callData.result,
        callDate: callData.date,
      });
      setPendingContactStatusId(null);
      toast.success('Lead passé en "Contacté"');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[LeadModal] Erreur passage contacté:', err);
      toast.error('Erreur lors du changement de statut');
    } finally {
      setCallLoading(false);
    }
  };

  // Confirmer transition vers Devis envoyé (depuis bouton statut)
  const handleConfirmQuote = async (quoteData) => {
    if (!pendingQuoteStatusId) return;
    setQuoteLoading(true);
    try {
      const payload = buildPayload();
      await updateLead(leadId, payload);
      await syncClientFields();
      const result = await updateLeadStatus(leadId, pendingQuoteStatusId, userId, {
        quoteSentDate: quoteData.date,
        quoteAmount: quoteData.amount,
      });
      setPendingQuoteStatusId(null);
      if (result?.clientCreated) {
        const clientName = result.clientCreated.display_name || result.clientCreated.client_number;
        toast.success(`Lead passé en "Devis envoyé" — Fiche client créée : ${clientName}`, { duration: 5000 });
      } else {
        toast.success('Lead passé en "Devis envoyé"');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[LeadModal] Erreur passage devis:', err);
      toast.error('Erreur lors du changement de statut');
    } finally {
      setQuoteLoading(false);
    }
  };

  // Envoyer le devis (marquer brouillons comme envoyés + transition lead → Devis envoyé)
  const handleSendDevis = async () => {
    try {
      // 1. Marquer tous les devis brouillon comme envoyés
      const { data: quotes } = await devisService.getQuotesByLead(leadId);
      const brouillons = (quotes || []).filter((q) => q.status === 'brouillon');
      for (const q of brouillons) {
        await devisService.sendQuote(q.id);
      }

      // 2. Calculer le montant total des devis envoyés
      const totalHt = brouillons.reduce((sum, q) => sum + (parseFloat(q.total_ht) || 0), 0);

      // 3. Passer le lead en "Devis envoyé"
      const devisEnvoyeStatus = statuses.find((s) => s.label === 'Devis envoyé');
      if (devisEnvoyeStatus) {
        const payload = buildPayload();
        await updateLead(leadId, payload);
        await syncClientFields();
        await updateLeadStatus(leadId, devisEnvoyeStatus.id, userId, {
          quoteSentDate: new Date().toISOString().split('T')[0],
          quoteAmount: totalHt || null,
        });
      }

      toast.success('Devis envoyé — lead mis à jour');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('[LeadModal] handleSendDevis:', err);
      toast.error('Erreur lors de l\'envoi du devis');
    }
  };

  // Ajouter un appel supplémentaire (lead déjà en Contacté ou +)
  const handleLogCall = async (callData) => {
    setCallLoading(true);
    try {
      const result = await leadsService.logCall(leadId, {
        orgId,
        userId,
        result: callData.result,
        callDate: callData.date,
      });
      if (result?.data) {
        setForm((prev) => ({
          ...prev,
          call_count: result.data.call_count ?? (prev.call_count || 0) + 1,
          last_call_date: result.data.last_call_date || new Date().toISOString(),
          last_call_result: callData.result,
        }));
      }
      setCallModalForLog(false);
      toast.success('Appel enregistré');
      onSaved?.();
    } catch (err) {
      console.error('[LeadModal] Erreur logCall:', err);
      toast.error('Erreur lors de l\'enregistrement de l\'appel');
    } finally {
      setCallLoading(false);
    }
  };

  // Enregistrer une relance (suivi devis envoyé)
  const handleLogFollowup = async (callData) => {
    setFollowupLoading(true);
    try {
      const result = await leadsService.logFollowup(leadId, {
        orgId,
        userId,
        result: callData.result,
        callDate: callData.date,
      });
      if (result?.data) {
        setForm((prev) => ({
          ...prev,
          followup_count: result.data.followup_count ?? (prev.followup_count || 0) + 1,
          last_followup_date: result.data.last_followup_date || new Date().toISOString(),
        }));
      }
      setFollowupModalOpen(false);
      toast.success('Relance enregistrée');
      onSaved?.();
    } catch (err) {
      console.error('[LeadModal] Erreur logFollowup:', err);
      toast.error('Erreur lors de l\'enregistrement de la relance');
    } finally {
      setFollowupLoading(false);
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
          <div className="flex items-center gap-3">
            {pendingRdvStatusId && (
              <button
                onClick={() => { setPendingRdvStatusId(null); if (autoSchedule) onClose(); }}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {pendingRdvStatusId
                  ? 'Planifier le RDV'
                  : isEditing ? 'Modifier le lead' : 'Nouveau lead'
                }
              </h2>
              {!pendingRdvStatusId && isEditing && currentStatus && (
                <Badge
                  className="mt-1 text-xs text-white"
                  style={{ backgroundColor: currentStatus.color }}
                >
                  {currentStatus.label}
                </Badge>
              )}
              {pendingRdvStatusId && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {form.first_name || ''} {form.last_name || ''}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={pendingRdvStatusId ? () => { setPendingRdvStatusId(null); if (autoSchedule) onClose(); } : onClose}
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
          ) : pendingRdvStatusId ? (
            /* ── Mode planification RDV : overlay plein body ── */
            <SchedulingPanel
              lead={lead || form}
              orgId={orgId}
              commercials={commercials}
              onConfirm={handleConfirmScheduling}
              onCancel={() => { setPendingRdvStatusId(null); if (autoSchedule) onClose(); }}
              isLoading={schedulingLoading}
            />
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
                />
              )}

              <SectionNotes
                form={form}
                setField={setField}
                isEditing={isEditing}
                activities={activities}
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
              />
            </>
          )}
        </div>

        {/* Footer sticky — masqué en mode planification RDV */}
        {!pendingRdvStatusId && (
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

      {/* Modale devis — transition vers Devis envoyé */}
      <QuoteModal
        isOpen={!!pendingQuoteStatusId}
        onClose={() => setPendingQuoteStatusId(null)}
        onConfirm={handleConfirmQuote}
        loading={quoteLoading}
        defaultAmount={form.order_amount_ht || form.estimated_revenue || ''}
      />

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
    </>
  );
}

export default LeadModal;
