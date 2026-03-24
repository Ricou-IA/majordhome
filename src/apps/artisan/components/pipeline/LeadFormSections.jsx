/**
 * LeadFormSections.jsx
 * ============================================================================
 * Sections JSX du formulaire lead, extraites de LeadModal.jsx
 * - SectionClientLinking : recherche/affichage client lié
 * - SectionContact : champs identité + téléphone + email + adresse
 * - SectionPipeline : source, statut, équipement, commercial, montant, motif perte, suivi, actions suivantes
 * - SectionSuivi : dates pipeline (appels, RDV, devis, signature)
 * - SectionActions : convertir en client, statut converti
 * - SectionNotes : notes internes + timeline
 * ============================================================================
 */

import {
  Search, UserCircle, PenLine, Unlink, Link2, X,
  Phone, PhoneOutgoing, PhoneForwarded, Mail, MailCheck, MapPin, Euro, ChevronDown, CalendarDays,
  ArrowRightLeft, Target, UserCheck, Loader2,
  FileText, ChevronRight, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FormField, SectionTitle, inputClass, selectClass } from '@/apps/artisan/components/FormFields';
import { formatPhoneNumber } from '@/lib/utils';
import { EQUIPMENT_CATEGORY_LABELS, LOST_REASONS } from './LeadStatusConfig';
import { FICHE_STATUS_CONFIG, computeVisitStatus } from './FicheTechniqueConfig';
import { useTechnicalVisit } from '@/shared/hooks/useTechnicalVisit';
// SchedulingPanel déplacé dans LeadModal (overlay mode)
import { LeadActivityTimeline } from './LeadActivityTimeline';

// ============================================================================
// CLIENT LINKING
// ============================================================================

export const SectionClientLinking = ({
  linkedClient,
  editClientMode,
  setEditClientMode,
  handleUnlinkClient,
  isEditing,
  showLinkSearch,
  setShowLinkSearch,
  clientSearchQuery,
  searchClient,
  showClientDropdown,
  setShowClientDropdown,
  clientSearching,
  clientResults,
  handleSelectClient,
  clearClientSearch,
}) => (
  <div className="mb-2">
    {linkedClient ? (
      <>
        <div className="flex items-center gap-2">
          <SectionTitle>Client lié</SectionTitle>
          <button
            type="button"
            onClick={handleUnlinkClient}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors -mt-1"
            title="Délier le client"
          >
            <Unlink className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
          <UserCircle className="h-5 w-5 text-blue-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-blue-800 truncate block">
              {linkedClient.display_name}
            </span>
            {(linkedClient.city || linkedClient.client_number) && (
              <span className="text-xs text-blue-600">
                {linkedClient.client_number}{linkedClient.city ? ` — ${linkedClient.city}` : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditClientMode(!editClientMode)}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors shrink-0 ${
              editClientMode
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
            }`}
            title={editClientMode ? 'Désactiver la modification' : 'Modifier les infos client'}
          >
            <PenLine className="h-3 w-3" />
            {editClientMode ? 'Modification' : 'Modifier'}
          </button>
        </div>
        {editClientMode && (
          <div className="mt-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            Les modifications des champs contact seront répercutées sur la fiche client à l'enregistrement
          </div>
        )}
      </>
    ) : (
      <>
        {isEditing && !showLinkSearch ? (
          <button
            type="button"
            onClick={() => setShowLinkSearch(true)}
            className="flex items-center gap-2 w-full px-3 py-2.5 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors"
          >
            <Link2 className="h-4 w-4" />
            Lier à un client existant
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <SectionTitle>Client existant</SectionTitle>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => { setShowLinkSearch(false); clearClientSearch(); }}
                  className="flex items-center text-xs text-gray-400 hover:text-gray-600 transition-colors -mt-1"
                  title="Fermer la recherche"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={clientSearchQuery}
                  onChange={(e) => {
                    searchClient(e.target.value);
                    setShowClientDropdown(true);
                  }}
                  onFocus={() => {
                    if (clientSearchQuery.length >= 2) setShowClientDropdown(true);
                  }}
                  onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                  className={`${inputClass} pl-9`}
                  placeholder="Rechercher un client existant..."
                />
                {clientSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                )}
              </div>
              {showClientDropdown && clientResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {clientResults.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectClient(client)}
                      className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
                    >
                      <span className="text-sm font-medium text-gray-900 block truncate">
                        {client.display_name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {client.client_number}{client.city ? ` — ${client.city}` : ''}{client.phone ? ` — ${client.phone}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {showClientDropdown && clientSearchQuery.length >= 2 && !clientSearching && clientResults.length === 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-3 text-sm text-gray-500 italic">
                  Aucun client trouvé
                </div>
              )}
            </div>
          </>
        )}
      </>
    )}
  </div>
);

