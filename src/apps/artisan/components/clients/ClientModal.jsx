/**
 * ClientModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale fiche client complète avec système de verrouillage.
 * Onglets : Informations / Équipements / Historique
 * 
 * v2.2.0 - Ajout Nom/Prénom séparés + Fix sauvegarde complète
 * v2.1.1 - Fix LockOpen → Unlock (compatibilité lucide-react)
 * v2.1.0 - PhoneInput formatage auto + fix Historique
 * v2.0.0 - Ajout système cadenas (lecture seule par défaut)
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

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Archive,
  Lock,
  Unlock,
  Plus
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useClient, useClientEquipments } from '@/shared/hooks/useClients';
import { clientsService, CLIENT_CATEGORIES, LEAD_SOURCES, HOUSING_TYPES } from '@/shared/services/clients.service';
import { EquipmentList } from './EquipmentList';

// ============================================================================
// CONSTANTES
// ============================================================================

const TABS = [
  { id: 'info', label: 'Informations', icon: User },
  { id: 'equipments', label: 'Équipements', icon: Wrench },
  { id: 'history', label: 'Historique', icon: History },
];

// HOUSING_TYPES est importé depuis clients.service.js

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
 * Formate un numéro de téléphone en XX XX XX XX XX
 * @param {string} value - Valeur brute
 * @returns {string} Numéro formaté
 */
const formatPhoneNumber = (value) => {
  if (!value) return '';
  
  // Garder uniquement les chiffres
  const digits = value.replace(/\D/g, '');
  
  // Limiter à 10 chiffres
  const limited = digits.slice(0, 10);
  
  // Formater en XX XX XX XX XX
  const parts = [];
  for (let i = 0; i < limited.length; i += 2) {
    parts.push(limited.slice(i, i + 2));
  }
  
  return parts.join(' ');
};

/**
 * Parse le nom complet en nom/prénom
 * Format attendu: "NOM PRENOM" ou "NOM PRENOM1 PRENOM2"
 */
const parseFullName = (fullName) => {
  if (!fullName) return { lastName: '', firstName: '' };
  
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { lastName: '', firstName: '' };
  if (parts.length === 1) return { lastName: parts[0], firstName: '' };
  
  // Premier mot = nom, reste = prénom
  const lastName = parts[0];
  const firstName = parts.slice(1).join(' ');
  
  return { lastName, firstName };
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
 * Input texte avec support disabled
 */
const TextInput = ({ value, onChange, placeholder, type = 'text', disabled = false, ...props }) => (
  <input
    type={type}
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    disabled={disabled}
    className={`
      w-full px-3 py-2 border rounded-lg outline-none transition-colors
      ${disabled 
        ? 'bg-gray-50 border-gray-200 text-gray-600 cursor-not-allowed' 
        : 'bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
      }
    `}
    {...props}
  />
);

/**
 * Input téléphone avec formatage automatique XX XX XX XX XX
 */
const PhoneInput = ({ value, onChange, placeholder = "06 12 34 56 78", disabled = false }) => {
  const handleChange = (e) => {
    const rawValue = e.target.value;
    const formatted = formatPhoneNumber(rawValue);
    onChange(formatted);
  };

  return (
    <input
      type="tel"
      value={value || ''}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={14} // XX XX XX XX XX = 14 caractères
      className={`
        w-full px-3 py-2 border rounded-lg outline-none transition-colors
        ${disabled 
          ? 'bg-gray-50 border-gray-200 text-gray-600 cursor-not-allowed' 
          : 'bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
        }
      `}
    />
  );
};

/**
 * Select avec support disabled
 */
const SelectInput = ({ value, onChange, options, placeholder, disabled = false }) => (
  <select
    value={value || ''}
    onChange={(e) => onChange(e.target.value || null)}
    disabled={disabled}
    className={`
      w-full px-3 py-2 border rounded-lg outline-none transition-colors
      ${disabled 
        ? 'bg-gray-50 border-gray-200 text-gray-600 cursor-not-allowed' 
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

/**
 * Textarea avec support disabled
 */
const TextArea = ({ value, onChange, placeholder, rows = 3, disabled = false }) => (
  <textarea
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    disabled={disabled}
    className={`
      w-full px-3 py-2 border rounded-lg outline-none transition-colors resize-none
      ${disabled 
        ? 'bg-gray-50 border-gray-200 text-gray-600 cursor-not-allowed' 
        : 'bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
      }
    `}
  />
);

/**
 * Badge de statut pipeline
 */
const CategoryBadge = ({ clientCategory }) => {
  const found = CLIENT_CATEGORIES.find(s => s.value === clientCategory);
  if (!found) return null;

  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${found.color}`}>
      {found.label}
    </span>
  );
};

