/**
 * ClientDetail.jsx - Majord'home Artisan
 * ============================================================================
 * Page fiche client détaillée accessible via /clients/:id
 * Onglets : Informations | Équipements | Interventions | Timeline
 *
 * @version 1.0.0 - Sprint 1 CRM
 * ============================================================================
 */

import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  User,
  MapPin,
  Phone,
  Mail,
  Home,
  FileText,
  Wrench,
  History,
  Save,
  Loader2,
  AlertCircle,
  Calendar,
  Building2,
  ExternalLink,
  Lock,
  Unlock,
  MessageSquarePlus,
  Pin,
  Clock,
  ChevronRight,
  Zap,
  Settings,
  Tag,
  Archive,
  ArchiveRestore,
  Plus,
  X,
  CalendarCheck,
  CalendarX2,
  ClipboardList,
  Flame,
  Wind,
  Thermometer,
  Fan,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient, useClientEquipments, useClientActivities, clientKeys, usePricingEquipmentTypes } from '@/shared/hooks/useClients';
import {
  CLIENT_CATEGORIES,
  LEAD_SOURCES,
  HOUSING_TYPES,
  EQUIPMENT_TYPES,
} from '@/shared/services/clients.service';
import { CONTRACT_STATUSES, CONTRACT_FREQUENCIES, MAINTENANCE_MONTHS } from '@/shared/services/contracts.service';
import { contractsService } from '@/shared/services/contracts.service';
import { useClientContract, useContractEquipments, useContractVisits, useContractMutations } from '@/shared/hooks/useContracts';
import { useProjectInterventions, useCreateIntervention } from '@/shared/hooks/useInterventions';
import { INTERVENTION_TYPES } from '@/shared/services/interventions.service';
import { EquipmentList } from '@/apps/artisan/components/clients/EquipmentList';
import { EquipmentFormModal } from '@/apps/artisan/components/clients/EquipmentFormModal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDateForInput, formatDateFR, formatDateTimeFR, formatPhoneNumber } from '@/lib/utils';

// ============================================================================
// SOUS-COMPOSANTS FORMULAIRE
// ============================================================================

const FormField = ({ label, children, required = false }) => (
  <div className="space-y-1">
    <label className="block text-sm font-medium text-secondary-700">
      {label}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
    {children}
  </div>
);

const TextInput = ({ value, onChange, placeholder, type = 'text', disabled = false, ...props }) => (
  <input
    type={type}
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    disabled={disabled}
    className={`w-full px-3 py-2 border rounded-lg text-sm outline-none transition-colors ${
      disabled
        ? 'bg-secondary-50 border-secondary-200 text-secondary-600 cursor-not-allowed'
        : 'bg-white border-secondary-300 text-secondary-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
    }`}
    {...props}
  />
);

const PhoneInput = ({ value, onChange, placeholder = '06 12 34 56 78', disabled = false }) => (
  <input
    type="tel"
    value={value || ''}
    onChange={(e) => onChange(formatPhoneNumber(e.target.value))}
    placeholder={placeholder}
    disabled={disabled}
    maxLength={14}
    className={`w-full px-3 py-2 border rounded-lg text-sm outline-none transition-colors ${
      disabled
        ? 'bg-secondary-50 border-secondary-200 text-secondary-600 cursor-not-allowed'
        : 'bg-white border-secondary-300 text-secondary-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
    }`}
  />
);

const SelectInput = ({ value, onChange, options, placeholder, disabled = false }) => (
  <select
    value={value || ''}
    onChange={(e) => onChange(e.target.value || null)}
    disabled={disabled}
    className={`w-full px-3 py-2 border rounded-lg text-sm outline-none transition-colors ${
      disabled
        ? 'bg-secondary-50 border-secondary-200 text-secondary-600 cursor-not-allowed'
        : 'bg-white border-secondary-300 text-secondary-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
    }`}
  >
    {placeholder && <option value="">{placeholder}</option>}
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
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
    className={`w-full px-3 py-2 border rounded-lg text-sm outline-none transition-colors resize-none ${
      disabled
        ? 'bg-secondary-50 border-secondary-200 text-secondary-600 cursor-not-allowed'
        : 'bg-white border-secondary-300 text-secondary-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
    }`}
  />
);

// ============================================================================
// TYPE BADGE
// ============================================================================