// ============================================================================
// CONTACT
// ============================================================================

export const SectionContact = ({ form, setField, contactFieldsDisabled }) => (
  <>
    <SectionTitle>Contact</SectionTitle>

    <div className="grid grid-cols-2 gap-3">
      <FormField label="Prénom">
        <input
          type="text"
          value={form.first_name}
          onChange={(e) => setField('first_name', e.target.value)}
          className={inputClass}
          placeholder="Prénom"
          disabled={contactFieldsDisabled}
        />
      </FormField>
      <FormField label="Nom" required>
        <input
          type="text"
          value={form.last_name}
          onChange={(e) => setField('last_name', e.target.value)}
          className={inputClass}
          placeholder="Nom *"
          disabled={contactFieldsDisabled}
        />
      </FormField>
    </div>

    <FormField label="Société / Entreprise" className="mt-3">
      <input
        type="text"
        value={form.company_name}
        onChange={(e) => setField('company_name', e.target.value)}
        className={inputClass}
        placeholder="Optionnel — rempli si B2B"
        disabled={contactFieldsDisabled}
      />
    </FormField>

    <div className="grid grid-cols-2 gap-3 mt-3">
      <FormField label="Téléphone">
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setField('phone', formatPhoneNumber(e.target.value))}
            className={`${inputClass} pl-9`}
            placeholder="06 00 00 00 00"
            disabled={contactFieldsDisabled}
          />
        </div>
      </FormField>
      <FormField label="Tél. secondaire">
        <input
          type="tel"
          value={form.phone_secondary}
          onChange={(e) => setField('phone_secondary', formatPhoneNumber(e.target.value))}
          className={inputClass}
          placeholder="Optionnel"
          disabled={contactFieldsDisabled}
        />
      </FormField>
    </div>

    <FormField label="Email" className="mt-3">
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="email"
          value={form.email}
          onChange={(e) => setField('email', e.target.value)}
          className={`${inputClass} pl-9`}
          placeholder="email@exemple.fr"
          disabled={contactFieldsDisabled}
        />
      </div>
    </FormField>

    <FormField label="Adresse" className="mt-3">
      <div className="relative">
        <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={form.address}
          onChange={(e) => setField('address', e.target.value)}
          className={`${inputClass} pl-9`}
          placeholder="Adresse"
          disabled={contactFieldsDisabled}
        />
      </div>
    </FormField>

    <input
      type="text"
      value={form.address_complement}
      onChange={(e) => setField('address_complement', e.target.value)}
      className={`${inputClass} mt-2`}
      placeholder="Complément d'adresse"
      disabled={contactFieldsDisabled}
    />

    <div className="grid grid-cols-3 gap-3 mt-2">
      <FormField label="CP">
        <input
          type="text"
          value={form.postal_code}
          onChange={(e) => setField('postal_code', e.target.value.replace(/\D/g, '').slice(0, 5))}
          className={inputClass}
          placeholder="81600"
          maxLength={5}
          disabled={contactFieldsDisabled}
        />
      </FormField>
      <FormField label="Ville" className="col-span-2">
        <input
          type="text"
          value={form.city}
          onChange={(e) => setField('city', e.target.value)}
          className={inputClass}
          placeholder="Gaillac"
          disabled={contactFieldsDisabled}
        />
      </FormField>
    </div>
  </>
);

// ============================================================================
// PIPELINE
// ============================================================================