/**
 * Carte intervention (historique)
 * Utilise scheduled_date et report_notes (noms réels des colonnes DB)
 */
const InterventionCard = ({ intervention }) => {
  const {
    intervention_type,
    scheduled_date,
    technician_name,
    report_notes,
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
            {formatDateFR(scheduled_date)}
            {technician_name && ` • ${technician_name}`}
          </p>
        </div>
      </div>
      {report_notes && (
        <p className="text-sm text-gray-600 mt-2 line-clamp-2">{report_notes}</p>
      )}
    </div>
  );
};

// ============================================================================
// ONGLET INFORMATIONS
// ============================================================================

const TabInfo = ({ formData, setFormData, errors, isLocked }) => {
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Nom" required error={errors.lastName}>
            <TextInput
              value={formData.lastName}
              onChange={(v) => updateField('lastName', v.toUpperCase())}
              placeholder="DUPONT"
              disabled={isLocked}
            />
          </FormField>
          <FormField label="Prénom">
            <TextInput
              value={formData.firstName}
              onChange={(v) => updateField('firstName', v)}
              placeholder="Jean"
              disabled={isLocked}
            />
          </FormField>
          <FormField label="Catégorie">
            <SelectInput
              value={formData.clientCategory}
              onChange={(v) => updateField('clientCategory', v)}
              options={CLIENT_CATEGORIES}
              placeholder="Sélectionner..."
              disabled={isLocked}
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
              disabled={isLocked}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Code postal">
              <TextInput
                value={formData.postalCode}
                onChange={(v) => updateField('postalCode', v)}
                placeholder="40100"
                disabled={isLocked}
              />
            </FormField>
            <FormField label="Ville">
              <TextInput
                value={formData.city}
                onChange={(v) => updateField('city', v)}
                placeholder="Dax"
                disabled={isLocked}
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
            <PhoneInput
              value={formData.phone}
              onChange={(v) => updateField('phone', v)}
              disabled={isLocked}
            />
          </FormField>
          <FormField label="Email">
            <TextInput
              value={formData.email}
              onChange={(v) => updateField('email', v)}
              placeholder="client@email.com"
              type="email"
              disabled={isLocked}
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
              disabled={isLocked}
            />
          </FormField>
          <FormField label="Surface (m²)">
            <TextInput
              value={formData.surface}
              onChange={(v) => updateField('surface', v)}
              placeholder="120"
              type="number"
              disabled={isLocked}
            />
          </FormField>
          <FormField label="N° DPE ADEME">
            <div className="flex gap-2">
              <TextInput
                value={formData.dpeNumber}
                onChange={(v) => updateField('dpeNumber', v)}
                placeholder="2341E0000000X"
                disabled={isLocked}
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
              disabled={isLocked}
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
          disabled={isLocked}
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
 * Modale fiche client avec système de verrouillage
 * Mode édition (clientId fourni) : chargement du client, cadenas, onglets
 * Mode création (clientId=null) : formulaire vide, pas de cadenas, onglet info seulement
 *
 * @param {Object} props
 * @param {string} props.clientId - ID du client (null pour création)
 * @param {boolean} props.isOpen - Modale ouverte
 * @param {Function} props.onClose - Callback fermeture
 * @param {Function} [props.onSaved] - Callback après sauvegarde
 * @param {Function} [props.onCreated] - Callback après création (reçoit le client créé)
 */
export function ClientModal({
  clientId,
  isOpen,
  onClose,
  onSaved,
  onCreated,
}) {
  const isCreateMode = !clientId;
  const { organization, user } = useAuth();
  const orgId = organization?.id;

  // État
  const [activeTab, setActiveTab] = useState('info');
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isLocked, setIsLocked] = useState(true);

  // Ref pour stocker les données originales
  const originalDataRef = useRef({});

  // Ref pour la position de scroll
  const contentRef = useRef(null);

  // Hooks données (désactivé en mode création)
  const { client, isLoading: loading, updateClient } = useClient(clientId);

  /**
   * Crée l'objet formData à partir du client
   */
  const buildFormData = useCallback((clientData) => {
    // Les champs viennent directement de majordhome.clients (colonnes typées)
    let firstName = clientData.first_name || '';
    let lastName = clientData.last_name || '';

    // Fallback : parser depuis display_name si pas de nom/prénom séparés
    if (!firstName && !lastName && clientData.display_name) {
      const parsed = parseFullName(clientData.display_name);
      firstName = parsed.firstName;
      lastName = parsed.lastName;
    }

    return {
      firstName,
      lastName,
      clientCategory: clientData.client_category || 'particulier',
      address: clientData.address || '',
      postalCode: clientData.postal_code || '',
      city: clientData.city || '',
      phone: clientData.phone || '',
      email: clientData.email || '',
      housingType: clientData.housing_type || '',
      surface: clientData.surface || '',
      dpeNumber: clientData.dpe_number || '',
      leadSource: clientData.lead_source || '',
      notes: clientData.notes || '',
      createdAt: clientData.created_at,
    };
  }, []);

  // Initialiser le formulaire quand le client est chargé (mode édition)
  useEffect(() => {
    if (client) {
      const data = buildFormData(client);
      setFormData(data);
      originalDataRef.current = data;
    }
  }, [client, buildFormData]);

  // Reset au changement de client ou à l'ouverture
  useEffect(() => {
    if (isOpen) {
      setActiveTab('info');
      setErrors({});
      setSaveSuccess(false);

      if (isCreateMode) {
        // Mode création : formulaire vide, déverrouillé
        const emptyForm = {
          firstName: '',
          lastName: '',
          clientCategory: 'particulier',
          companyName: '',
          address: '',
          postalCode: '',
          city: '',
          phone: '',
          phoneSecondary: '',
          email: '',
          housingType: '',
          surface: '',
          dpeNumber: '',
          leadSource: '',
          notes: '',
          createdAt: null,
        };
        setFormData(emptyForm);
        originalDataRef.current = emptyForm;
        setIsLocked(false);
      } else {
        setIsLocked(true); // Toujours verrouillé à l'ouverture en mode édition
      }
    }
  }, [clientId, isOpen, isCreateMode]);

  /**
   * Vérifie si des modifications ont été faites
   */
  const hasUnsavedChanges = useCallback(() => {
    const original = originalDataRef.current;
    
    const fieldsToCompare = [
      'firstName', 'lastName', 'clientCategory', 'address', 'postalCode', 'city',
      'phone', 'email', 'housingType', 'surface', 'dpeNumber',
      'leadSource', 'notes'
    ];

    return fieldsToCompare.some(field => {
      const originalValue = original[field] ?? '';
      const currentValue = formData[field] ?? '';
      return String(originalValue) !== String(currentValue);
    });
  }, [formData]);

  /**
   * Toggle verrouillage
   */
  const handleToggleLock = useCallback(() => {
    if (!isLocked) {
      // On verrouille → reset aux données originales
      setFormData({ ...originalDataRef.current });
      setErrors({});
    }
    setIsLocked(!isLocked);
  }, [isLocked]);

  // Validation
  const validate = useCallback(() => {
    const newErrors = {};
    
    if (!formData.lastName?.trim()) {
      newErrors.lastName = 'Le nom est requis';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Sauvegarde (création ou mise à jour)
  const handleSave = async () => {
    if (!validate()) return;

    setSaving(true);
    setSaveSuccess(false);

    try {
      if (isCreateMode) {
        // --- MODE CRÉATION ---
        if (!orgId) throw new Error('Organisation non disponible');

        const { data: newClient, error } = await clientsService.createClient({
          orgId,
          firstName: formData.firstName,
          lastName: formData.lastName,
          companyName: formData.companyName || null,
          email: formData.email || null,
          phone: formData.phone || null,
          phoneSecondary: formData.phoneSecondary || null,
          address: formData.address || null,
          postalCode: formData.postalCode || null,
          city: formData.city || null,
          housingType: formData.housingType || null,
          surface: formData.surface || null,
          dpeNumber: formData.dpeNumber || null,
          clientCategory: formData.clientCategory || 'particulier',
          leadSource: formData.leadSource || null,
          notes: formData.notes || null,
          createdBy: user?.id,
        });

        if (error) throw error;

        toast.success('Client créé avec succès');
        onCreated?.(newClient);
        onClose();
      } else {
        // --- MODE ÉDITION ---
        const updates = {
          firstName: formData.firstName,
          lastName: formData.lastName,
          clientCategory: formData.clientCategory,
          address: formData.address,
          postalCode: formData.postalCode,
          city: formData.city,
          phone: formData.phone,
          email: formData.email,
          housingType: formData.housingType,
          surface: formData.surface,
          dpeNumber: formData.dpeNumber,
          leadSource: formData.leadSource,
          notes: formData.notes,
        };

        const { data, error } = await updateClient(updates);

        if (error) throw error;

        // Mettre à jour les données originales après sauvegarde réussie
        originalDataRef.current = { ...formData };

        setSaveSuccess(true);

        // Ne pas appeler onSaved immédiatement pour éviter le refresh
        // qui recharge les données et fait remonter le scroll
        setTimeout(() => {
          setSaveSuccess(false);
        }, 2000);
      }
    } catch (error) {
      console.error('[ClientModal] Erreur sauvegarde:', error);
      setErrors({ general: 'Erreur lors de la sauvegarde: ' + (error.message || 'Erreur inconnue') });
    } finally {
      setSaving(false);
    }
  };

  // Fermer la modale
  const handleClose = useCallback(() => {
    // Si déverrouillé et modifications non sauvegardées → confirmation
    if (!isLocked && hasUnsavedChanges()) {
      const confirmed = window.confirm(
        'Vous avez des modifications non enregistrées.\n\nVoulez-vous vraiment fermer et perdre ces modifications ?'
      );
      if (!confirmed) return;
    }
    
    // Appeler onSaved si des modifications ont été enregistrées
    if (saveSuccess) {
      onSaved?.();
    }
    
    onClose();
  }, [isLocked, hasUnsavedChanges, onClose, onSaved, saveSuccess]);

  // Si modale fermée
  if (!isOpen) return null;

  // Nom complet pour l'affichage
  const displayName = isCreateMode
    ? (`${formData.lastName || ''} ${formData.firstName || ''}`.trim() || 'Nouveau client')
    : (`${formData.lastName || ''} ${formData.firstName || ''}`.trim() || 'Client');

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
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isCreateMode ? 'bg-green-100' : 'bg-blue-100'
            }`}>
              {isCreateMode ? (
                <Plus className="w-5 h-5 text-green-600" />
              ) : (
                <User className="w-5 h-5 text-blue-600" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isCreateMode ? 'Nouveau client' : (loading ? 'Chargement...' : displayName)}
              </h2>
              {!isCreateMode && client && (
                <div className="flex items-center gap-2 mt-0.5">
                  <CategoryBadge clientCategory={formData.clientCategory} />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Bouton Cadenas (mode édition seulement) */}
            {!isCreateMode && (
              <button
                onClick={handleToggleLock}
                className={`
                  p-2 rounded-lg transition-colors
                  ${isLocked
                    ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
                  }
                `}
                title={isLocked ? 'Déverrouiller pour modifier' : 'Verrouiller (annule les modifications)'}
              >
                {isLocked ? (
                  <Lock className="w-5 h-5" />
                ) : (
                  <Unlock className="w-5 h-5" />
                )}
              </button>
            )}

            {/* Bouton Fermer */}
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Onglets (masqués en mode création) */}
        {!isCreateMode && (
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
        )}

        {/* Contenu */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
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
                  isLocked={isLocked}
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
            {!isLocked && !errors.general && !saveSuccess && !isCreateMode && (
              <p className="text-sm text-amber-600 flex items-center gap-1">
                <Unlock className="w-4 h-4" />
                Mode édition actif
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
            
            {/* Bouton Enregistrer/Créer visible si déverrouillé et sur l'onglet info */}
            {!isLocked && activeTab === 'info' && (
              <button
                onClick={handleSave}
                disabled={saving}
                className={`inline-flex items-center gap-2 px-4 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                  isCreateMode
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isCreateMode ? 'Création...' : 'Enregistrement...'}
                  </>
                ) : (
                  <>
                    {isCreateMode ? <Plus className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {isCreateMode ? 'Créer le client' : 'Enregistrer'}
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
