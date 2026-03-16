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
import { getAppointmentTypeConfig } from '@/shared/services/appointments.service';
import { useClientSearch } from '@/shared/hooks/useClients';
import { useLeadSearch, useLeadSources, useLeadCommercials, leadKeys } from '@/shared/hooks/useLeads';
import { leadsService } from '@/shared/services/leads.service';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { formatDateForInput, computeEndTime, computeDuration } from '@/lib/utils';
import { CancelConfirmation, DeleteConfirmation } from './EventConfirmations';
import {
  SectionType,
  SectionDateTime,
  SectionClient,
  SectionCommercial,
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
 * @param {Array} props.members - Liste des techniciens
 * @param {string} [props.orgId] - core org_id (pour recherche client/lead)
 * @param {string} [props.userId] - user id (pour création lead auto)
 * @param {Function} props.onClose
 * @param {Function} props.onSave - (formData) => Promise<boolean>
 * @param {Function} props.onDelete - () => Promise
 * @param {Function} props.onCancel - (reason) => Promise
 * @param {boolean} props.isSaving
 */
export function EventModal({
  isOpen,
  mode = 'create',
  appointment = null,
  defaultDate = null,
  defaultTime = null,
  members = [],
  orgId,
  userId,
  onClose,
  onSave,
  onDelete,
  onCancel,
  isSaving = false,
}) {
  // État du formulaire
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [confirmAction, setConfirmAction] = useState(null); // 'cancel' | 'delete' | null

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

  // Commerciaux pour le dropdown "Commercial assigné"
  const { commercials = [] } = useLeadCommercials(orgId);
  const { sources: leadSources } = useLeadSources();
  const queryClient = useQueryClient();

  const isEdit = mode === 'edit';
  const isCancelled = appointment?.status === 'cancelled';

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
        rdv_context: 'autre',
        source_id: null,
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
        appointment_type: 'rdv_technical',
        priority: 'normal',
        status: 'scheduled',
        client_name: '',
        client_first_name: '',
        client_phone: '',
        client_email: '',
        client_address: '',
        client_city: '',
        client_postal_code: '',
        scheduled_date: defaultDate || new Date().toISOString().split('T')[0],
        scheduled_start: startTime,
        scheduled_end: computeEndTime(startTime, duration),
        duration_minutes: duration,
        description: '',
        internal_notes: '',
        technicianIds: [],
        assigned_commercial_id: '',
        rdv_context: 'autre',
        source_id: DEFAULT_SOURCE_BOUCHE_A_OREILLE,
      });
      setSelectedClient(null);
      setSelectedLead(null);
    }

    clearClientSearch();
    clearLeadSearch();
    setShowClientDropdown(false);
  }, [isOpen, mode, appointment, defaultDate, defaultTime, isEdit, clearClientSearch, clearLeadSearch]);

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
    if (!formData.client_name?.trim()) newErrors.client_name = 'Nom requis';
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
      rdv_context: 'prospect',
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
  // Enregistrer (avec auto-création lead pour prospects walk-in)
  // --------------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!validate()) return;

    let leadId = selectedLead?.id || null;

    // Auto-création lead pour les prospects walk-in (contexte "prospect" sans lead existant)
    if (!isEdit && formData.rdv_context === 'prospect' && !selectedLead) {
      try {
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
          source_id: formData.source_id || DEFAULT_SOURCE_BOUCHE_A_OREILLE,
          status_id: RDV_PLANIFIE_STATUS_ID,
          client_id: selectedClient?.id || null,
          notes: `Lead auto-créé depuis le Planning — RDV du ${formData.scheduled_date}`,
        });

        if (result.error) {
          console.error('[EventModal] Auto-create lead error:', result.error);
          toast.error('Erreur lors de la création automatique du lead');
          return;
        }

        leadId = result.data?.id || null;
        if (leadId) {
          toast.success('Lead créé automatiquement dans le pipeline');
        }
      } catch (err) {
        console.error('[EventModal] Auto-create lead error:', err);
        toast.error('Erreur lors de la création automatique du lead');
        return;
      }
    }

    // Construire les données à envoyer
    const data = {
      subject: formData.subject || null,
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

    // Invalider le cache leads si un lead a été créé ou lié
    if (leadId) {
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
    }
  }, [formData, validate, onSave, selectedClient, selectedLead, isEdit, orgId, userId, queryClient]);

  // Type config pour le badge coloré
  const typeConfig = useMemo(
    () => getAppointmentTypeConfig(formData.appointment_type),
    [formData.appointment_type]
  );

  // Si fermée, on ne rend rien
  if (!isOpen) return null;

  // ==========================================================================
  // RENDU
  // ==========================================================================
  return (
    <>
      {/* Overlay transparent — laisse passer les clics sur le calendrier */}
      <div className="fixed inset-0 z-40 pointer-events-none" />

      {/* Panel modale */}
      <div className="fixed inset-y-4 right-4 w-full max-w-lg bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
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
                leadSources={leadSources}
              />

              <SectionDateTime
                formData={formData}
                updateField={updateField}
                errors={errors}
                isCancelled={isCancelled}
              />

              <SectionClient
                formData={formData}
                updateField={updateField}
                errors={errors}
                isCancelled={isCancelled}
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

              <SectionCommercial
                formData={formData}
                updateField={updateField}
                commercials={commercials}
                members={members}
                isCancelled={isCancelled}
              />

              <SectionNotes
                formData={formData}
                updateField={updateField}
                isCancelled={isCancelled}
              />

              {/* CTA Certificat d'entretien */}
              {isEdit && entretienId && ['maintenance', 'service'].includes(formData.appointment_type) && !isCancelled && (
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
            {/* Actions danger (mode edit seulement) */}
            <div className="flex items-center gap-2">
              {isEdit && !isCancelled && (
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
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Fermer
              </button>
              {!isCancelled && (
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
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default EventModal;