const ClientCategoryBadge = ({ clientCategory }) => {
  const found = CLIENT_CATEGORIES.find((t) => t.value === clientCategory);
  if (!found) return null;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${found.color}`}>
      {found.label}
    </span>
  );
};

// ============================================================================
// ONGLET INFORMATIONS
// ============================================================================

const TabInfo = ({ formData, setFormData, isLocked }) => {
  const u = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-8">
      {/* Identité */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-secondary-500" />
          Identité
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Nom" required>
            <TextInput value={formData.lastName} onChange={(v) => u('lastName', v.toUpperCase())} placeholder="DUPONT" disabled={isLocked} />
          </FormField>
          <FormField label="Prénom">
            <TextInput value={formData.firstName} onChange={(v) => u('firstName', v.toUpperCase())} placeholder="JEAN" disabled={isLocked} />
          </FormField>
          <FormField label="Catégorie">
            <SelectInput value={formData.clientCategory} onChange={(v) => u('clientCategory', v)} options={CLIENT_CATEGORIES} placeholder="Sélectionner..." disabled={isLocked} />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <FormField label="Société">
            <TextInput value={formData.companyName} onChange={(v) => u('companyName', v)} placeholder="Entreprise (optionnel)" disabled={isLocked} />
          </FormField>
          <FormField label="Source">
            <SelectInput value={formData.leadSource} onChange={(v) => u('leadSource', v)} options={LEAD_SOURCES} placeholder="Sélectionner..." disabled={isLocked} />
          </FormField>
        </div>
      </section>

      {/* Contact */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <Phone className="w-4 h-4 text-secondary-500" />
          Contact
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Téléphone">
            <PhoneInput value={formData.phone} onChange={(v) => u('phone', v)} disabled={isLocked} />
          </FormField>
          <FormField label="Téléphone secondaire">
            <PhoneInput value={formData.phoneSecondary} onChange={(v) => u('phoneSecondary', v)} placeholder="Fixe, bureau..." disabled={isLocked} />
          </FormField>
          <FormField label="Email">
            <TextInput value={formData.email} onChange={(v) => u('email', v)} placeholder="client@email.com" type="email" disabled={isLocked} />
          </FormField>
        </div>
      </section>

      {/* Adresse */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-secondary-500" />
          Adresse
        </h3>
        <div className="space-y-4">
          <FormField label="Adresse">
            <TextInput value={formData.address} onChange={(v) => u('address', v)} placeholder="12 rue des Lilas" disabled={isLocked} />
          </FormField>
          <FormField label="Complément">
            <TextInput value={formData.addressComplement} onChange={(v) => u('addressComplement', v)} placeholder="Bâtiment, étage..." disabled={isLocked} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Code postal">
              <TextInput value={formData.postalCode} onChange={(v) => u('postalCode', v)} placeholder="40100" disabled={isLocked} />
            </FormField>
            <FormField label="Ville">
              <TextInput value={formData.city} onChange={(v) => u('city', v)} placeholder="Dax" disabled={isLocked} />
            </FormField>
          </div>
          <FormField label="Instructions d'accès">
            <TextInput value={formData.accessInstructions} onChange={(v) => u('accessInstructions', v)} placeholder="Digicode, portail, code clé..." disabled={isLocked} />
          </FormField>
        </div>
      </section>

      {/* Logement */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <Home className="w-4 h-4 text-secondary-500" />
          Logement
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Type">
            <SelectInput value={formData.housingType} onChange={(v) => u('housingType', v)} options={HOUSING_TYPES} placeholder="Sélectionner..." disabled={isLocked} />
          </FormField>
          <FormField label="Surface (m²)">
            <TextInput value={formData.surface} onChange={(v) => u('surface', v)} placeholder="120" type="number" disabled={isLocked} />
          </FormField>
          <FormField label="N° DPE ADEME">
            <div className="flex gap-2">
              <TextInput value={formData.dpeNumber} onChange={(v) => u('dpeNumber', v)} placeholder="2341E0000000X" disabled={isLocked} />
              {formData.dpeNumber && (
                <a
                  href={`https://observatoire-dpe.ademe.fr/trouver-dpe#${formData.dpeNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 p-2 text-primary-600 hover:bg-primary-50 rounded-lg"
                  title="Voir sur ADEME"
                >
                  <ExternalLink className="w-5 h-5" />
                </a>
              )}
            </div>
          </FormField>
        </div>
      </section>

      {/* Notes */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-secondary-500" />
          Notes
        </h3>
        <TextArea value={formData.notes} onChange={(v) => u('notes', v)} placeholder="Notes visibles par toute l'équipe..." rows={3} disabled={isLocked} />
        <div className="mt-4">
          <FormField label="Notes internes">
            <TextArea value={formData.internalNotes} onChange={(v) => u('internalNotes', v)} placeholder="Notes internes (non visibles par le client)" rows={2} disabled={isLocked} />
          </FormField>
        </div>
      </section>
    </div>
  );
};

// ============================================================================
// ONGLET ÉQUIPEMENTS
// ============================================================================