export const SectionPipeline = ({
  form,
  setField,
  isEditing,
  currentStatus,
  statuses,
  sources,
  commercials,
  groupedEquipmentTypes,
  isFinal,
  isWon,
  // Lost reason
  pendingLostStatusId,
  lostReasonInput,
  setLostReasonInput,
  handleConfirmLost,
  setPendingLostStatusId,
  isChangingStatus,
  // Scheduling
  pendingRdvStatusId,
  setPendingRdvStatusId,
  lead,
  orgId,
  handleConfirmScheduling,
  schedulingLoading,
  canAssign = true,
}) => (
  <>
    <SectionTitle>Pipeline</SectionTitle>

    <FormField label="Source">
      <div className="relative">
        <select
          value={form.source_id}
          onChange={(e) => setField('source_id', e.target.value)}
          className={selectClass}
        >
          <option value="">— Source —</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      </div>
    </FormField>

    {/* Formulaire motif de perte (inline quand passage en Perdu) */}
    {pendingLostStatusId && (
      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
        <p className="text-sm font-medium text-red-800">
          Motif de perte (objection) *
        </p>
        <select
          value={lostReasonInput}
          onChange={(e) => setLostReasonInput(e.target.value)}
          className={`${inputClass} border-red-300 focus:ring-red-500 focus:border-red-500`}
          autoFocus
        >
          <option value="">— Sélectionner —</option>
          {LOST_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleConfirmLost}
            disabled={isChangingStatus}
            className="bg-red-600 hover:bg-red-700 min-h-[36px]"
          >
            {isChangingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmer Perdu'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPendingLostStatusId(null)}
            className="min-h-[36px]"
          >
            Annuler
          </Button>
        </div>
      </div>
    )}

    {/* SchedulingPanel rendu en overlay dans LeadModal */}

    <FormField label="Équipement concerné" className="mt-3">
      <div className="relative">
        <select
          value={form.equipment_type_id}
          onChange={(e) => setField('equipment_type_id', e.target.value)}
          className={selectClass}
        >
          <option value="">—</option>
          {Object.entries(groupedEquipmentTypes).map(([category, types]) => (
            <optgroup key={category} label={EQUIPMENT_CATEGORY_LABELS[category] || category}>
              {types.map((type) => (
                <option key={type.id} value={type.id}>{type.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      </div>
    </FormField>

    <div className={`grid ${canAssign ? 'grid-cols-2' : 'grid-cols-1'} gap-3 mt-3`}>
      {canAssign && (
        <FormField label="Commercial assigné">
          <div className="relative">
            <select
              value={form.assigned_user_id}
              onChange={(e) => setField('assigned_user_id', e.target.value)}
              className={selectClass}
            >
              <option value="">— Non assigné —</option>
              {commercials.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
        </FormField>
      )}

      <FormField label="Probabilité (%)">
        <input
          type="number"
          min="0"
          max="100"
          value={form.probability}
          onChange={(e) => setField('probability', e.target.value)}
          className={inputClass}
        />
      </FormField>
    </div>

    <FormField label="Montant HT (€)" className="mt-3">
      <div className="relative">
        <Euro className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="number"
          min="0"
          step="100"
          value={form.order_amount_ht}
          onChange={(e) => setField('order_amount_ht', e.target.value)}
          className={`${inputClass} pl-9`}
          placeholder="0"
        />
      </div>
    </FormField>

    {/* Raison perdue (si statut Perdu) */}
    {isFinal && !isWon && (
      <FormField label="Raison de perte" className="mt-3">
        <select
          value={form.lost_reason}
          onChange={(e) => setField('lost_reason', e.target.value)}
          className={inputClass}
        >
          <option value="">— Sélectionner —</option>
          {LOST_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </FormField>
    )}
  </>
);

// ============================================================================
// SUIVI PIPELINE (dates)
// ============================================================================

export const SectionSuivi = ({ form, setField, currentStatus, isWon, lead, onLogCall, onLogFollowup, callActivities = [], followupActivities = [] }) => (
  <>
    <SectionTitle>Suivi pipeline</SectionTitle>

    {/* Contacté : liste appels + bouton ajouter + checkbox mail */}
    {currentStatus.display_order >= 2 && (
      <div className="space-y-2">
        {/* Header appels + bouton */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <Phone className="h-4 w-4 text-amber-500" />
            Appels ({lead?.call_count || 0})
          </span>
          {onLogCall && (
            <button
              type="button"
              onClick={onLogCall}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
            >
              <Plus className="h-3 w-3" />
              Appel
            </button>
          )}
        </div>

        {/* Liste des appels */}
        {callActivities.length > 0 ? (
          <div className="space-y-1">
            {callActivities.map((act) => {
              const isNoAnswer = act.description?.includes('Pas de réponse');
              const isCallback = act.description?.includes('rappeler');
              return (
                <div key={act.id} className="flex items-center gap-2 py-1.5 px-3 bg-gray-50 rounded-lg text-sm">
                  <PhoneOutgoing className={`h-3.5 w-3.5 shrink-0 ${isNoAnswer ? 'text-red-400' : isCallback ? 'text-amber-500' : 'text-gray-400'}`} />
                  <span className="text-gray-500 tabular-nums">
                    {new Date(act.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </span>
                  <span className={`font-medium ${isNoAnswer ? 'text-red-600' : isCallback ? 'text-amber-600' : 'text-gray-600'}`}>
                    {isNoAnswer ? 'Pas de réponse' : isCallback ? 'À rappeler' : (act.description || 'Appel')}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic px-3">Aucun appel enregistré</p>
        )}

        {/* Checkbox mail envoyé */}
        <div className="flex items-center gap-2 py-2 px-3 bg-gray-50 rounded-lg">
          <Checkbox
            id="email_sent"
            checked={form.email_sent || false}
            onCheckedChange={(checked) => setField('email_sent', !!checked)}
          />
          <Label htmlFor="email_sent" className="flex items-center gap-2 text-sm cursor-pointer">
            <MailCheck className="h-4 w-4 text-blue-500" />
            Mail envoyé
          </Label>
        </div>
      </div>
    )}

    {/* RDV planifié : date du RDV */}
    {currentStatus.display_order >= 3 && (
      <FormField label="Date du RDV" className="mt-3">
        <div className="relative">
          <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="date"
            value={form.appointment_date}
            onChange={(e) => setField('appointment_date', e.target.value)}
            className={`${inputClass} pl-9`}
          />
        </div>
      </FormField>
    )}

    {/* Devis envoyé : date d'envoi */}
    {currentStatus.display_order >= 4 && (
      <FormField label="Date d'envoi du devis" className="mt-3">
        <div className="relative">
          <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="date"
            value={form.quote_sent_date}
            onChange={(e) => setField('quote_sent_date', e.target.value)}
            className={`${inputClass} pl-9`}
          />
        </div>
      </FormField>
    )}

    {/* Devis envoyé : suivi relances */}
    {currentStatus.display_order >= 4 && !isWon && (
      <div className="space-y-2 mt-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <PhoneForwarded className="h-4 w-4 text-purple-500" />
            Relances ({lead?.followup_count || 0})
          </span>
          {onLogFollowup && (
            <button
              type="button"
              onClick={onLogFollowup}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-purple-700 bg-purple-100 hover:bg-purple-200 rounded-lg transition-colors"
            >
              <Plus className="h-3 w-3" />
              Relance
            </button>
          )}
        </div>

        {followupActivities.length > 0 ? (
          <div className="space-y-1">
            {followupActivities.map((act) => (
              <div key={act.id} className="flex items-center gap-2 py-1.5 px-3 bg-gray-50 rounded-lg text-sm">
                <PhoneForwarded className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                <span className="text-gray-500 tabular-nums">
                  {new Date(act.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                </span>
                <span className="font-medium text-gray-600 truncate">
                  {act.description || 'Relance'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic px-3">Aucune relance enregistrée</p>
        )}
      </div>
    )}

    {/* Gagné : date de signature */}
    {isWon && (
      <FormField label="Date de signature" className="mt-3">
        <div className="relative">
          <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="date"
            value={form.won_date}
            onChange={(e) => setField('won_date', e.target.value)}
            className={`${inputClass} pl-9`}
          />
        </div>
      </FormField>
    )}
  </>
);

// ============================================================================
// ACTIONS SUIVANTES (transitions) + ACTIONS LEAD (conversion)
// ============================================================================

export const SectionActions = ({
  isEditing,
  allowedNext,
  isChangingStatus,
  handleStatusChange,
  isFinal,
  isWon,
  lead,
  showConvertConfirm,
  setShowConvertConfirm,
  handleConvert,
  isConverting,
}) => (
  <>
    {/* Action suivante (transitions) */}
    {isEditing && allowedNext.length > 0 && (
      <>
        <SectionTitle>Action suivante</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {allowedNext.map((status) => {
            const isPerdu = status.label === 'Perdu';
            return (
              <button
                key={status.id}
                type="button"
                onClick={() => handleStatusChange(status.id)}
                disabled={isChangingStatus}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]
                  ${isPerdu
                    ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                    : 'text-white hover:opacity-90'
                  }`}
                style={isPerdu ? {} : { backgroundColor: status.color }}
              >
                {isChangingStatus ? (
                  <Loader2 className="h-4 w-4 animate-spin inline mr-1" />
                ) : (
                  <ArrowRightLeft className="h-4 w-4 inline mr-1" />
                )}
                {status.label}
              </button>
            );
          })}
        </div>
      </>
    )}

    {isFinal && (
      <div className="mt-6 px-3 py-2.5 bg-gray-50 rounded-lg text-sm text-gray-500 italic flex items-center gap-2">
        <Target className="h-4 w-4" />
        {isWon ? 'Lead gagné — prêt à convertir en client' : 'Lead clôturé'}
      </div>
    )}

    {/* Bloc "Actions" supprimé — conversion auto lors de l'acceptation du devis */}
  </>
);

// ============================================================================
// NOTES + TIMELINE
// ============================================================================

export const SectionNotes = ({
  form,
  setField,
  isEditing,
  activities,
  loadingActivities,
  handleAddNote,
  isAddingNote,
  leadId,
  onOpenFicheTechnique,
  devisSlot,
}) => {
  // Charger le statut de la fiche technique (uniquement si lead existant)
  const { visit } = useTechnicalVisit(isEditing ? leadId : null);
  const ficheStatus = computeVisitStatus(visit);
  const ficheConfig = FICHE_STATUS_CONFIG[ficheStatus];

  return (
    <>
      {/* CTA Fiche technique terrain */}
      {isEditing && (
        <>
          <SectionTitle>Information chiffrage</SectionTitle>

          <button
            type="button"
            onClick={onOpenFicheTechnique}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white
                       hover:border-blue-300 hover:bg-blue-50/50 transition-colors group text-left"
          >
            <FileText className="h-5 w-5 text-blue-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-gray-900 group-hover:text-blue-700">
                Fiche technique terrain
              </span>
              {visit?.locked && (
                <span className="text-xs text-amber-600 ml-2">Verrouillée</span>
              )}
            </div>
            <Badge className={`${ficheConfig.color} text-xs shrink-0`}>
              {ficheConfig.label}
            </Badge>
            <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-blue-500 shrink-0" />
          </button>
        </>
      )}

      {/* Devis (injecté entre fiche technique et notes) */}
      {devisSlot}

      <SectionTitle>Notes</SectionTitle>

      <textarea
        value={form.notes}
        onChange={(e) => setField('notes', e.target.value)}
        className={`${inputClass} min-h-[100px] resize-y`}
        placeholder="Notes internes..."
        rows={3}
      />

      {isEditing && (
        <>
          <SectionTitle>Historique</SectionTitle>
          <LeadActivityTimeline
            activities={activities}
            isLoading={loadingActivities}
            disabled
          />
        </>
      )}
    </>
  );
};

// ============================================================================
// DEVIS (QUOTES)
// ============================================================================

// SectionDevis extrait dans ../devis/SectionDevis.jsx
