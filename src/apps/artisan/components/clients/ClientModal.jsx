/**
 * ClientModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale fiche client complète.
 * Onglets : Informations / Équipements / Historique
 * 
 * @example
 * <ClientModal 
 *   clientId={selectedClientId}
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 *   onSaved={() => refreshList()}
 * />
 * ============================================================================
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
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
  CheckCircle,
  Calendar,
  Building2,
  Ruler,
  Leaf,
  ExternalLink,
  Archive
} from 'lucide-react';
import { useClient, useClientEquipments } from '@/shared/hooks/useClients';
import { CLIENT_STATUSES, LEAD_SOURCES, CONTRACT_FREQUENCIES } from '@/shared/services/clients.service';
import { EquipmentList } from './EquipmentList';

// ============================================================================
// CONSTANTES
// ============================================================================

const TABS = [
  { id: 'info', label: 'Informations', icon: User },
  { id: 'equipments', label: 'Équipements', icon: Wrench },
  { id: 'history', label: 'Historique', icon: History },
];

const HOUSING_TYPES = [
  { value: 'house', label: 'Maison' },
  { value: 'apartment', label: 'Appartement' },
  { value: 'commercial', label: 'Local commercial' },
  { value: 'other', label: 'Autre' },
];

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Formate une date pour l'input date
 */
const formatDateForInput = (dateString) => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
};

/**
 * Formate une date en français
 */
const formatDateFR = (dateString) => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
};

/**
 * Formate une date/heure en français
 */
const formatDateTimeFR = (dateString) => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
};

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Champ de formulaire
 */
const FormField = ({ label, children, required = false, error = null }) => (
  <div className="space-y-1">
    <label className="block text-sm font-medium text-gray-700">
      {label}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
    {children}
    {error && (
      <p className="text-sm text-red-600 flex items-center gap-1">
        <AlertCircle className="w-3.5 h-3.5" />
        {error}
      </p>
    )}
  </div>
);

/**
 * Input texte
 */
const TextInput = ({ value, onChange, placeholder, type = 'text', ...props }) => (
  <input
    type={type}
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
    {...props}
  />
);

/**
 * Select
 */
const SelectInput = ({ value, onChange, options, placeholder }) => (
  <select
    value={value || ''}
    onChange={(e) => onChange(e.target.value || null)}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors bg-white"
  >
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
);

/**
 * Textarea
 */
const TextArea = ({ value, onChange, placeholder, rows = 3 }) => (
  <textarea
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors resize-none"
  />
);

/**
 * Badge de statut pipeline
 */
const StatusBadge = ({ status }) => {
  const found = CLIENT_STATUSES.find(s => s.value === status);
  if (!found) return null;
  
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${found.color}`}>
      {found.label}
    </span>
  );
};

/**
 * Carte intervention (historique)
 */
const InterventionCard = ({ intervention }) => {
  const {
    intervention_type,
    intervention_date,
    technician_name,
    description,
    status,
  } = intervention;

  const typeLabels = {
    maintenance: 'Entretien',
    repair: 'Dépannage',
    installation: 'Installation',
    inspection: 'Visite technique',
    other: 'Autre',
  };

  const statusConfig = {
    completed: { label: 'Terminé', className: 'bg-green-100 text-green-700' },
    scheduled: { label: 'Planifié', className: 'bg-blue-100 text-blue-700' },
    cancelled: { label: 'Annulé', className: 'bg-gray-100 text-gray-700' },
    in_progress: { label: 'En cours', className: 'bg-amber-100 text-amber-700' },
  };

  const statusInfo = statusConfig[status] || statusConfig.completed;

  return (
    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">
              {typeLabels[intervention_type] || intervention_type}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo.className}`}>
              {statusInfo.label}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {formatDateFR(intervention_date)}
            {technician_name && ` • ${technician_name}`}
          </p>
        </div>
      </div>
      {description && (
        <p className="text-sm text-gray-600 mt-2 line-clamp-2">{description}</p>
      )}
    </div>
  );
};

// ============================================================================
// ONGLET INFORMATIONS
// ============================================================================

