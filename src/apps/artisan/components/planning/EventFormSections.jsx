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
  Clock, User, UserCircle, Tag, FileText, Wrench,
  Search, ExternalLink, Link2, X, Loader2,
  Phone, MapPin, CalendarClock, CalendarPlus, MoveHorizontal, AlertTriangle,
} from 'lucide-react';
import { FormField, TextInput, SelectInput, TextArea } from '@/apps/artisan/components/FormFields';
import { formatDateFR, formatPhoneNumber } from '@/lib/utils';
import {
  APPOINTMENT_TYPES,
  COMMERCIAL_TYPES,
  PHONE_REQUIRED_TYPES,
  TECHNICIAN_TYPES,
} from '@services/appointments.service';
import { TechnicianSelect } from './TechnicianSelect';
import { SouplesseSelect } from '@/apps/artisan/components/shared/SouplesseSelect';

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
  availableTypes = APPOINTMENT_TYPES,
  typeLocked = false,
  hideSubject = false,
  allowTypeChange = false,
  retypeHint = null,
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
        options={availableTypes}
        disabled={(isEdit && !allowTypeChange) || isCancelled || typeLocked}
      />
    </FormField>
    {retypeHint && (
      <p className="mt-1.5 text-xs text-gray-400">{retypeHint}</p>
    )}
    {/* Objet masqué dans le flux assistant (création VT/entretien/SAV/install) :
        généré automatiquement (type + client) pour aller droit au but. */}
    {!hideSubject && (
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
    )}
  </div>
);

// ============================================================================
// SECTION DATE & HEURE
// ============================================================================

