/**
 * ContractStepClient.jsx
 * ============================================================================
 * Étape 1 du wizard contrat : Sélection / Création client
 * Extrait de CreateContractModal.jsx
 * ============================================================================
 */

import {
  Search,
  UserPlus,
  AlertTriangle,
  AlertCircle,
  Check,
  User,
  Loader2,
} from 'lucide-react';
import { FormField, TextInput, SelectInput } from '../FormFields';

// ============================================================================
// CONSTANTES
// ============================================================================

const CLIENT_CATEGORIES = [
  { value: 'particulier', label: 'Particulier' },
  { value: 'entreprise', label: 'Entreprise' },
];

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

const SearchResultCard = ({ client, onSelect, selected = false }) => {
  const hasContract = client.has_active_contract === true;
  const clientName = client.display_name || `${client.last_name || ''} ${client.first_name || ''}`.trim() || 'Client sans nom';

  return (
    <button
      type="button"
      onClick={() => onSelect(client)}
      className={`
        w-full flex items-center justify-between gap-3 p-3 rounded-lg border text-left
        transition-colors duration-150
        ${selected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        }
      `}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-gray-600" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{clientName}</p>
          <p className="text-sm text-gray-500 truncate">
            {[client.postal_code, client.city].filter(Boolean).join(' ')}
            {client.client_number && ` · ${client.client_number}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {hasContract && (
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 border border-green-200">
            Contrat actif
          </span>
        )}
        {selected && <Check className="w-4 h-4 text-blue-600" />}
      </div>
    </button>
  );
};

const DuplicateCard = ({ client, onChoose }) => (
  <div className="flex items-center justify-between gap-3 px-3 py-2 bg-amber-50 rounded-lg border border-amber-200">
    <div className="min-w-0">
      <p className="text-sm font-medium text-amber-900 truncate">
        {client.display_name || `${client.last_name || ''} ${client.first_name || ''}`.trim()}
      </p>
      <p className="text-xs text-amber-700 truncate">
        {[client.postal_code, client.city].filter(Boolean).join(' ')}
        {client.has_active_contract && ' · Contrat actif'}
      </p>
    </div>
    <button
      type="button"
      onClick={() => onChoose(client)}
      className="text-xs font-medium text-amber-800 hover:text-amber-900 underline flex-shrink-0"
    >
      Choisir
    </button>
  </div>
);

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function Step1Client({
  clientMode,
  selectedClient,
  searchQuery,
  searchResults,
  searching,
  newClientData,
  duplicates,
  checkingDuplicates,
  duplicateAcknowledged,
  selectedClientHasContract,
  searchInputRef,
  onSearchChange,
  onSelectClient,
  onSwitchToCreate,
  onSwitchToSearch,
  onClientDataChange,
  onChooseDuplicate,
  onAcknowledgeDuplicates,
}) {
  return (
    <div className="space-y-5">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSwitchToSearch}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
            clientMode === 'search'
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Search className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          Client existant
        </button>
        <button
          type="button"
          onClick={onSwitchToCreate}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
            clientMode === 'create'
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <UserPlus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          Nouveau client
        </button>
      </div>

      {/* ===== MODE RECHERCHE ===== */}
      {clientMode === 'search' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Rechercher par nom, ville, code postal..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 text-sm
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                placeholder:text-gray-400 transition-colors"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
            )}
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {searchResults.map((client) => (
                <SearchResultCard
                  key={client.id}
                  client={client}
                  onSelect={onSelectClient}
                  selected={selectedClient?.id === client.id}
                />
              ))}
            </div>
          )}

          {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
            <div className="text-center py-6 text-gray-500">
              <p className="text-sm">Aucun client trouvé</p>
              <button
                type="button"
                onClick={onSwitchToCreate}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                + Créer un nouveau client
              </button>
            </div>
          )}

          {selectedClientHasContract && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Ce client a déjà un contrat actif</p>
                <p className="text-xs text-red-600 mt-0.5">
                  Un seul contrat par client est autorisé. Sélectionnez un autre client.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== MODE CRÉATION ===== */}
      {clientMode === 'create' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Nom" required>
              <TextInput
                value={newClientData.lastName}
                onChange={(val) => onClientDataChange('lastName', val)}
                placeholder="DUPONT"
              />
            </FormField>
            <FormField label="Prénom">
              <TextInput
                value={newClientData.firstName}
                onChange={(val) => onClientDataChange('firstName', val)}
                placeholder="Jean"
              />
            </FormField>
          </div>

          <FormField label="Catégorie">
            <SelectInput
              value={newClientData.clientCategory}
              onChange={(val) => onClientDataChange('clientCategory', val)}
              options={CLIENT_CATEGORIES}
            />
          </FormField>

          <FormField label="Adresse">
            <TextInput
              value={newClientData.address}
              onChange={(val) => onClientDataChange('address', val)}
              placeholder="12 rue des Lilas"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Code postal">
              <TextInput
                value={newClientData.postalCode}
                onChange={(val) => onClientDataChange('postalCode', val)}
                placeholder="81600"
                maxLength={5}
              />
            </FormField>
            <FormField label="Ville">
              <TextInput
                value={newClientData.city}
                onChange={(val) => onClientDataChange('city', val)}
                placeholder="Gaillac"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Téléphone">
              <TextInput
                value={newClientData.phone}
                onChange={(val) => onClientDataChange('phone', val)}
                placeholder="06 12 34 56 78"
                type="tel"
              />
            </FormField>
            <FormField label="Email">
              <TextInput
                value={newClientData.email}
                onChange={(val) => onClientDataChange('email', val)}
                placeholder="jean@email.com"
                type="email"
              />
            </FormField>
          </div>

          {/* Détection doublons */}
          {duplicates.length > 0 && !duplicateAcknowledged && (
            <div className="space-y-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <p className="text-sm font-medium text-amber-800">
                  {duplicates.length === 1 ? 'Client similaire détecté' : `${duplicates.length} clients similaires détectés`}
                </p>
              </div>
              <div className="space-y-1.5">
                {duplicates.map((dup) => (
                  <DuplicateCard key={dup.id} client={dup} onChoose={onChooseDuplicate} />
                ))}
              </div>
              <button
                type="button"
                onClick={onAcknowledgeDuplicates}
                className="mt-2 text-xs font-medium text-amber-700 hover:text-amber-900 underline"
              >
                Ignorer et créer un nouveau client
              </button>
            </div>
          )}

          {checkingDuplicates && newClientData.lastName.length >= 2 && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Vérification des doublons...
            </div>
          )}

          {newClientData.lastName.length >= 2 && !checkingDuplicates && duplicates.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <Check className="w-3.5 h-3.5" />
              Aucun doublon détecté
            </div>
          )}
        </div>
      )}
    </div>
  );
}
