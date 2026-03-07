/**
 * EventModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale de création / édition de rendez-vous (appointments).
 * Utilisée par Planning.jsx pour le CRUD des événements calendrier.
 *
 * @version 2.0.0 - Sprint 2 Planning + Recherche unifiée clients/leads + Contexte RDV + Auto-create lead
 *
 * @example
 * <EventModal
 *   isOpen={true}
 *   mode="create"
 *   appointment={null}
 *   defaultDate="2026-02-20"
 *   defaultTime="09:00"
 *   members={teamMembers}
 *   onClose={() => {}}
 *   onSave={(formData) => {}}
 *   onDelete={() => {}}
 *   onCancel={(reason) => {}}
 *   isSaving={false}
 * />
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Save,
  Loader2,
  Trash2,
  Ban,
  Clock,
  MapPin,
  Phone,
  Mail,
  User,
  UserCircle,
  CalendarDays,
  Tag,
  AlertTriangle,
  FileText,
  Search,
  ExternalLink,
  Link2,
  Unlink,
} from 'lucide-react';
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_STATUSES,
  getAppointmentTypeConfig,
} from '@/shared/services/appointments.service';
import { useClientSearch } from '@/shared/hooks/useClients';
import { useLeadSearch, useLeadSources, useLeadCommercials, leadKeys } from '@/shared/hooks/useLeads';
import { leadsService } from '@/shared/services/leads.service';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { formatDateForInput } from '@/lib/utils';

// ID du statut "RDV planifié" (table majordhome.statuses)
const RDV_PLANIFIE_STATUS_ID = 'e23d04b8-da2e-4477-8e1c-b92868b682ae';
// ID source par défaut pour les walk-in
const DEFAULT_SOURCE_BOUCHE_A_OREILLE = '3d945733-475a-46ee-891b-50acf9e2151d';

// ============================================================================
// CONSTANTES
// ============================================================================

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1h' },
  { value: 90, label: '1h30' },
  { value: 120, label: '2h' },
  { value: 180, label: '3h' },
  { value: 240, label: '4h' },
];

/**
 * Calcule l'heure de fin à partir de l'heure de début et la durée
 */