const TabEquipments = ({ clientId }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState(null);
  const [deletingEquipment, setDeletingEquipment] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const {
    equipments, isLoading,
    addEquipment, isAdding,
    updateEquipment, isUpdating,
    deleteEquipment,
  } = useClientEquipments(clientId);
  const { contract } = useClientContract(clientId);
  // Charger les équipements réellement liés au contrat (table pivot)
  const { equipments: contractEquipments } = useContractEquipments(contract?.id);
  const queryClient = useQueryClient();

  // Le contrat existe (peu importe le statut)
  const hasContract = !!contract?.id;
  // Set des IDs d'équipements liés au contrat (source de vérité = table pivot)
  const contractEquipmentIds = useMemo(() => {
    return new Set((contractEquipments || []).map(e => e.id));
  }, [contractEquipments]);

  // Invalidation helper
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
    queryClient.invalidateQueries({ queryKey: ['client-equipments', clientId] });
    if (contract?.id) {
      queryClient.invalidateQueries({ queryKey: ['contract-equipments', contract.id] });
    }
  };

  // Ouvrir le modal en mode ajout
  const handleOpenAdd = () => {
    setEditingEquipment(null);
    setShowModal(true);
  };

  // Ouvrir le modal en mode édition
  const handleOpenEdit = (equipment) => {
    setEditingEquipment(equipment);
    setShowModal(true);
  };

  // Fermer le modal
  const handleCloseModal = () => {
    setShowModal(false);
    setEditingEquipment(null);
  };

  const handleAdd = async (formData) => {
    try {
      const result = await addEquipment({
        category: formData.category,
        equipmentTypeId: formData.equipmentTypeId,
        brand: formData.brand,
        model: formData.model,
        serialNumber: formData.serialNumber,
        installationYear: formData.installationYear,
        notes: formData.notes,
      });

      // Auto-lier au contrat s'il existe
      const equipmentId = result?.data?.id || result?.id;
      if (hasContract && equipmentId) {
        try {
          await contractsService.addEquipmentToContract(contract.id, equipmentId);
          invalidateAll();
          toast.success('Équipement ajouté et lié au contrat');
        } catch (linkError) {
          console.error('[TabEquipments] Erreur liaison contrat:', linkError);
          toast.success('Équipement ajouté (liaison contrat échouée)');
        }
      } else {
        toast.success('Équipement ajouté');
      }

      handleCloseModal();
    } catch (error) {
      console.error('[TabEquipments] Erreur ajout équipement:', error);
      toast.error('Erreur lors de l\'ajout de l\'équipement');
    }
  };

  const handleEdit = async (formData) => {
    try {
      await updateEquipment(editingEquipment.id, {
        category: formData.category,
        equipmentTypeId: formData.equipmentTypeId,
        brand: formData.brand,
        model: formData.model,
        serialNumber: formData.serialNumber,
        installationYear: formData.installationYear,
        notes: formData.notes,
      });
      toast.success('Équipement mis à jour');
      invalidateAll();
      handleCloseModal();
    } catch (error) {
      console.error('[TabEquipments] Erreur modification équipement:', error);
      toast.error('Erreur lors de la modification');
    }
  };

  // Ouvrir la confirmation de suppression
  const handleDelete = (equipment) => {
    setDeletingEquipment(equipment);
  };

  // Confirmer la suppression
  const confirmDelete = async () => {
    if (!deletingEquipment) return;
    setIsDeleting(true);
    try {
      await deleteEquipment(deletingEquipment.id);
      invalidateAll();
      toast.success('Équipement supprimé');
      setDeletingEquipment(null);
    } catch (error) {
      console.error('[TabEquipments] Erreur suppression:', error);
      toast.error('Erreur lors de la suppression');
    } finally {
      setIsDeleting(false);
    }
  };

  // Lier un équipement au contrat
  const handleAddToContract = async (equipment) => {
    if (!hasContract) return;
    try {
      await contractsService.addEquipmentToContract(contract.id, equipment.id);
      invalidateAll();
      toast.success('Équipement ajouté au contrat');
    } catch (error) {
      console.error('[TabEquipments] Erreur liaison contrat:', error);
      toast.error('Erreur lors de la liaison au contrat');
    }
  };

  // Retirer un équipement du contrat
  const handleRemoveFromContract = async (equipment) => {
    if (!hasContract) return;
    try {
      await contractsService.removeEquipmentFromContract(contract.id, equipment.id);
      invalidateAll();
      toast.success('Équipement retiré du contrat');
    } catch (error) {
      console.error('[TabEquipments] Erreur retrait contrat:', error);
      toast.error('Erreur lors du retrait du contrat');
    }
  };

  return (
    <>
      <EquipmentList
        equipments={equipments}
        loading={isLoading}
        onAdd={handleOpenAdd}
        onEdit={handleOpenEdit}
        onDelete={handleDelete}
        onAddToContract={hasContract ? handleAddToContract : undefined}
        onRemoveFromContract={hasContract ? handleRemoveFromContract : undefined}
        hasContract={hasContract}
        contractEquipmentIds={contractEquipmentIds}
      />
      <EquipmentFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSubmit={editingEquipment ? handleEdit : handleAdd}
        isSubmitting={editingEquipment ? isUpdating : isAdding}
        equipment={editingEquipment}
      />
      <ConfirmDialog
        open={!!deletingEquipment}
        onOpenChange={(open) => { if (!open) setDeletingEquipment(null); }}
        title="Supprimer l'équipement"
        description={
          deletingEquipment
            ? `Voulez-vous vraiment supprimer l'équipement "${[deletingEquipment.brand, deletingEquipment.model].filter(Boolean).join(' ')}" ? Cette action est irréversible.`
            : ''
        }
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={isDeleting}
      />
    </>
  );
};

// ============================================================================
// ONGLET INTERVENTIONS
// ============================================================================

const InterventionCard = ({ intervention }) => {
  const typeConfig = INTERVENTION_TYPES.find(t => t.value === intervention.intervention_type) || INTERVENTION_TYPES[INTERVENTION_TYPES.length - 1];

  const statusConfig = {
    completed: { label: 'Terminé', className: 'bg-green-100 text-green-700' },
    scheduled: { label: 'Planifié', className: 'bg-blue-100 text-blue-700' },
    cancelled: { label: 'Annulé', className: 'bg-secondary-100 text-secondary-700' },
    in_progress: { label: 'En cours', className: 'bg-amber-100 text-amber-700' },
    on_hold: { label: 'En attente', className: 'bg-orange-100 text-orange-700' },
    no_show: { label: 'Absent', className: 'bg-red-100 text-red-700' },
  };

  const statusInfo = statusConfig[intervention.status] || statusConfig.scheduled;

  return (
    <div className="p-4 bg-white rounded-lg border border-secondary-200 hover:border-secondary-300 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full ${typeConfig.bgClass}`}>{typeConfig.label}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo.className}`}>{statusInfo.label}</span>
          </div>
          <p className="text-sm text-secondary-500 mt-1">
            {formatDateFR(intervention.scheduled_date)}
            {intervention.technician_name && ` • ${intervention.technician_name}`}
          </p>
        </div>
        {intervention.duration_minutes && <span className="text-xs text-secondary-500">{intervention.duration_minutes} min</span>}
      </div>
      {intervention.work_performed && <p className="text-sm text-secondary-600 mt-2 line-clamp-2">{intervention.work_performed}</p>}
      {intervention.report_notes && <p className="text-sm text-secondary-500 mt-1 line-clamp-2 italic">{intervention.report_notes}</p>}
    </div>
  );
};