export const SectionDateTime = ({ formData, updateField, errors, isCancelled, readOnly = false, onRequestReschedule, onRequestContinuation }) => {
  // Lecture seule (édition) : la planification se modifie via l'assistant
  // (« Modifier le RDV ») ou par glisser-déposer sur le calendrier.
  // « Programmer une suite » : le RDV courant reste tel quel, on ajoute un
  // ou plusieurs RDV sur la même carte (chantier pas fini le jour prévu).
  if (readOnly) {
    const timeRange = [formData.scheduled_start, formData.scheduled_end].filter(Boolean).join(' – ');
    const durationLabel = DURATION_OPTIONS.find((o) => o.value === Number(formData.duration_minutes))?.label
      || (formData.duration_minutes ? `${formData.duration_minutes} min` : '');
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-500" />
          Date & Heure
        </h3>
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-sm text-gray-900 min-w-0">
            <span className="font-medium">
              {formData.scheduled_date ? formatDateFR(formData.scheduled_date) : '—'}
            </span>
            {timeRange && <span className="text-gray-600"> · {timeRange}</span>}
            {durationLabel && <span className="text-gray-500"> ({durationLabel})</span>}
          </div>
          {!isCancelled && (onRequestReschedule || onRequestContinuation) && (
            <div className="flex items-center gap-2 shrink-0">
              {onRequestReschedule && (
                <button
                  type="button"
                  onClick={onRequestReschedule}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <CalendarClock className="w-4 h-4" />
                  Modifier le RDV
                </button>
              )}
              {onRequestContinuation && (
                <button
                  type="button"
                  onClick={onRequestContinuation}
                  title="Ajouter un ou plusieurs RDV sur la même carte, sans toucher à celui-ci"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <CalendarPlus className="w-4 h-4" />
                  Programmer une suite
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
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
};

// ============================================================================
// SECTION CLIENT
// ============================================================================

/** Chip « lien » de la carte contact : ouvre la cible, `×` pour délier (null = pas de délier). */
const LinkChip = ({ icon: Icon, label, title, tone, onOpen, onUnlink, unlinkTitle }) => (
  <span className={`inline-flex items-center rounded-md border text-xs shrink-0 ${tone}`}>
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className="flex items-center gap-1 px-2 py-1 hover:bg-white/60 rounded-l-md transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      <ExternalLink className="w-3 h-3" />
    </button>
    {onUnlink && (
      <button
        type="button"
        onClick={onUnlink}
        title={unlinkTitle}
        className="px-1.5 py-1 border-l border-black/10 text-gray-400 hover:text-red-500 rounded-r-md transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </span>
);

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
  showContactDetails = false,
  // leadOnly : mode « RDV Bouclage R2 » — on ne propose QUE des cartes pipeline
  // existantes (leads). Ni résultats clients, ni saisie manuelle, ni client libre.
  leadOnly = false,
  // browseLeads : cartes pipeline récentes affichées d'emblée en leadOnly (champ vide),
  // la recherche (>= 2 car.) prenant le relais dès qu'on tape.
  browseLeads = [],
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
}) => {
  // Cartes affichées dans le dropdown leadOnly : recherche dès 2 caractères, sinon
  // liste parcourable des cartes récentes. Hors leadOnly : recherche unifiée classique.
  const displayLeads = leadOnly
    ? (clientSearchQuery.length >= 2 ? leadSearchResults : browseLeads)
    : leadSearchResults;

  // Carte contact : photo du RDV d'abord, fiche client liée en repli.
  const showClientChip = !!selectedClient && !leadOnly;
  const contactName = [formData.client_name, formData.client_first_name].filter(Boolean).join(' ')
    || (showClientChip ? selectedClient.display_name : '')
    || selectedLead?.display_name
    || 'Sans nom';
  const contactPhone = formData.client_phone || (showClientChip ? selectedClient.phone : '') || '';
  const contactAddress = [
    formData.client_address || (showClientChip ? selectedClient.address : ''),
    [
      formData.client_postal_code || (showClientChip ? selectedClient.postal_code : ''),
      formData.client_city || (showClientChip ? selectedClient.city : ''),
    ].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  const showContactCard = showClientChip || !!selectedLead
    || (showContactDetails && (contactName !== 'Sans nom' || contactPhone || contactAddress));

  return (
  <div>
    <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
      <User className="w-4 h-4 text-gray-500" />
      Client
    </h3>

    {/* Carte contact UNIQUE : nom + téléphone + adresse, avec les liens (fiche client /
        carte pipeline) en chips. Une seule source affichée : la photo du RDV (formData),
        complétée par la fiche client liée quand la photo est incomplète (téléphone,
        adresse — selon le chemin de création, le RDV ne les porte pas toujours).
        Avant : trois blocs (coordonnées + bannière client + bannière lead) répétaient
        le même nom. Client masqué en leadOnly (R2 raisonne par carte, pas par client). */}
    {showContactCard && (
      <div className="mb-3 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg space-y-1.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{contactName}</div>
            {showClientChip && selectedClient.client_number && (
              <div className="text-xs text-gray-500">N° client {selectedClient.client_number}</div>
            )}
          </div>
          {showClientChip && (
            <LinkChip
              icon={UserCircle}
              label="Fiche"
              title="Voir la fiche client"
              tone="border-blue-200 bg-blue-50 text-blue-700"
              onOpen={() => navigate(`/clients/${selectedClient.id}`)}
              onUnlink={isCancelled ? null : handleUnlinkClient}
              unlinkTitle="Délier le client"
            />
          )}
          {selectedLead && (
            <LinkChip
              icon={Link2}
              label={selectedLead.status_label ? `Lead · ${selectedLead.status_label}` : 'Lead'}
              title="Voir dans le pipeline"
              tone="border-violet-200 bg-violet-50 text-violet-700"
              onOpen={() => navigate('/pipeline')}
              onUnlink={isCancelled ? null : handleUnlinkLead}
              unlinkTitle="Délier le lead"
            />
          )}
        </div>
        {contactPhone && (
          <a
            href={`tel:${contactPhone}`}
            className="flex items-center gap-1.5 text-sm text-blue-700 hover:underline w-fit"
          >
            <Phone className="w-3.5 h-3.5 shrink-0" />
            {formatPhoneNumber(contactPhone)}
          </a>
        )}
        {contactAddress && (
          <div className="flex items-start gap-1.5 text-sm text-gray-600">
            <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{contactAddress}</span>
          </div>
        )}
      </div>
    )}

    {/* Recherche unifiée clients + leads (leadOnly : leads seuls, le client implicite
        d'une fiche n'empêche pas de choisir la carte à boucler). */}
    {(leadOnly ? !selectedLead : (!selectedClient && !selectedLead)) && !isCancelled && (
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
              // leadOnly : ouvre d'emblée pour montrer la liste des cartes récentes.
              if (leadOnly || clientSearchQuery.length >= 2) setShowClientDropdown(true);
            }}
            onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
            className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg text-sm outline-none transition-colors bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder={leadOnly ? 'Rechercher une carte du pipeline…' : 'Rechercher un client ou un lead...'}
          />
          {(clientSearching || leadSearching) && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />
          )}
        </div>
        {/* Dropdown résultats unifiés (leadOnly : cartes récentes ou recherche) */}
        {showClientDropdown && (leadOnly ? displayLeads.length > 0 : (clientSearchResults.length > 0 || leadSearchResults.length > 0)) && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {clientSearchResults.length > 0 && !leadOnly && (
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
            {displayLeads.length > 0 && (
              <>
                <div className="px-3 py-1.5 bg-violet-50 text-xs font-semibold text-violet-600 uppercase tracking-wide border-b border-gray-100">
                  {leadOnly && clientSearchQuery.length < 2
                    ? `Cartes récentes (${displayLeads.length})`
                    : `Leads (${displayLeads.length})`}
                </div>
                {displayLeads.map((lead) => (
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
        {showClientDropdown && clientSearchQuery.length >= 2 && !clientSearching && !leadSearching
          && leadSearchResults.length === 0 && (leadOnly || clientSearchResults.length === 0) && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-3 text-sm text-gray-500 italic">
            {leadOnly ? 'Aucune carte du pipeline trouvée' : 'Aucun client ou lead trouvé'}
          </div>
        )}
      </div>
    )}

    {/* Séparateur saisie manuelle (jamais en leadOnly : R2 exige une carte existante) */}
    {!selectedClient && !selectedLead && !isCancelled && !leadOnly && (
      <p className="text-xs text-gray-400 mb-2 text-center">— ou saisie manuelle —</p>
    )}

    {/* Saisie manuelle / compact : masquée dès qu'un client ou lead est lié
        (le banner ci-dessus tient lieu de « client implicite »), et jamais en leadOnly (R2). */}
    {!selectedClient && !selectedLead && !leadOnly && (
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
        <FormField label="Téléphone" required={PHONE_REQUIRED_TYPES.includes(formData.appointment_type)} error={errors.client_phone}>
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
    )}
  </div>
  );
};

// ============================================================================
// SECTION COMMERCIAL
// ============================================================================

/**
 * SectionAssignee — Assignation dynamique selon le type de RDV (édition classique).
 * Tous les IDs sont des team_members.id (table pivot planning).
 * - COMMERCIAL_TYPES → 1 commercial (role commercial/admin), porté par
 *   `assigned_commercial_id` — jamais par `technicianIds` (vidé à la sélection :
 *   l'ancien sélecteur y rangeait le commercial en « technicien », lien fantôme).
 *   `commercialMemberId` = la personne enregistrée résolue par EventModal
 *   (l'id stocké peut venir du pipeline, cf. resolveCommercialMemberId).
 * - TECHNICIAN_TYPES → techniciens (multi) via `technicianIds`
 * - other → tous les team_members actifs (multi) via `technicianIds`
 */
export const SectionAssignee = ({ formData, updateField, allTeamMembers, commercialMemberId = null, errors = {} }) => {
  const type = formData.appointment_type;
  const isCommercialType = COMMERCIAL_TYPES.includes(type);
  const isTechnicianType = TECHNICIAN_TYPES.includes(type);

  let selectMembers, label, icon, placeholder;

  if (isCommercialType) {
    selectMembers = (allTeamMembers || []).filter(m => ['commercial', 'admin'].includes(m.role));
    label = 'Commercial assigné';
    icon = <User className="w-4 h-4 text-gray-500" />;
    placeholder = 'Sélectionner un commercial...';
  } else if (isTechnicianType) {
    selectMembers = (allTeamMembers || []).filter(m => m.role === 'technician');
    label = 'Technicien assigné';
    icon = <Wrench className="w-4 h-4 text-gray-500" />;
    placeholder = 'Sélectionner un technicien...';
  } else {
    selectMembers = allTeamMembers || [];
    label = 'Personne(s) assignée(s)';
    icon = <User className="w-4 h-4 text-gray-500" />;
    placeholder = 'Sélectionner des personnes...';
  }

  const error = isCommercialType ? errors.assigned_commercial_id : errors.technicianIds;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        {icon}
        {label}
      </h3>
      {isCommercialType ? (
        <SelectInput
          value={commercialMemberId || ''}
          onChange={(id) => {
            updateField('assigned_commercial_id', id || '');
            updateField('technicianIds', []);
          }}
          options={selectMembers.map((m) => ({ value: m.id, label: m.display_name }))}
          placeholder={placeholder}
        />
      ) : (
        <TechnicianSelect
          selectedIds={formData.technicianIds || []}
          onChange={(ids) => updateField('technicianIds', ids)}
          members={selectMembers}
          placeholder={placeholder}
        />
      )}
      {error && (
        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}
    </div>
  );
};

// ============================================================================
// SECTION NOTES
// ============================================================================

/**
 * Souplesse du RDV (spec 2026-09-12) : jusqu'où son heure peut glisser pour la
 * tournée. « Figé » = le client exige cette heure (hour_confirmed_at posé au
 * save). Même sélecteur que la prise de RDV — un seul composant.
 */
export const SectionSouplesse = ({ formData, updateField, isCancelled, souplesseDefaut = 30 }) => (
  <div>
    <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
      <MoveHorizontal className="w-4 h-4 text-gray-500" />
      Souplesse du rendez-vous
    </h3>
    <SouplesseSelect
      value={formData.time_flex_minutes ?? null}
      onChange={(v) => updateField('time_flex_minutes', v)}
      defaut={souplesseDefaut}
      disabled={isCancelled}
      compact
    />
    <p className="text-xs text-gray-500 mt-2">
      {(formData.time_flex_minutes ?? souplesseDefaut) === 0
        ? (formData.hour_confirmed_at
          ? 'Heure communiquée au client : le moteur de tournées ne la déplacera pas.'
          : 'Figé à l’enregistrement : l’heure devient ferme, le moteur ne la déplacera plus.')
        : (formData.hour_confirmed_at
          ? 'Redevient adaptable à l’enregistrement : le moteur pourra le glisser dans cette tolérance.'
          : 'Adaptable : le moteur peut le glisser dans cette tolérance pour faire rentrer un autre entretien.')}
    </p>
  </div>
);

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