function computeEndTime(startTime, durationMinutes) {
  if (!startTime || !durationMinutes) return '';
  const [h, m] = startTime.split(':').map(Number);
  const totalMin = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Calcule la durée en minutes entre deux heures HH:MM
 */
function computeDuration(startTime, endTime) {
  if (!startTime || !endTime) return 60;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff : 60;
}

// ============================================================================
// SOUS-COMPOSANTS FORMULAIRE
// ============================================================================

const FormField = ({ label, children, required = false, error = null, className = '' }) => (
  <div className={`space-y-1 ${className}`}>
    <label className="block text-sm font-medium text-gray-700">
      {label}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
    {children}
    {error && (
      <p className="text-sm text-red-600 flex items-center gap-1">
        <AlertTriangle className="w-3.5 h-3.5" />
        {error}
      </p>
    )}
  </div>
);

const TextInput = ({ value, onChange, placeholder, type = 'text', disabled = false, ...props }) => (
  <input
    type={type}
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    disabled={disabled}
    className={`
      w-full px-3 py-2 border rounded-lg text-sm outline-none transition-colors
      ${disabled
        ? 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
        : 'bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
      }
    `}
    {...props}
  />
);

const SelectInput = ({ value, onChange, options, placeholder, disabled = false }) => (
  <select
    value={value || ''}
    onChange={(e) => onChange(e.target.value || null)}
    disabled={disabled}
    className={`
      w-full px-3 py-2 border rounded-lg text-sm outline-none transition-colors
      ${disabled
        ? 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
        : 'bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
      }
    `}
  >
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
);

const TextArea = ({ value, onChange, placeholder, rows = 3, disabled = false }) => (
  <textarea
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    disabled={disabled}
    className={`
      w-full px-3 py-2 border rounded-lg text-sm outline-none transition-colors resize-none
      ${disabled
        ? 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed'
        : 'bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
      }
    `}
  />
);

/**
 * Sélecteur de techniciens (multi-select avec checkboxes)
 */
// TechnicianSelect importé depuis ./TechnicianSelect.jsx (composant partagé)

// ============================================================================
// MODALE D'ANNULATION
// ============================================================================

function CancelConfirmation({ onConfirm, onBack, isSaving }) {
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <Ban className="w-5 h-5 text-amber-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800">Annuler ce rendez-vous ?</p>
          <p className="text-sm text-amber-600">Le RDV sera marqué comme annulé mais restera visible.</p>
        </div>
      </div>

      <FormField label="Motif d'annulation">
        <TextArea
          value={reason}
          onChange={setReason}
          placeholder="Indiquez le motif de l'annulation..."
          rows={3}
        />
      </FormField>

      <div className="flex items-center gap-3 justify-end">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Retour
        </button>
        <button
          onClick={() => onConfirm(reason)}
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
          Confirmer l'annulation
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// MODALE DE SUPPRESSION
// ============================================================================

function DeleteConfirmation({ appointmentSubject, onConfirm, onBack, isSaving }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
        <Trash2 className="w-5 h-5 text-red-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-red-800">Supprimer ce rendez-vous ?</p>
          <p className="text-sm text-red-600">
            {appointmentSubject
              ? `"${appointmentSubject}" sera définitivement supprimé.`
              : 'Ce rendez-vous sera définitivement supprimé.'
            }
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 justify-end">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Retour
        </button>
        <button
          onClick={onConfirm}
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Supprimer définitivement
        </button>
      </div>
    </div>
  );
}

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
  const [selectedClient, setSelectedClient] = useState(null); // { id, display_name, client_number, phone, city }
  const [selectedLead, setSelectedLead] = useState(null); // { id, first_name, last_name, display_name, status_label, source_name, client_id }
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

  // Initialiser le formulaire
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

      // Restaurer le client lié si l'appointment a un client_id
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

      // Restaurer le lead lié si l'appointment a un lead_id
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

  // Mettre à jour un champ
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

  // Validation
  const validate = useCallback(() => {
    const newErrors = {};

    if (!formData.scheduled_date) newErrors.scheduled_date = 'Date requise';
    if (!formData.scheduled_start) newErrors.scheduled_start = 'Heure de début requise';
    if (!formData.client_name?.trim()) newErrors.client_name = 'Nom requis';
    if (!formData.appointment_type) newErrors.appointment_type = 'Type requis';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Sélectionner un client depuis la recherche → auto-remplir les champs
  const handleSelectClient = useCallback(async (client) => {
    try {
      // Fetch le record client complet pour tous les champs contact
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

      // Auto-remplir les champs contact depuis la fiche client
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

  // Délier le client sélectionné (retour en saisie manuelle) — vider les champs
  const handleUnlinkClient = useCallback(() => {
    setSelectedClient(null);
    clearClientSearch();
    // Vider tous les champs contact
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

  // Sélectionner un lead depuis la recherche → auto-remplir les champs
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

    // Auto-remplir les champs contact depuis le lead
    setFormData(prev => ({
      ...prev,
      client_name: lead.last_name || '',
      client_first_name: lead.first_name || '',
      client_phone: lead.phone || '',
      client_email: lead.email || '',
      client_address: lead.address || '',
      client_postal_code: lead.postal_code || '',
      client_city: lead.city || '',
      rdv_context: 'prospect', // auto-set contexte
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

  // Délier le lead sélectionné
  const handleUnlinkLead = useCallback(() => {
    setSelectedLead(null);
    // NE PAS toucher selectedClient ni les champs — juste détacher le lead
  }, []);

  // Enregistrer
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

  return (
    <>
      {/* Overlay transparent — laisse passer les clics sur le calendrier */}
      <div
        className="fixed inset-0 z-40 pointer-events-none"
      />

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

              {/* ---- Section : Type ---- */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-gray-500" />
                  Type
                </h3>
                <FormField label="Type de RDV" required error={errors.appointment_type}>
                  <SelectInput
                    value={formData.appointment_type}
                    onChange={(v) => updateField('appointment_type', v)}
                    options={APPOINTMENT_TYPES}
                    disabled={isEdit || isCancelled}
                  />
                </FormField>
                <div className="mt-4">
                  <FormField label="Objet">
                    <TextInput
                      value={formData.subject}
                      onChange={(v) => updateField('subject', v)}
                      placeholder="Ex: Installation PAC, Entretien annuel..."
                      disabled={isCancelled}
                    />
                  </FormField>
                </div>
                {/* Contexte RDV (mode création uniquement) */}
                {!isEdit && (
                  <div className="mt-4">
                    <div className={`grid ${formData.rdv_context === 'prospect' && !selectedLead ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                      <FormField label="Contexte du RDV">
                        <SelectInput
                          value={formData.rdv_context}
                          onChange={(v) => updateField('rdv_context', v)}
                          options={[
                            { value: 'prospect', label: '🟣 Nouveau prospect' },
                            { value: 'entretien', label: '🔧 Entretien / Maintenance' },
                            { value: 'autre', label: 'Autre' },
                          ]}
                          disabled={isCancelled}
                        />
                      </FormField>
                      {formData.rdv_context === 'prospect' && !selectedLead && (
                        <FormField label="Source du lead">
                          <SelectInput
                            value={formData.source_id}
                            onChange={(v) => updateField('source_id', v)}
                            options={leadSources.map(s => ({ value: s.id, label: s.name }))}
                            placeholder="— Source —"
                            disabled={isCancelled}
                          />
                        </FormField>
                      )}
                    </div>
                    {formData.rdv_context === 'prospect' && !selectedLead && (
                      <p className="text-xs text-violet-600 mt-2 flex items-center gap-1">
                        <Link2 className="w-3 h-3" />
                        Un lead sera créé automatiquement dans le pipeline au statut "RDV planifié"
                      </p>
                    )}
                  </div>
                )}
                {isEdit && (
                  <div className="mt-4">
                    <FormField label="Statut">
                      <SelectInput
                        value={formData.status}
                        onChange={(v) => updateField('status', v)}
                        options={APPOINTMENT_STATUSES.filter(s => s.value !== 'cancelled')}
                        disabled={isCancelled}
                      />
                    </FormField>
                  </div>
                )}
              </div>

              {/* ---- Section : Date & Heure ---- */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-500" />
                  Date & Heure
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Date" required error={errors.scheduled_date}>
                    <TextInput
                      type="date"
                      value={formData.scheduled_date}
                      onChange={(v) => updateField('scheduled_date', v)}
                      disabled={isCancelled}
                    />
                  </FormField>
                  <FormField label="Durée">
                    <SelectInput
                      value={formData.duration_minutes}
                      onChange={(v) => updateField('duration_minutes', Number(v))}
                      options={DURATION_OPTIONS}
                      disabled={isCancelled}
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <FormField label="Début" required error={errors.scheduled_start}>
                    <TextInput
                      type="time"
                      value={formData.scheduled_start}
                      onChange={(v) => updateField('scheduled_start', v)}
                      disabled={isCancelled}
                    />
                  </FormField>
                  <FormField label="Fin">
                    <TextInput
                      type="time"
                      value={formData.scheduled_end}
                      onChange={(v) => updateField('scheduled_end', v)}
                      disabled={isCancelled}
                    />
                  </FormField>
                </div>
              </div>

              {/* ---- Section : Client ---- */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  Client
                </h3>

                {/* Bannière client lié */}
                {selectedClient && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg mb-3">
                    <UserCircle className="w-5 h-5 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-blue-800 truncate block">
                        {selectedClient.display_name}
                      </span>
                      <span className="text-xs text-blue-600">
                        {selectedClient.client_number && `${selectedClient.client_number}`}
                        {selectedClient.city ? `${selectedClient.client_number ? ' — ' : ''}${selectedClient.city}` : ''}
                      </span>
                    </div>
                    {/* Voir la fiche client */}
                    <button
                      type="button"
                      onClick={() => navigate(`/artisan/clients/${selectedClient.id}`)}
                      className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-md transition-colors shrink-0"
                      title="Voir la fiche client"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Fiche
                    </button>
                    {/* Délier */}
                    {!isCancelled && (
                      <button
                        type="button"
                        onClick={handleUnlinkClient}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                        title="Délier le client"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Bannière lead lié */}
                {selectedLead && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-violet-50 border border-violet-200 rounded-lg mb-3">
                    <Link2 className="w-5 h-5 text-violet-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-violet-800 truncate block">
                        {selectedLead.display_name}
                      </span>
                      <span className="text-xs text-violet-600">
                        {selectedLead.status_label || 'Lead'}{selectedLead.source_name ? ` · ${selectedLead.source_name}` : ''}
                      </span>
                    </div>
                    {/* Voir le lead dans le pipeline */}
                    <button
                      type="button"
                      onClick={() => navigate('/artisan/pipeline')}
                      className="flex items-center gap-1 text-xs px-2 py-1 bg-violet-100 text-violet-700 hover:bg-violet-200 rounded-md transition-colors shrink-0"
                      title="Voir dans le pipeline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Lead
                    </button>
                    {/* Délier */}
                    {!isCancelled && (
                      <button
                        type="button"
                        onClick={handleUnlinkLead}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                        title="Délier le lead"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Recherche unifiée clients + leads (affiché quand pas de client/lead lié et pas annulé) */}
                {!selectedClient && !selectedLead && !isCancelled && (
                  <div className="relative mb-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={clientSearchQuery}
                        onChange={(e) => {
                          const val = e.target.value;
                          searchClient(val);
                          searchLead(val);
                          setShowClientDropdown(true);
                        }}
                        onFocus={() => {
                          if (clientSearchQuery.length >= 2) setShowClientDropdown(true);
                        }}
                        onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                        className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg text-sm outline-none transition-colors bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Rechercher un client ou un lead..."
                      />
                      {(clientSearching || leadSearching) && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />
                      )}
                    </div>
                    {/* Dropdown résultats unifiés */}
                    {showClientDropdown && (clientSearchResults.length > 0 || leadSearchResults.length > 0) && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {/* Section Clients */}
                        {clientSearchResults.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                              Clients ({clientSearchResults.length})
                            </div>
                            {clientSearchResults.map((client) => (
                              <button
                                key={`client-${client.id}`}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleSelectClient(client)}
                                className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
                              >
                                <span className="text-sm font-medium text-gray-900 block truncate">
                                  {client.display_name}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {client.client_number}{client.city ? ` — ${client.city}` : ''}{client.phone ? ` — ${client.phone}` : ''}
                                </span>
                              </button>
                            ))}
                          </>
                        )}
                        {/* Section Leads */}
                        {leadSearchResults.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 bg-violet-50 text-xs font-semibold text-violet-600 uppercase tracking-wide border-b border-gray-100">
                              Leads ({leadSearchResults.length})
                            </div>
                            {leadSearchResults.map((lead) => (
                              <button
                                key={`lead-${lead.id}`}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleSelectLead(lead)}
                                className="w-full text-left px-3 py-2 hover:bg-violet-50 transition-colors border-b border-gray-100 last:border-b-0"
                              >
                                <span className="text-sm font-medium text-gray-900 block truncate">
                                  {lead.display_name}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {lead.status_label && (
                                    <span
                                      className="inline-block px-1.5 py-0.5 rounded text-xs mr-1"
                                      style={{
                                        backgroundColor: lead.status_color ? `${lead.status_color}20` : '#f3f4f6',
                                        color: lead.status_color || '#6b7280',
                                      }}
                                    >
                                      {lead.status_label}
                                    </span>
                                  )}
                                  {lead.source_name && `· ${lead.source_name}`}
                                  {lead.city && ` · ${lead.city}`}
                                </span>
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                    {/* Aucun résultat */}
                    {showClientDropdown && clientSearchQuery.length >= 2 && !clientSearching && !leadSearching && clientSearchResults.length === 0 && leadSearchResults.length === 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-3 text-sm text-gray-500 italic">
                        Aucun client ou lead trouvé
                      </div>
                    )}
                  </div>
                )}

                {/* Séparateur saisie manuelle */}
                {!selectedClient && !selectedLead && !isCancelled && (
                  <p className="text-xs text-gray-400 mb-2 text-center">— ou saisie manuelle —</p>
                )}

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Nom" required error={errors.client_name}>
                      <TextInput
                        value={formData.client_name}
                        onChange={(v) => updateField('client_name', v)}
                        placeholder="DUPONT"
                        disabled={isCancelled || !!selectedClient || !!selectedLead}
                      />
                    </FormField>
                    <FormField label="Prénom">
                      <TextInput
                        value={formData.client_first_name}
                        onChange={(v) => updateField('client_first_name', v)}
                        placeholder="Jean"
                        disabled={isCancelled || !!selectedClient || !!selectedLead}
                      />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="Téléphone">
                      <TextInput
                        value={formData.client_phone}
                        onChange={(v) => updateField('client_phone', v)}
                        placeholder="06 12 34 56 78"
                        type="tel"
                        disabled={isCancelled || !!selectedClient || !!selectedLead}
                      />
                    </FormField>
                    <FormField label="Email">
                      <TextInput
                        value={formData.client_email}
                        onChange={(v) => updateField('client_email', v)}
                        placeholder="client@email.com"
                        type="email"
                        disabled={isCancelled || !!selectedClient || !!selectedLead}
                      />
                    </FormField>
                  </div>
                  <FormField label="Adresse">
                    <TextInput
                      value={formData.client_address}
                      onChange={(v) => updateField('client_address', v)}
                      placeholder="12 rue des Lilas"
                      disabled={isCancelled || !!selectedClient || !!selectedLead}
                    />
                  </FormField>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="Code postal">
                      <TextInput
                        value={formData.client_postal_code}
                        onChange={(v) => updateField('client_postal_code', v)}
                        placeholder="40100"
                        disabled={isCancelled || !!selectedClient || !!selectedLead}
                      />
                    </FormField>
                    <FormField label="Ville">
                      <TextInput
                        value={formData.client_city}
                        onChange={(v) => updateField('client_city', v)}
                        placeholder="Dax"
                        disabled={isCancelled || !!selectedClient || !!selectedLead}
                      />
                    </FormField>
                  </div>
                </div>
              </div>

              {/* ---- Section : Commercial assigné ---- */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  Commercial assigné
                </h3>
                <SelectInput
                  value={formData.assigned_commercial_id || ''}
                  onChange={(v) => updateField('assigned_commercial_id', v)}
                  options={[
                    { value: '', label: '— Non assigné —' },
                    ...commercials.map(c => ({ value: c.id, label: c.full_name })),
                  ]}
                  disabled={isCancelled}
                />
              </div>

              {/* ---- Section : Notes ---- */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-500" />
                  Notes
                </h3>
                <div className="space-y-4">
                  <FormField label="Description / Instructions">
                    <TextArea
                      value={formData.description}
                      onChange={(v) => updateField('description', v)}
                      placeholder="Description du rendez-vous, instructions pour le technicien..."
                      rows={3}
                      disabled={isCancelled}
                    />
                  </FormField>
                  <FormField label="Notes internes">
                    <TextArea
                      value={formData.internal_notes}
                      onChange={(v) => updateField('internal_notes', v)}
                      placeholder="Notes internes (non visibles par le client)..."
                      rows={2}
                      disabled={isCancelled}
                    />
                  </FormField>
                </div>
              </div>
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

// ============================================================================
// EXPORTS
// ============================================================================

export default EventModal;