const TabInterventions = ({ projectId, clientId }) => {
  const { user } = useAuth();
  const { interventions, isLoading } = useProjectInterventions(projectId);
  const { createIntervention, isCreating } = useCreateIntervention();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    interventionType: 'maintenance',
    scheduledDate: new Date().toISOString().split('T')[0],
    reportNotes: '',
  });

  const handleCreate = async () => {
    if (!formData.scheduledDate) {
      toast.error('La date est requise');
      return;
    }
    try {
      const result = await createIntervention({
        projectId,
        interventionType: formData.interventionType,
        scheduledDate: formData.scheduledDate,
        reportNotes: formData.reportNotes || null,
        createdBy: user?.id || null,
      });
      if (result?.error) {
        console.error('[TabInterventions] create error:', result.error);
        toast.error(result.error.message || "Erreur lors de la création");
        return;
      }
      toast.success('Intervention créée');
      setShowForm(false);
      setFormData({ interventionType: 'maintenance', scheduledDate: new Date().toISOString().split('T')[0], reportNotes: '' });
    } catch (err) {
      console.error('[TabInterventions] create exception:', err);
      toast.error("Erreur lors de la création");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header avec bouton ajouter */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-secondary-500">
          {interventions.length > 0
            ? `${interventions.length} intervention${interventions.length !== 1 ? 's' : ''}`
            : ''}
        </p>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouvelle intervention
          </button>
        )}
      </div>

      {/* Formulaire de création */}
      {showForm && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          <h4 className="text-sm font-semibold text-secondary-900 flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary-600" />
            Nouvelle intervention
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Type" required>
              <SelectInput
                value={formData.interventionType}
                onChange={(v) => setFormData(prev => ({ ...prev, interventionType: v || 'maintenance' }))}
                options={INTERVENTION_TYPES.map(t => ({ value: t.value, label: t.label }))}
              />
            </FormField>
            <FormField label="Date" required>
              <TextInput
                type="date"
                value={formData.scheduledDate}
                onChange={(v) => setFormData(prev => ({ ...prev, scheduledDate: v }))}
              />
            </FormField>
          </div>
          <FormField label="Motif / Notes">
            <TextArea
              value={formData.reportNotes}
              onChange={(v) => setFormData(prev => ({ ...prev, reportNotes: v }))}
              placeholder="Motif de l'intervention..."
              rows={2}
            />
          </FormField>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Créer
            </button>
            <button
              onClick={() => setShowForm(false)}
              disabled={isCreating}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-secondary-700 bg-white border border-secondary-300 rounded-lg hover:bg-secondary-50 transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Liste des interventions */}
      {interventions.length === 0 && !showForm ? (
        <div className="text-center py-12">
          <Wrench className="w-12 h-12 text-secondary-300 mx-auto" />
          <p className="mt-4 text-secondary-700 font-medium">Aucune intervention</p>
          <p className="mt-1 text-sm text-secondary-500">Cliquez sur "Nouvelle intervention" pour en créer une.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {interventions.map((i) => (
            <InterventionCard key={i.id} intervention={i} />
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ONGLET TIMELINE
// ============================================================================

const ACTIVITY_ICONS = {
  note: MessageSquarePlus,
  comment: MessageSquarePlus,
  phone_call: Phone,
  email_sent: Mail,
  email_received: Mail,
  document_added: FileText,
  client_created: User,
  client_updated: Settings,
  status_changed: Tag,
  appointment_created: Calendar,
  appointment_completed: Calendar,
  intervention_scheduled: Wrench,
  intervention_completed: Wrench,
  equipment_added: Zap,
  equipment_updated: Zap,
  contract_created: FileText,
  contract_renewed: FileText,
  lead_converted: ChevronRight,
};

const ACTIVITY_COLORS = {
  note: 'bg-blue-100 text-blue-600',
  comment: 'bg-blue-100 text-blue-600',
  phone_call: 'bg-green-100 text-green-600',
  email_sent: 'bg-purple-100 text-purple-600',
  email_received: 'bg-purple-100 text-purple-600',
  client_created: 'bg-secondary-100 text-secondary-600',
  intervention_completed: 'bg-green-100 text-green-600',
  equipment_added: 'bg-amber-100 text-amber-600',
};

const ActivityItem = ({ activity }) => {
  const Icon = ACTIVITY_ICONS[activity.activity_type] || Clock;
  const colorClass = ACTIVITY_COLORS[activity.activity_type] || 'bg-secondary-100 text-secondary-600';

  return (
    <div className="flex gap-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${colorClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-secondary-900">{activity.title}</span>
          {activity.is_pinned && <Pin className="w-3 h-3 text-amber-500" />}
          {activity.is_system && <span className="text-xs text-secondary-400">auto</span>}
        </div>
        {activity.description && <p className="text-sm text-secondary-600 mt-0.5 line-clamp-2">{activity.description}</p>}
        <p className="text-xs text-secondary-400 mt-1">{formatDateTimeFR(activity.created_at)}</p>
      </div>
    </div>
  );
};

const TabTimeline = ({ clientId, orgId, userId }) => {
  const { activities, isLoading, addNote, isAddingNote } = useClientActivities(clientId);
  const [showForm, setShowForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDescription, setNoteDescription] = useState('');

  const handleAddNote = async () => {
    if (!noteTitle.trim()) return;
    try {
      await addNote({
        orgId,
        title: noteTitle.trim(),
        description: noteDescription.trim() || null,
        activityType: 'note',
        createdBy: userId,
      });
      setNoteTitle('');
      setNoteDescription('');
      setShowForm(false);
      toast.success('Note ajoutée');
    } catch {
      toast.error("Erreur lors de l'ajout de la note");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bouton ajouter note */}
      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
          <MessageSquarePlus className="w-4 h-4" />
          Ajouter une note
        </button>
      ) : (
        <div className="p-4 bg-primary-50 border border-primary-200 rounded-lg space-y-3">
          <input
            type="text"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            placeholder="Titre de la note..."
            className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            autoFocus
          />
          <textarea
            value={noteDescription}
            onChange={(e) => setNoteDescription(e.target.value)}
            placeholder="Détails (optionnel)..."
            rows={2}
            className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddNote}
              disabled={!noteTitle.trim() || isAddingNote}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {isAddingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Ajouter
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setNoteTitle('');
                setNoteDescription('');
              }}
              className="px-3 py-1.5 text-sm text-secondary-600 hover:bg-secondary-100 rounded-lg transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Liste des activités */}
      {activities.length === 0 ? (
        <div className="text-center py-12">
          <History className="w-12 h-12 text-secondary-300 mx-auto" />
          <p className="mt-4 text-secondary-700 font-medium">Aucune activité</p>
          <p className="mt-1 text-sm text-secondary-500">L'historique des actions apparaîtra ici.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ONGLET CONTRAT
// ============================================================================

const ContractStatusBadge = ({ status }) => {
  const found = CONTRACT_STATUSES.find((s) => s.value === status);
  if (!found) return null;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border ${found.color}`}>
      {found.label}
    </span>
  );
};

// ============================================================================
// SOUS-COMPOSANTS CONTRAT : ÉQUIPEMENTS & VISITES
// ============================================================================

const getEquipmentIcon = (type) => {
  const icons = {
    chaudiere_gaz: Flame, chaudiere_fioul: Flame, chaudiere_bois: Flame,
    pac_air_air: Wind, pac_air_eau: Wind, climatisation: Fan,
    vmc: Fan, chauffe_eau_thermo: Thermometer, ballon_ecs: Thermometer,
    poele: Flame,
  };
  return icons[type] || Wrench;
};

const ContractEquipmentsSection = ({ contractId }) => {
  const { equipments, isLoading } = useContractEquipments(contractId);
  const { equipmentTypes } = usePricingEquipmentTypes();

  // Map pricing types pour lookup label
  const pricingTypesMap = useMemo(() => {
    const map = {};
    for (const t of equipmentTypes) map[t.id] = t;
    return map;
  }, [equipmentTypes]);

  // Résoudre le label d'un équipement (pricing type en priorité, sinon ENUM)
  const getLabel = (eq) => {
    if (eq.equipment_type_id && pricingTypesMap[eq.equipment_type_id]) {
      return pricingTypesMap[eq.equipment_type_id].label;
    }
    const type = eq.equipment_type || eq.category;
    return EQUIPMENT_TYPES?.find((t) => t.value === type)?.label || type || 'Équipement';
  };

  return (
    <div className="pt-6 border-t border-secondary-200">
      <h4 className="text-sm font-semibold text-secondary-900 mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-secondary-500" />
        Équipements sous contrat
      </h4>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
        </div>
      ) : equipments.length === 0 ? (
        <p className="text-sm text-secondary-500 italic py-2">
          Aucun équipement lié à ce contrat. Associez des équipements depuis l'onglet Équipements.
        </p>
      ) : (
        <div className="space-y-2">
          {equipments.map((eq) => {
            const Icon = getEquipmentIcon(eq.equipment_type || eq.category);
            const typeLabel = getLabel(eq);
            // Construire la description : Marque - Modèle - N° Série
            const details = [eq.brand, eq.model, eq.serial_number].filter(v => v && v !== 'À renseigner');
            return (
              <div key={eq.id} className="flex items-center gap-3 px-3 py-2.5 bg-secondary-50 rounded-lg">
                <Icon className="w-4 h-4 text-secondary-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-secondary-900">{typeLabel}</span>
                  {details.length > 0 && (
                    <span className="text-sm text-secondary-500 ml-2">
                      — {details.join(' · ')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const ContractVisitsSection = ({ contract, orgId, userId }) => {
  const queryClient = useQueryClient();
  const { visits, isLoading, refresh: refreshVisits } = useContractVisits(contract.id);
  const { recordVisit, isRecordingVisit } = useContractMutations();
  const [editingYear, setEditingYear] = useState(null);
  const [visitForm, setVisitForm] = useState({ date: '', notes: '', status: 'completed' });

  // Générer la liste des années depuis start_date jusqu'à maintenant
  const currentYear = new Date().getFullYear();
  const startYear = contract.start_date
    ? new Date(contract.start_date).getFullYear()
    : currentYear;
  const years = [];
  for (let y = currentYear; y >= startYear; y--) {
    years.push(y);
  }

  // Indexer les visites par année
  const visitsByYear = {};
  (visits || []).forEach((v) => {
    visitsByYear[v.visit_year] = v;
  });

  const handleRecordVisit = async (year) => {
    const isRefusal = visitForm.status === 'cancelled';
    if (!isRefusal && !visitForm.date) {
      toast.error('La date de passage est requise');
      return;
    }
    try {
      const result = await recordVisit({
        contractId: contract.id,
        orgId,
        year,
        visitDate: isRefusal ? null : visitForm.date,
        status: visitForm.status || 'completed',
        notes: visitForm.notes || null,
        userId,
      });
      if (result?.error) {
        console.error('[ContractVisits] recordVisit error:', result.error);
        toast.error(result.error.message || "Erreur lors de l'enregistrement");
        return;
      }
      toast.success(`Visite ${year} enregistrée`);
      setEditingYear(null);
      setVisitForm({ date: '', notes: '', status: 'completed' });
      refreshVisits();
      // Rafraîchir la fiche client (MàJ date via trigger DB)
      if (contract.client_id) {
        queryClient.invalidateQueries({ queryKey: clientKeys.detail(contract.client_id) });
      }
    } catch (err) {
      console.error('[ContractVisits] recordVisit exception:', err);
      toast.error("Erreur lors de l'enregistrement");
    }
  };

  const openForm = (year) => {
    const existing = visitsByYear[year];
    setVisitForm({
      date: existing?.visit_date || new Date().toISOString().split('T')[0],
      notes: existing?.notes || '',
      status: existing?.status || 'completed',
    });
    setEditingYear(year);
  };

  return (
    <div className="pt-6 border-t border-secondary-200">
      <h4 className="text-sm font-semibold text-secondary-900 mb-3 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-secondary-500" />
        Visites d'entretien
      </h4>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
        </div>
      ) : years.length === 0 ? (
        <p className="text-sm text-secondary-500 italic py-2">
          Renseignez la date de début du contrat pour voir l'historique des visites.
        </p>
      ) : (
        <div className="space-y-1">
          {years.map((year) => {
            const visit = visitsByYear[year];
            const isCompleted = visit?.status === 'completed';
            const isRefused = visit?.status === 'cancelled';
            const isEditingThis = editingYear === year;

            return (
              <div key={year}>
                <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isCompleted ? 'bg-green-50' : isRefused ? 'bg-red-50' : 'bg-secondary-50'
                }`}>
                  {/* Année */}
                  <span className="text-sm font-semibold text-secondary-900 w-12">{year}</span>

                  {/* Statut */}
                  {isCompleted ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <span className="text-sm text-green-700">
                        Réalisé le {formatDateFR(visit.visit_date)}
                      </span>
                      {visit.technician_name && (
                        <span className="text-xs text-green-600">• {visit.technician_name}</span>
                      )}
                      {visit.notes && (
                        <span className="text-xs text-secondary-500 truncate" title={visit.notes}>
                          — {visit.notes}
                        </span>
                      )}
                    </div>
                  ) : isRefused ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                      <span className="text-sm text-red-700">Refusé par le client</span>
                      {visit.notes && (
                        <span className="text-xs text-red-600 truncate" title={visit.notes}>
                          — {visit.notes}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <CalendarX2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      <span className="text-sm text-amber-700">
                        {year < currentYear ? 'Non réalisé' : 'En attente'}
                      </span>
                    </div>
                  )}

                  {/* Bouton action */}
                  {!isEditingThis && (
                    <button
                      onClick={() => openForm(year)}
                      className="flex-shrink-0 text-xs px-2.5 py-1 text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                    >
                      {isCompleted || isRefused ? 'Modifier' : 'Enregistrer'}
                    </button>
                  )}
                </div>

                {/* Formulaire inline */}
                {isEditingThis && (
                  <div className="ml-12 mt-1 p-3 bg-primary-50 border border-primary-200 rounded-lg space-y-3">
                    {/* Choix du statut */}
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`visit-status-${year}`}
                          checked={visitForm.status === 'completed'}
                          onChange={() => setVisitForm((p) => ({ ...p, status: 'completed' }))}
                          className="w-4 h-4 text-green-600 border-secondary-300 focus:ring-green-500"
                        />
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span className="text-sm text-secondary-700">Passage réalisé</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`visit-status-${year}`}
                          checked={visitForm.status === 'cancelled'}
                          onChange={() => setVisitForm((p) => ({ ...p, status: 'cancelled' }))}
                          className="w-4 h-4 text-red-600 border-secondary-300 focus:ring-red-500"
                        />
                        <XCircle className="w-4 h-4 text-red-500" />
                        <span className="text-sm text-secondary-700">Proposé mais refusé par le client</span>
                      </label>
                    </div>
                    {visitForm.status === 'cancelled' ? (
                      <div>
                        <FormField label="Motif du refus">
                          <TextInput
                            value={visitForm.notes}
                            onChange={(v) => setVisitForm((p) => ({ ...p, notes: v }))}
                            placeholder="Ex: Client absent, ne souhaite pas l'entretien cette année..."
                          />
                        </FormField>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField label="Date de passage" required>
                          <TextInput
                            value={visitForm.date}
                            onChange={(v) => setVisitForm((p) => ({ ...p, date: v }))}
                            type="date"
                          />
                        </FormField>
                        <FormField label="Note (optionnel)">
                          <TextInput
                            value={visitForm.notes}
                            onChange={(v) => setVisitForm((p) => ({ ...p, notes: v }))}
                            placeholder="Ex: RAS, remplacement filtre..."
                          />
                        </FormField>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRecordVisit(year)}
                        disabled={isRecordingVisit}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                      >
                        {isRecordingVisit ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
                        Valider
                      </button>
                      <button
                        onClick={() => { setEditingYear(null); setVisitForm({ date: '', notes: '', status: 'completed' }); }}
                        className="px-3 py-1.5 text-sm text-secondary-600 hover:bg-secondary-100 rounded-lg transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const TabContrat = ({ clientId, orgId, userId }) => {
  const {
    contract,
    isLoading,
    createContract,
    isCreating,
    updateContract,
    isUpdating,
    deleteContract,
    isDeleting,
  } = useClientContract(clientId);

  const [isEditing, setIsEditing] = useState(false);
  const [contractForm, setContractForm] = useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Initialiser le formulaire quand le contrat est chargé
  const initForm = useCallback((c) => {
    setContractForm({
      status: c?.status || 'active',
      frequency: c?.frequency || 'annuel',
      startDate: c?.start_date || '',
      endDate: c?.end_date || '',
      maintenanceMonth: c?.maintenance_month || '',
      amount: c?.amount || '',
      estimatedTime: c?.estimated_time || '',
      notes: c?.notes || '',
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  // Pas de contrat → proposer d'en créer un
  if (!contract) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 text-secondary-300 mx-auto" />
        <p className="mt-4 text-secondary-700 font-medium">Aucun contrat d'entretien</p>
        <p className="mt-1 text-sm text-secondary-500">Ce client n'a pas encore de contrat.</p>
        <button
          onClick={async () => {
            const result = await createContract({
              orgId,
              status: 'active',
              frequency: 'annuel',
            });
            if (result?.error) {
              toast.error('Erreur lors de la création du contrat');
            } else {
              toast.success('Contrat créé');
            }
          }}
          disabled={isCreating}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Créer un contrat
        </button>
      </div>
    );
  }

  // Contrat existant
  const handleSaveContract = async () => {
    const result = await updateContract(contract.id, {
      status: contractForm.status,
      frequency: contractForm.frequency,
      startDate: contractForm.startDate || null,
      endDate: contractForm.endDate || null,
      maintenanceMonth: contractForm.maintenanceMonth || null,
      amount: contractForm.amount || null,
      estimatedTime: contractForm.estimatedTime || null,
      notes: contractForm.notes || null,
    });
    if (result?.error) {
      toast.error('Erreur lors de la mise à jour');
    } else {
      toast.success('Contrat mis à jour');
      setIsEditing(false);
    }
  };

  const handleDeleteContract = async () => {
    const result = await deleteContract(contract.id);
    if (result?.error) {
      toast.error('Erreur lors de la suppression');
    } else {
      toast.success('Contrat supprimé');
    }
    setShowDeleteConfirm(false);
  };

  return (
    <div className="space-y-6">
      {/* Header contrat */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ContractStatusBadge status={contract.status} />
          {contract.contract_number && (
            <span className="text-sm font-mono text-secondary-500">{contract.contract_number}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <button
              onClick={() => { initForm(contract); setIsEditing(true); }}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
            >
              <Settings className="w-4 h-4" />
              Modifier
            </button>
          ) : (
            <>
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-sm text-secondary-600 hover:bg-secondary-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveContract}
                disabled={isUpdating}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Enregistrer
              </button>
            </>
          )}
        </div>
      </div>

      {/* Détails contrat */}
      {isEditing ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Statut">
            <SelectInput value={contractForm.status} onChange={(v) => setContractForm((p) => ({ ...p, status: v }))} options={CONTRACT_STATUSES} />
          </FormField>
          <FormField label="Montant (€)">
            <TextInput value={contractForm.amount} onChange={(v) => setContractForm((p) => ({ ...p, amount: v }))} placeholder="0.00" type="number" />
          </FormField>
          <FormField label="Date début">
            <TextInput value={formatDateForInput(contractForm.startDate)} onChange={(v) => setContractForm((p) => ({ ...p, startDate: v }))} type="date" />
          </FormField>
          <FormField label="Date fin">
            <TextInput value={formatDateForInput(contractForm.endDate)} onChange={(v) => setContractForm((p) => ({ ...p, endDate: v }))} type="date" />
          </FormField>
          <FormField label="Mois d'entretien">
            <select
              value={contractForm.maintenanceMonth || ''}
              onChange={(e) => setContractForm((p) => ({ ...p, maintenanceMonth: e.target.value ? parseInt(e.target.value) : '' }))}
              className="w-full rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">Non défini</option>
              {MAINTENANCE_MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Tps estimé (heures)">
            <TextInput value={contractForm.estimatedTime} onChange={(v) => setContractForm((p) => ({ ...p, estimatedTime: v }))} placeholder="Ex: 1.5" type="number" />
          </FormField>
          <div className="md:col-span-2">
            <FormField label="Notes">
              <TextArea value={contractForm.notes} onChange={(v) => setContractForm((p) => ({ ...p, notes: v }))} placeholder="Notes sur le contrat..." rows={2} />
            </FormField>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Montant</p>
            <p className="mt-1 text-sm text-secondary-900">
              {contract.amount ? `${Number(contract.amount).toFixed(2)} €` : '-'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Mois d'entretien</p>
            <p className="mt-1 text-sm text-secondary-900">
              {contract.maintenance_month ? MAINTENANCE_MONTHS.find((m) => m.value === contract.maintenance_month)?.label : '-'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Tps estimé</p>
            <p className="mt-1 text-sm text-secondary-900">
              {contract.estimated_time ? `${Number(contract.estimated_time)}h` : '-'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Date début</p>
            <p className="mt-1 text-sm text-secondary-900">{formatDateFR(contract.start_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Date fin</p>
            <p className="mt-1 text-sm text-secondary-900">{formatDateFR(contract.end_date)}</p>
          </div>
          {contract.notes && (
            <div className="md:col-span-3">
              <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Notes</p>
              <p className="mt-1 text-sm text-secondary-600">{contract.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Équipements sous contrat */}
      {!isEditing && (
        <ContractEquipmentsSection contractId={contract.id} />
      )}

      {/* Historique des visites */}
      {!isEditing && (
        <ContractVisitsSection
          contract={contract}
          orgId={orgId}
          userId={userId}
        />
      )}

      {/* Supprimer */}
      {!isEditing && (
        <div className="pt-4 border-t border-secondary-200">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Supprimer le contrat
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Supprimer le contrat"
        description="Voulez-vous vraiment supprimer ce contrat ? Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDeleteContract}
        loading={isDeleting}
      />
    </div>
  );
};

// ============================================================================
// CONSTANTES ONGLETS
// ============================================================================

const TABS = [
  { id: 'info', label: 'Informations', icon: User },
  { id: 'contract', label: 'Contrat', icon: FileText },
  { id: 'equipments', label: 'Équipements', icon: Wrench },
  { id: 'interventions', label: 'Interventions', icon: Wrench },
  { id: 'timeline', label: 'Timeline', icon: History },
];

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function ClientDetail() {
  const { id } = useParams();
  const { organization, user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('info');
  const [isLocked, setIsLocked] = useState(true);
  const [formData, setFormData] = useState({});
  const [initialData, setInitialData] = useState({});
  const [hasInitialized, setHasInitialized] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  // Hooks données
  const {
    client, isLoading, error, updateClient, isUpdating,
    archiveClient, isArchiving, unarchiveClient, isUnarchiving, refresh,
  } = useClient(id);

  // Initialiser le formulaire quand le client est chargé
  if (client && !hasInitialized) {
    const data = {
      firstName: (client.first_name || '').toUpperCase(),
      lastName: (client.last_name || '').toUpperCase(),
      clientCategory: client.client_category || 'particulier',
      companyName: client.company_name || '',
      phone: client.phone || '',
      phoneSecondary: client.phone_secondary || '',
      email: client.email || '',
      address: client.address || '',
      addressComplement: client.address_complement || '',
      postalCode: client.postal_code || '',
      city: client.city || '',
      accessInstructions: client.access_instructions || '',
      housingType: client.housing_type || '',
      surface: client.surface || '',
      dpeNumber: client.dpe_number || '',
      leadSource: client.lead_source || '',
      notes: client.notes || '',
      internalNotes: client.internal_notes || '',
    };
    setFormData(data);
    setInitialData(data);
    setHasInitialized(true);
  }

  // Toggle verrou
  const handleToggleLock = useCallback(() => {
    if (!isLocked) {
      // Annuler les modifications
      setFormData({ ...initialData });
    }
    setIsLocked(!isLocked);
  }, [isLocked, initialData]);

  // Sauvegarder
  const handleSave = async () => {
    if (!formData.lastName?.trim()) {
      toast.error('Le nom est requis');
      return;
    }

    const { data, error: err } = await updateClient({
      firstName: formData.firstName,
      lastName: formData.lastName,
      clientCategory: formData.clientCategory,
      companyName: formData.companyName,
      phone: formData.phone,
      phoneSecondary: formData.phoneSecondary,
      email: formData.email,
      address: formData.address,
      addressComplement: formData.addressComplement,
      postalCode: formData.postalCode,
      city: formData.city,
      accessInstructions: formData.accessInstructions,
      housingType: formData.housingType,
      surface: formData.surface,
      dpeNumber: formData.dpeNumber,
      leadSource: formData.leadSource,
      notes: formData.notes,
      internalNotes: formData.internalNotes,
    });

    if (err) {
      toast.error('Erreur lors de la sauvegarde');
      return;
    }

    setInitialData({ ...formData });
    setIsLocked(true);
    toast.success('Client mis à jour');
  };

  // Archiver le client
  const handleArchive = async () => {
    const result = await archiveClient();
    if (result?.success) {
      toast.success('Client archivé');
      setShowArchiveConfirm(false);
      navigate('/clients');
    } else {
      toast.error("Erreur lors de l'archivage");
    }
  };

  // Désarchiver le client
  const handleUnarchive = async () => {
    const result = await unarchiveClient();
    if (result?.success) {
      toast.success('Client désarchivé');
      refresh();
    } else {
      toast.error('Erreur lors de la désarchivage');
    }
  };

  // État de chargement
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto" />
          <p className="mt-3 text-sm text-secondary-500">Chargement du client...</p>
        </div>
      </div>
    );
  }

  // État erreur
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
          <p className="mt-4 text-lg font-medium text-secondary-700">Erreur</p>
          <p className="mt-1 text-sm text-secondary-500">{error?.message || 'Client introuvable'}</p>
          <Link to="/clients" className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg">
            <ArrowLeft className="w-4 h-4" />
            Retour à la liste
          </Link>
        </div>
      </div>
    );
  }

  if (!client) return null;

  const displayName = client.display_name || `${client.last_name || ''} ${client.first_name || ''}`.trim() || 'Client';

  const isArchived = client.is_archived === true;

  return (
    <div className="space-y-6">
      {/* Bannière client archivé */}
      {isArchived && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 text-amber-800">
            <Archive className="w-5 h-5" />
            <span className="text-sm font-medium">
              Ce client est archivé{client.archived_at ? ` depuis le ${formatDateFR(client.archived_at)}` : ''}
            </span>
          </div>
          <button
            onClick={handleUnarchive}
            disabled={isUnarchiving}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {isUnarchiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArchiveRestore className="w-4 h-4" />}
            Désarchiver
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/clients" className="p-2 rounded-lg hover:bg-secondary-100 transition-colors">
            <ArrowLeft className="w-5 h-5 text-secondary-600" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-secondary-900">{displayName}</h1>
              <ClientCategoryBadge clientCategory={client.client_category} />
              {client.has_active_contract && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 border border-green-200">Contrat actif</span>
              )}
            </div>
            <p className="text-secondary-500 mt-0.5">
              {client.client_number && (
                <span className="text-xs font-mono text-secondary-400 mr-2">{client.client_number}</span>
              )}
              {[client.city, client.postal_code].filter(Boolean).join(' ')}
              {client.email && ` • ${client.email}`}
              {client.updated_at && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-secondary-400">
                  <Clock className="w-3 h-3" />
                  MàJ {formatDateFR(client.updated_at)}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Bouton Archiver */}
          {!isArchived && isLocked && (
            <button
              onClick={() => setShowArchiveConfirm(true)}
              className="p-2 rounded-lg text-secondary-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
              title="Archiver ce client"
            >
              <Archive className="w-5 h-5" />
            </button>
          )}

          {/* Cadenas */}
          <button
            onClick={handleToggleLock}
            className={`p-2 rounded-lg transition-colors ${
              isLocked ? 'text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100' : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
            }`}
            title={isLocked ? 'Déverrouiller pour modifier' : 'Annuler les modifications'}
          >
            {isLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
          </button>

          {/* Bouton Enregistrer */}
          {!isLocked && (
            <button
              onClick={handleSave}
              disabled={isUpdating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div className="border-b border-secondary-200">
        <nav className="flex gap-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            let badge = null;

            if (tab.id === 'equipments' && client.equipments_count > 0) {
              badge = client.equipments_count;
            } else if (tab.id === 'interventions' && client.interventions_count > 0) {
              badge = client.interventions_count;
            }

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive ? 'text-primary-600 border-primary-600' : 'text-secondary-500 border-transparent hover:text-secondary-700 hover:border-secondary-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {badge > 0 && <span className="ml-1 px-1.5 py-0.5 text-xs bg-secondary-100 text-secondary-600 rounded-full">{badge}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Contenu des onglets */}
      <div className="bg-white rounded-lg border border-secondary-200 shadow-card p-6">
        {activeTab === 'info' && <TabInfo formData={formData} setFormData={setFormData} isLocked={isLocked} />}
        {activeTab === 'contract' && <TabContrat clientId={id} orgId={organization?.id} userId={user?.id} />}
        {activeTab === 'equipments' && <TabEquipments clientId={id} />}
        {activeTab === 'interventions' && <TabInterventions projectId={client.project_id} clientId={id} />}
        {activeTab === 'timeline' && <TabTimeline clientId={id} orgId={organization?.id} userId={user?.id} />}
      </div>

      {/* Modale confirmation archivage */}
      {showArchiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowArchiveConfirm(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Archive className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold text-secondary-900">Archiver ce client ?</h3>
            </div>
            <p className="text-sm text-secondary-600 mb-6">
              Le client <strong>{displayName}</strong> sera archivé et ne sera plus visible dans la liste principale.
              Vous pourrez le retrouver en activant le filtre "Clients archivés".
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowArchiveConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-secondary-700 bg-secondary-100 hover:bg-secondary-200 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleArchive}
                disabled={isArchiving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isArchiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                Archiver
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