const TabInfo = ({ formData, setFormData, errors }) => {
  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Section Identité */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <User className="w-4 h-4 text-gray-500" />
          Identité
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Nom du client" required error={errors.name}>
            <TextInput
              value={formData.name}
              onChange={(v) => updateField('name', v)}
              placeholder="M. / Mme Dupont"
            />
          </FormField>
          <FormField label="Statut">
            <SelectInput
              value={formData.status}
              onChange={(v) => updateField('status', v)}
              options={CLIENT_STATUSES}
              placeholder="Sélectionner..."
            />
          </FormField>
        </div>
      </div>

      {/* Section Adresse */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-gray-500" />
          Adresse
        </h3>
        <div className="space-y-4">
          <FormField label="Adresse">
            <TextInput
              value={formData.address}
              onChange={(v) => updateField('address', v)}
              placeholder="12 rue des Lilas"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Code postal">
              <TextInput
                value={formData.postalCode}
                onChange={(v) => updateField('postalCode', v)}
                placeholder="40100"
              />
            </FormField>
            <FormField label="Ville">
              <TextInput
                value={formData.city}
                onChange={(v) => updateField('city', v)}
                placeholder="Dax"
              />
            </FormField>
          </div>
        </div>
      </div>

      {/* Section Contact */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Phone className="w-4 h-4 text-gray-500" />
          Contact
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Téléphone">
            <TextInput
              value={formData.phone}
              onChange={(v) => updateField('phone', v)}
              placeholder="06 12 34 56 78"
              type="tel"
            />
          </FormField>
          <FormField label="Email">
            <TextInput
              value={formData.email}
              onChange={(v) => updateField('email', v)}
              placeholder="client@email.com"
              type="email"
            />
          </FormField>
        </div>
      </div>

      {/* Section Habitat */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Home className="w-4 h-4 text-gray-500" />
          Habitat
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Type de logement">
            <SelectInput
              value={formData.housingType}
              onChange={(v) => updateField('housingType', v)}
              options={HOUSING_TYPES}
              placeholder="Sélectionner..."
            />
          </FormField>
          <FormField label="Surface (m²)">
            <TextInput
              value={formData.surface}
              onChange={(v) => updateField('surface', v)}
              placeholder="120"
              type="number"
            />
          </FormField>
          <FormField label="N° DPE ADEME">
            <div className="flex gap-2">
              <TextInput
                value={formData.dpeNumber}
                onChange={(v) => updateField('dpeNumber', v)}
                placeholder="2341E0000000X"
              />
              {formData.dpeNumber && (
                <a
                  href={`https://observatoire-dpe.ademe.fr/trouver-dpe#${formData.dpeNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                  title="Voir sur ADEME"
                >
                  <ExternalLink className="w-5 h-5" />
                </a>
              )}
            </div>
          </FormField>
        </div>
      </div>

      {/* Section Contrat */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          Contrat d'entretien
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Statut contrat">
            <SelectInput
              value={formData.contractStatus}
              onChange={(v) => updateField('contractStatus', v)}
              options={[
                { value: 'none', label: 'Sans contrat' },
                { value: 'active', label: 'Actif' },
                { value: 'pending', label: 'En attente' },
                { value: 'expired', label: 'Expiré' },
              ]}
            />
          </FormField>
          <FormField label="Fréquence">
            <SelectInput
              value={formData.contractFrequency}
              onChange={(v) => updateField('contractFrequency', v)}
              options={CONTRACT_FREQUENCIES}
              placeholder="Sélectionner..."
            />
          </FormField>
          <FormField label="Prochain entretien">
            <TextInput
              value={formatDateForInput(formData.nextMaintenanceDate)}
              onChange={(v) => updateField('nextMaintenanceDate', v)}
              type="date"
            />
          </FormField>
        </div>
      </div>

      {/* Section Commercial */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-gray-500" />
          Commercial
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Source du lead">
            <SelectInput
              value={formData.leadSource}
              onChange={(v) => updateField('leadSource', v)}
              options={LEAD_SOURCES}
              placeholder="Sélectionner..."
            />
          </FormField>
          <FormField label="Date de création">
            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-600">
              {formatDateFR(formData.createdAt)}
            </div>
          </FormField>
        </div>
      </div>

      {/* Notes */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          Notes
        </h3>
        <TextArea
          value={formData.notes}
          onChange={(v) => updateField('notes', v)}
          placeholder="Notes et informations complémentaires..."
          rows={4}
        />
      </div>
    </div>
  );
};

// ============================================================================
// ONGLET ÉQUIPEMENTS
// ============================================================================

const TabEquipments = ({ clientId }) => {
  const { 
    equipments, 
    loading, 
    addEquipment, 
    updateEquipment, 
    deleteEquipment 
  } = useClientEquipments(clientId);

  const handleAdd = () => {
    // TODO: Ouvrir modale ajout équipement
    console.log('Ajouter équipement');
  };

  const handleEdit = (equipment) => {
    // TODO: Ouvrir modale édition équipement
    console.log('Éditer équipement', equipment);
  };

  const handleDelete = async (equipment) => {
    if (window.confirm(`Supprimer l'équipement ${equipment.brand} ${equipment.model} ?`)) {
      await deleteEquipment(equipment.id);
    }
  };

  return (
    <EquipmentList
      equipments={equipments}
      loading={loading}
      onAdd={handleAdd}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  );
};

// ============================================================================
// ONGLET HISTORIQUE
// ============================================================================

const TabHistory = ({ interventions = [], loading = false }) => {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="p-3 bg-gray-50 rounded-lg animate-pulse">
            <div className="h-5 w-32 bg-gray-200 rounded mb-2" />
            <div className="h-4 w-48 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (interventions.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <History className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-gray-500">Aucune intervention enregistrée</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 mb-4">
        {interventions.length} intervention{interventions.length !== 1 ? 's' : ''}
      </p>
      {interventions.map(intervention => (
        <InterventionCard key={intervention.id} intervention={intervention} />
      ))}
    </div>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * Modale fiche client
 * 
 * @param {Object} props
 * @param {string} props.clientId - ID du client (null pour création)
 * @param {boolean} props.isOpen - Modale ouverte
 * @param {Function} props.onClose - Callback fermeture
 * @param {Function} [props.onSaved] - Callback après sauvegarde
 */
export function ClientModal({ 
  clientId, 
  isOpen, 
  onClose, 
  onSaved 
}) {
  // État
  const [activeTab, setActiveTab] = useState('info');
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Hooks données
  const { client, loading, updateClient } = useClient(clientId, { autoLoad: !!clientId });

  // Initialiser le formulaire quand le client est chargé
  useEffect(() => {
    if (client) {
      setFormData({
        name: client.name || '',
        status: client.status || 'lead',
        address: client.address || '',
        postalCode: client.postal_code || '',
        city: client.city || '',
        phone: client.phone || '',
        email: client.email || '',
        housingType: client.housing_type || '',
        surface: client.surface || '',
        dpeNumber: client.dpe_number || '',
        contractStatus: client.contract_status || 'none',
        contractFrequency: client.contract_frequency || '',
        nextMaintenanceDate: client.next_maintenance_date || '',
        leadSource: client.identity?.lead_source || '',
        notes: client.notes || '',
        createdAt: client.created_at,
      });
    }
  }, [client]);

  // Reset au changement de client
  useEffect(() => {
    setActiveTab('info');
    setErrors({});
    setSaveSuccess(false);
  }, [clientId]);

  // Validation
  const validate = useCallback(() => {
    const newErrors = {};
    
    if (!formData.name?.trim()) {
      newErrors.name = 'Le nom est requis';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Sauvegarde
  const handleSave = async () => {
    if (!validate()) return;

    setSaving(true);
    setSaveSuccess(false);

    try {
      const updates = {
        name: formData.name,
        status: formData.status,
        address: formData.address,
        postalCode: formData.postalCode,
        city: formData.city,
        phone: formData.phone,
        email: formData.email,
        housingType: formData.housingType,
        surface: formData.surface ? parseFloat(formData.surface) : null,
        dpeNumber: formData.dpeNumber,
        contractStatus: formData.contractStatus,
        contractFrequency: formData.contractFrequency,
        nextMaintenanceDate: formData.nextMaintenanceDate || null,
        notes: formData.notes,
        identity: {
          ...client?.identity,
          lead_source: formData.leadSource,
        },
      };

      const { error } = await updateClient(updates);

      if (error) throw error;

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      
      onSaved?.();
    } catch (error) {
      console.error('Erreur sauvegarde:', error);
      setErrors({ general: 'Erreur lors de la sauvegarde' });
    } finally {
      setSaving(false);
    }
  };

  // Fermer la modale
  const handleClose = () => {
    onClose();
  };

  // Si modale fermée
  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/50 z-40"
        onClick={handleClose}
      />

      {/* Modale */}
      <div className="fixed inset-4 md:inset-8 lg:inset-16 bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <User className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {loading ? 'Chargement...' : (formData.name || 'Nouveau client')}
              </h2>
              {client && (
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={formData.status} />
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Onglets */}
        <div className="flex border-b border-gray-200 px-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                  ${isActive 
                    ? 'text-blue-600 border-blue-600' 
                    : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'equipments' && client?.equipments_count > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                    {client.equipments_count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === 'info' && (
                <TabInfo 
                  formData={formData} 
                  setFormData={setFormData} 
                  errors={errors}
                />
              )}
              {activeTab === 'equipments' && (
                <TabEquipments clientId={clientId} />
              )}
              {activeTab === 'history' && (
                <TabHistory interventions={client?.interventions || []} />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div>
            {errors.general && (
              <p className="text-sm text-red-600 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.general}
              </p>
            )}
            {saveSuccess && (
              <p className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" />
                Modifications enregistrées
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Fermer
            </button>
            
            {activeTab === 'info' && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Enregistrement...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Enregistrer
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ClientModal;
