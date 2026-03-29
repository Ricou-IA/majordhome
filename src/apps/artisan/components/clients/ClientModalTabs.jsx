/**
 * ClientModalTabs.jsx - Onglets de la modale client
 * ============================================================================
 * Extrait de ClientModal.jsx :
 *   - TabInfo (formulaire infos client)
 *   - TabEquipments (wrapper EquipmentList)
 *   - TabHistory (liste interventions)
 *   - CategoryBadge, InterventionCard (sous-composants)
 * ============================================================================
 */

import {
  User, MapPin, Phone, Home, Building2,
  History, ExternalLink, ClipboardCheck, Wrench,
} from 'lucide-react';
import { CertificatLink } from '@/apps/artisan/components/certificat/CertificatLink';
import { CLIENT_CATEGORIES, LEAD_SOURCES, HOUSING_TYPES } from '@services/clients.service';
import { useClientEquipments } from '@hooks/useClients';
import { formatDateFR } from '@/lib/utils';
import { FormField, TextInput, PhoneInput, SelectInput, TextArea } from '../FormFields';
import { EquipmentList } from './EquipmentList';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

export function CategoryBadge({ clientCategory }) {
  const found = CLIENT_CATEGORIES.find(s => s.value === clientCategory);
  if (!found) return null;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${found.color}`}>
      {found.label}
    </span>
  );
}

function InterventionCard({ intervention }) {
  const { intervention_type, scheduled_date, technician_name, report_notes, status, workflow_status, id, contract_number } = intervention;

  const typeLabels = {
    maintenance: 'Entretien',
    repair: 'Dépannage',
    installation: 'Installation',
    inspection: 'Visite technique',
    entretien: 'Entretien',
    sav: 'SAV',
    other: 'Autre',
  };

  const typeIcons = {
    entretien: ClipboardCheck,
    sav: Wrench,
  };

  // Support both legacy status and workflow_status
  const statusConfig = {
    completed: { label: 'Terminé', className: 'bg-green-100 text-green-700' },
    scheduled: { label: 'Planifié', className: 'bg-blue-100 text-blue-700' },
    cancelled: { label: 'Annulé', className: 'bg-gray-100 text-gray-700' },
    in_progress: { label: 'En cours', className: 'bg-amber-100 text-amber-700' },
    // Workflow statuses (entretien/sav)
    a_planifier: { label: 'À planifier', className: 'bg-amber-100 text-amber-700' },
    planifie: { label: 'Planifié', className: 'bg-blue-100 text-blue-700' },
    realise: { label: 'Réalisé', className: 'bg-green-100 text-green-700' },
    demande: { label: 'Demande', className: 'bg-red-100 text-red-700' },
    devis_envoye: { label: 'Devis envoyé', className: 'bg-indigo-100 text-indigo-700' },
    pieces_commandees: { label: 'Pièces commandées', className: 'bg-purple-100 text-purple-700' },
  };

  const effectiveStatus = workflow_status || status;
  const statusInfo = statusConfig[effectiveStatus] || { label: effectiveStatus, className: 'bg-gray-100 text-gray-700' };

  const isEntretienRealise = intervention_type === 'entretien' && workflow_status === 'realise';
  const isEntretienPlanifie = intervention_type === 'entretien' && workflow_status === 'planifie';
  const TypeIcon = typeIcons[intervention_type] || null;

  return (
    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {TypeIcon && <TypeIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
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
            {contract_number && ` • ${contract_number}`}
          </p>
        </div>
        {/* Lien certificat pour entretiens réalisés ou planifiés */}
        {isEntretienRealise && (
          <CertificatLink
            interventionId={id}
            isRealise={true}
            label="Certificat"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors flex-shrink-0 disabled:opacity-70"
          />
        )}
        {isEntretienPlanifie && (
          <CertificatLink
            interventionId={id}
            isRealise={false}
            label="Remplir"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors flex-shrink-0 disabled:opacity-70"
          />
        )}
      </div>
      {report_notes && (
        <p className="text-sm text-gray-600 mt-2 line-clamp-2">{report_notes}</p>
      )}
    </div>
  );
}

// ============================================================================
// ONGLET INFORMATIONS
// ============================================================================

export function TabInfo({ formData, setFormData, errors, isLocked }) {
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
}

// ============================================================================
// ONGLET ÉQUIPEMENTS
// ============================================================================

export function TabEquipments({ clientId }) {
  const { equipments, loading, deleteEquipment } = useClientEquipments(clientId);

  const handleDelete = async (equipment) => {
    if (window.confirm(`Supprimer l'équipement ${equipment.brand} ${equipment.model} ?`)) {
      await deleteEquipment(equipment.id);
    }
  };

  return (
    <EquipmentList
      equipments={equipments}
      loading={loading}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={handleDelete}
    />
  );
}

// ============================================================================
// ONGLET HISTORIQUE
// ============================================================================

export function TabHistory({ interventions = [], loading = false }) {
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
}
