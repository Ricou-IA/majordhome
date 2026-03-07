/**
 * EventFormSections.jsx
 * ============================================================================
 * Sections JSX du formulaire RDV, extraites de EventModal.jsx
 * - SectionType : type de RDV, objet, contexte, statut
 * - SectionDateTime : date, durée, heure début/fin
 * - SectionClient : recherche unifiée, bannières client/lead, champs manuels
 * - SectionCommercial : commercial assigné
 * - SectionNotes : description + notes internes
 * ============================================================================
 */

import {
  Clock, User, UserCircle, Tag, FileText,
  Search, ExternalLink, Link2, X, Loader2, Ban,
} from 'lucide-react';
import { FormField, TextInput, SelectInput, TextArea } from '@/apps/artisan/components/FormFields';
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_STATUSES,
} from '@/shared/services/appointments.service';

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1h' },
  { value: 90, label: '1h30' },
  { value: 120, label: '2h' },
  { value: 180, label: '3h' },
  { value: 240, label: '4h' },
];

// ============================================================================
// SECTION TYPE
// ============================================================================

export const SectionType = ({
  formData,
  updateField,
  errors,
  isEdit,
  isCancelled,
  selectedLead,
  leadSources,
}) => (
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
);

// ============================================================================
// SECTION DATE & HEURE
// ============================================================================

export const SectionDateTime = ({ formData, updateField, errors, isCancelled }) => (
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
);

// ============================================================================
// SECTION CLIENT
// ============================================================================

export const SectionClient = ({
  formData,
  updateField,
  errors,
  isCancelled,
  selectedClient,
  selectedLead,
  navigate,
  handleUnlinkClient,
  handleUnlinkLead,
  // Search
  clientSearchQuery,
  searchClient,
  searchLead,
  showClientDropdown,
  setShowClientDropdown,
  clientSearching,
  leadSearching,
  clientSearchResults,
  leadSearchResults,
  handleSelectClient,
  handleSelectLead,
}) => (
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
        <button
          type="button"
          onClick={() => navigate(`/artisan/clients/${selectedClient.id}`)}
          className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-md transition-colors shrink-0"
          title="Voir la fiche client"
        >
          <ExternalLink className="w-3 h-3" />
          Fiche
        </button>
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
        <button
          type="button"
          onClick={() => navigate('/artisan/pipeline')}
          className="flex items-center gap-1 text-xs px-2 py-1 bg-violet-100 text-violet-700 hover:bg-violet-200 rounded-md transition-colors shrink-0"
          title="Voir dans le pipeline"
        >
          <ExternalLink className="w-3 h-3" />
          Lead
        </button>
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

    {/* Recherche unifiée clients + leads */}
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
);

// ============================================================================
// SECTION COMMERCIAL
// ============================================================================

export const SectionCommercial = ({ formData, updateField, commercials, isCancelled }) => (
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
);

// ============================================================================
// SECTION NOTES
// ============================================================================

export const SectionNotes = ({ formData, updateField, isCancelled }) => (
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
);
