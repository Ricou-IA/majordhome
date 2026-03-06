/**
 * CreateContractModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale centrée pour la création d'un contrat d'entretien.
 * 3 étapes :
 *   1. Sélection/Création client (recherche existant OU formulaire nouveau client)
 *   2. Sélection famille d'équipements + calcul tarif temps réel
 *   3. Détails du contrat (dates, notes) + résumé tarifaire
 *
 * Moteur de tarification :
 *   - Zone auto-détectée depuis CP client (overridable)
 *   - Prix calculé depuis pricing_rates (zone × type d'équipement)
 *   - Remises volume automatiques (2 équipements = -10%, 3+ = -15%)
 *
 * @version 2.0.0 - Ajout étape équipement + moteur tarification
 * @version 1.0.0 - Création initiale (2 étapes)
 * ============================================================================
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Search,
  Plus,
  Minus,
  ArrowLeft,
  ArrowRight,
  UserPlus,
  AlertTriangle,
  AlertCircle,
  Check,
  User,
  FileText,
  Loader2,
  MapPin,
  Wrench,
  Calculator,
  Tag,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useClientSearch, useDuplicateCheck } from '@hooks/useClients';
import { useCreateContractWithClient } from '@hooks/useContracts';
import { usePricingData, usePricingCalculator } from '@hooks/usePricing';
import { pricingService, EQUIPMENT_TYPE_CATEGORIES } from '@services/pricing.service';
import { MAINTENANCE_MONTHS } from '@services/contracts.service';

// ============================================================================
// CONSTANTES
// ============================================================================

const CLIENT_CATEGORIES = [
  { value: 'particulier', label: 'Particulier' },
  { value: 'entreprise', label: 'Entreprise' },
];

const INITIAL_CLIENT_DATA = {
  lastName: '',
  firstName: '',
  email: '',
  phone: '',
  address: '',
  postalCode: '',
  city: '',
  clientCategory: 'particulier',
};

const INITIAL_CONTRACT_DATA = {
  startDate: new Date().toISOString().split('T')[0],
  maintenanceMonth: '',
  notes: '',
};

// ============================================================================
// SOUS-COMPOSANTS COMMUNS
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

const StepIndicator = ({ current, total }) => (
  <div className="flex items-center gap-2">
    {Array.from({ length: total }, (_, i) => (
      <div
        key={i}
        className={`h-1.5 rounded-full transition-all ${
          i < current ? 'w-8 bg-blue-600' : i === current ? 'w-8 bg-blue-400' : 'w-6 bg-gray-200'
        }`}
      />
    ))}
    <span className="text-xs text-gray-500 ml-1">
      Étape {current + 1}/{total}
    </span>
  </div>
);

const FormField = ({ label, required = false, children, className = '' }) => (
  <div className={className}>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

const StyledInput = ({ className = '', ...props }) => (
  <input
    className={`w-full px-3 py-2 rounded-lg border border-gray-300 text-sm
      focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
      placeholder:text-gray-400 transition-colors ${className}`}
    {...props}
  />
);

const StyledSelect = ({ options = [], placeholder = '', className = '', ...props }) => (
  <select
    className={`w-full px-3 py-2 rounded-lg border border-gray-300 text-sm
      focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
      transition-colors ${className}`}
    {...props}
  >
    {placeholder && <option value="">{placeholder}</option>}
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
);

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function CreateContractModal({ isOpen, onClose, onSuccess }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;

  // ========== State machine ==========
  const [step, setStep] = useState(0); // 0 = client, 1 = équipements, 2 = contrat
  const [clientMode, setClientMode] = useState('search');
  const [selectedClient, setSelectedClient] = useState(null);
  const [newClientData, setNewClientData] = useState(INITIAL_CLIENT_DATA);
  const [contractData, setContractData] = useState(INITIAL_CONTRACT_DATA);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // ========== Hooks ==========
  const { results: searchResults, searching, search: performSearch, clear: clearSearch } = useClientSearch(orgId, {
    debounceMs: 300,
    minChars: 2,
  });
  const { duplicates, isChecking: checkingDuplicates } = useDuplicateCheck(
    orgId,
    clientMode === 'create' ? newClientData.lastName : '',
    clientMode === 'create' ? newClientData.postalCode : ''
  );
  const { createContractWithClient, isCreating } = useCreateContractWithClient();

  // Pricing
  const pricingData = usePricingData();
  const clientPostalCode = useMemo(() => {
    if (clientMode === 'search' && selectedClient) return selectedClient.postal_code || '';
    if (clientMode === 'create') return newClientData.postalCode || '';
    return '';
  }, [clientMode, selectedClient, newClientData.postalCode]);

  const calculator = usePricingCalculator(pricingData, clientPostalCode);

  // ========== Refs ==========
  const searchInputRef = useRef(null);

  // ========== Effects ==========

  // Reset à l'ouverture
  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setClientMode('search');
      setSelectedClient(null);
      setNewClientData(INITIAL_CLIENT_DATA);
      setContractData(INITIAL_CONTRACT_DATA);
      setDuplicateAcknowledged(false);
      setSearchQuery('');
      clearSearch();
      calculator.reset();
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ========== Handlers ==========

  const handleSearchChange = useCallback((e) => {
    const value = e.target.value;
    setSearchQuery(value);
    performSearch(value);
  }, [performSearch]);

  const handleSelectClient = useCallback((client) => {
    setSelectedClient(client);
    setClientMode('search');
  }, []);

  const handleChooseDuplicate = useCallback((client) => {
    setSelectedClient(client);
    setClientMode('search');
    setDuplicateAcknowledged(false);
  }, []);

  const handleSwitchToCreate = useCallback(() => {
    setClientMode('create');
    setSelectedClient(null);
    setDuplicateAcknowledged(false);
  }, []);

  const handleSwitchToSearch = useCallback(() => {
    setClientMode('search');
    setNewClientData(INITIAL_CLIENT_DATA);
    setDuplicateAcknowledged(false);
  }, []);

  const handleClientDataChange = useCallback((field, value) => {
    setNewClientData((prev) => ({ ...prev, [field]: value }));
    if (field === 'lastName' || field === 'postalCode') {
      setDuplicateAcknowledged(false);
    }
  }, []);

  const handleContractDataChange = useCallback((field, value) => {
    setContractData((prev) => ({ ...prev, [field]: value }));
  }, []);

  // ========== Validation ==========

  const hasDuplicates = clientMode === 'create' && duplicates.length > 0 && !duplicateAcknowledged;
  const selectedClientHasContract = selectedClient?.has_active_contract === true;

  const canGoToStep1 = (() => {
    if (clientMode === 'search') return selectedClient && !selectedClientHasContract;
    if (clientMode === 'create') return newClientData.lastName.trim().length >= 2 && !hasDuplicates;
    return false;
  })();

  const canGoToStep2 = calculator.hasItems;

  // ========== Submit ==========

  const handleSubmit = useCallback(async () => {
    if (isCreating) return;

    const params = {
      orgId,
      userId,
      contractData: {
        status: 'active',
        amount: calculator.pricing.total || null,
        subtotal: calculator.pricing.subtotal || null,
        discountPercent: calculator.pricing.discountPercent || null,
        zoneId: calculator.activeZone?.id || null,
        startDate: contractData.startDate || null,
        maintenanceMonth: contractData.maintenanceMonth || null,
        notes: contractData.notes || null,
      },
    };

    if (clientMode === 'search' && selectedClient) {
      params.existingClientId = selectedClient.id;
    } else if (clientMode === 'create') {
      params.newClientData = { ...newClientData };
    }

    const result = await createContractWithClient(params);

    if (result.error) {
      const msg = result.error.message || 'Erreur lors de la création';
      if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('23505')) {
        toast.error('Ce client possède déjà un contrat actif');
      } else {
        toast.error(msg);
      }
      return;
    }

    // Sauvegarder les lignes tarifaires
    const contractId = result.data?.contract?.id;
    if (contractId && calculator.hasItems) {
      const itemsToSave = calculator.getItemsForSave();
      const saveResult = await pricingService.saveContractPricingItems(contractId, itemsToSave);
      if (saveResult.error) {
        console.warn('[CreateContractModal] Erreur sauvegarde pricing items:', saveResult.error);
        // On ne bloque pas — le contrat est créé, les items pourront être ajoutés plus tard
      }
    }

    toast.success('Contrat créé avec succès');
    onClose();
    onSuccess?.();
  }, [isCreating, orgId, userId, calculator, contractData, clientMode, selectedClient, newClientData, createContractWithClient, onClose, onSuccess]);

  // ========== Render ==========

  if (!isOpen) return null;

  // Adapter la largeur selon l'étape
  const modalWidth = step === 1 ? 'max-w-2xl' : 'max-w-lg';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Modale centrée */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className={`bg-white rounded-xl shadow-2xl w-full ${modalWidth} max-h-[90vh] flex flex-col overflow-hidden transition-all`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ===== HEADER ===== */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Nouveau contrat</h2>
              <StepIndicator current={step} total={3} />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ===== BODY (scrollable) ===== */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {step === 0 && (
              <Step1Client
                clientMode={clientMode}
                selectedClient={selectedClient}
                searchQuery={searchQuery}
                searchResults={searchResults}
                searching={searching}
                newClientData={newClientData}
                duplicates={duplicates}
                checkingDuplicates={checkingDuplicates}
                duplicateAcknowledged={duplicateAcknowledged}
                selectedClientHasContract={selectedClientHasContract}
                searchInputRef={searchInputRef}
                onSearchChange={handleSearchChange}
                onSelectClient={handleSelectClient}
                onSwitchToCreate={handleSwitchToCreate}
                onSwitchToSearch={handleSwitchToSearch}
                onClientDataChange={handleClientDataChange}
                onChooseDuplicate={handleChooseDuplicate}
                onAcknowledgeDuplicates={() => setDuplicateAcknowledged(true)}
              />
            )}

            {step === 1 && (
              <Step2Equipment
                pricingData={pricingData}
                calculator={calculator}
                clientPostalCode={clientPostalCode}
              />
            )}

            {step === 2 && (
              <Step3Contract
                selectedClient={selectedClient}
                newClientData={newClientData}
                clientMode={clientMode}
                contractData={contractData}
                calculator={calculator}
                onContractDataChange={handleContractDataChange}
              />
            )}
          </div>

          {/* ===== FOOTER ===== */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
            {step === 0 && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={!canGoToStep1}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg
                    hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Suivant
                  <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}

            {step === 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Retour
                </button>
                <div className="flex items-center gap-3">
                  {calculator.hasItems && (
                    <span className="text-sm font-semibold text-gray-900">
                      {calculator.pricing.total.toFixed(2)} €
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    disabled={!canGoToStep2}
                    className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg
                      hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Suivant
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={isCreating}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Retour
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isCreating}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg
                    hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Création...
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      Créer le contrat
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// ÉTAPE 1 — SÉLECTION / CRÉATION CLIENT
// ============================================================================

function Step1Client({
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
              <StyledInput
                type="text"
                value={newClientData.lastName}
                onChange={(e) => onClientDataChange('lastName', e.target.value)}
                placeholder="DUPONT"
              />
            </FormField>
            <FormField label="Prénom">
              <StyledInput
                type="text"
                value={newClientData.firstName}
                onChange={(e) => onClientDataChange('firstName', e.target.value)}
                placeholder="Jean"
              />
            </FormField>
          </div>

          <FormField label="Catégorie">
            <StyledSelect
              value={newClientData.clientCategory}
              onChange={(e) => onClientDataChange('clientCategory', e.target.value)}
              options={CLIENT_CATEGORIES}
            />
          </FormField>

          <FormField label="Adresse">
            <StyledInput
              type="text"
              value={newClientData.address}
              onChange={(e) => onClientDataChange('address', e.target.value)}
              placeholder="12 rue des Lilas"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Code postal">
              <StyledInput
                type="text"
                value={newClientData.postalCode}
                onChange={(e) => onClientDataChange('postalCode', e.target.value)}
                placeholder="81600"
                maxLength={5}
              />
            </FormField>
            <FormField label="Ville">
              <StyledInput
                type="text"
                value={newClientData.city}
                onChange={(e) => onClientDataChange('city', e.target.value)}
                placeholder="Gaillac"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Téléphone">
              <StyledInput
                type="tel"
                value={newClientData.phone}
                onChange={(e) => onClientDataChange('phone', e.target.value)}
                placeholder="06 12 34 56 78"
              />
            </FormField>
            <FormField label="Email">
              <StyledInput
                type="email"
                value={newClientData.email}
                onChange={(e) => onClientDataChange('email', e.target.value)}
                placeholder="jean@email.com"
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

// ============================================================================
// ÉTAPE 2 — SÉLECTION ÉQUIPEMENTS + TARIFICATION
// ============================================================================

function Step2Equipment({ pricingData, calculator, clientPostalCode }) {
  const { equipmentTypes, zones, isLoading: loadingPricing, error: pricingError } = pricingData;
  const { activeZone, items, pricing, addItem, removeItem, updateItemQuantity } = calculator;

  // Grouper les types d'équipements par catégorie
  const groupedTypes = useMemo(() => {
    if (!equipmentTypes?.length) return [];
    const groups = {};
    for (const et of equipmentTypes) {
      if (!groups[et.category]) {
        const catInfo = EQUIPMENT_TYPE_CATEGORIES.find((c) => c.value === et.category);
        groups[et.category] = { category: et.category, label: catInfo?.label || et.category, items: [] };
      }
      groups[et.category].items.push(et);
    }
    return Object.values(groups);
  }, [equipmentTypes]);

  // Set des IDs sélectionnés pour lookup rapide
  const selectedIds = useMemo(
    () => new Set(items.map((item) => item.equipmentTypeId)),
    [items]
  );

  if (loadingPricing) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        <span className="ml-2 text-sm text-gray-500">Chargement des tarifs...</span>
      </div>
    );
  }

  if (pricingError || (!loadingPricing && equipmentTypes?.length === 0)) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-900 mb-1">Impossible de charger les tarifs</p>
        <p className="text-xs text-gray-500">
          {pricingError?.message || 'La grille tarifaire est vide. Contactez l\'administrateur.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Zone tarifaire — lecture seule, calculée depuis le code postal */}
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <MapPin className="w-4 h-4 text-blue-600 flex-shrink-0" />
        <span className="text-sm text-blue-800">
          {activeZone ? (
            <>
              <strong>{activeZone.label}</strong>
              <span className="text-blue-600 ml-1">
                (CP {clientPostalCode}{activeZone.supplement > 0 ? ` · +${parseFloat(activeZone.supplement).toFixed(0)}€ déplacement` : ''})
              </span>
            </>
          ) : (
            <span className="text-amber-700">Code postal non renseigné — zone par défaut appliquée</span>
          )}
        </span>
      </div>

      {/* Sélecteur d'équipements par catégorie */}
      <div className="space-y-4">
        {groupedTypes.map((group) => (
          <div key={group.category}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {group.label}
            </h4>
            <div className="space-y-1.5">
              {group.items.map((et) => {
                const isSelected = selectedIds.has(et.id);
                const selectedItem = items.find((item) => item.equipmentTypeId === et.id);
                // Trouver le tarif pour cette zone
                const rate = pricingData.rates?.find(
                  (r) =>
                    (r.zone_id === activeZone?.id || r.zone?.id === activeZone?.id) &&
                    (r.equipment_type_id === et.id || r.equipment_type?.id === et.id)
                );
                const price = rate ? parseFloat(rate.price) : 0;
                const unitPrice = rate ? parseFloat(rate.unit_price) : 0;

                return (
                  <div
                    key={et.id}
                    className={`
                      flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer
                      transition-all duration-150
                      ${isSelected
                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }
                    `}
                    onClick={() => {
                      if (isSelected) {
                        const idx = items.findIndex((item) => item.equipmentTypeId === et.id);
                        if (idx >= 0) removeItem(idx);
                      } else {
                        addItem(et.id, et.has_unit_pricing ? (et.included_units || 1) : 1);
                      }
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Checkbox visuel */}
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>

                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                          {et.label}
                        </p>
                        {et.has_unit_pricing && unitPrice > 0 && (
                          <p className="text-xs text-gray-500">
                            {et.included_units > 0
                              ? `${et.included_units} ${et.unit_label} inclus, +${unitPrice.toFixed(0)}€/${et.unit_label} suppl.`
                              : `${unitPrice.toFixed(0)}€ / ${et.unit_label}`
                            }
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      {/* Quantité pour unit pricing */}
                      {isSelected && et.has_unit_pricing && (
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              const idx = items.findIndex((item) => item.equipmentTypeId === et.id);
                              if (idx >= 0) updateItemQuantity(idx, (selectedItem?.quantity || 1) - 1);
                            }}
                            className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-8 text-center text-sm font-medium">
                            {selectedItem?.quantity || 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const idx = items.findIndex((item) => item.equipmentTypeId === et.id);
                              if (idx >= 0) updateItemQuantity(idx, (selectedItem?.quantity || 1) + 1);
                            }}
                            className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Prix */}
                      <span className={`text-sm font-semibold tabular-nums ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                        {isSelected && selectedItem
                          ? `${selectedItem.lineTotal?.toFixed(0) || price.toFixed(0)}€`
                          : et.has_unit_pricing && et.included_units === 0
                            ? `${unitPrice.toFixed(0)}€/${et.unit_label}`
                            : `${price.toFixed(0)}€`
                        }
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Récapitulatif tarif */}
      {items.length > 0 && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="w-4 h-4 text-gray-600" />
            <h4 className="text-sm font-semibold text-gray-700">Récapitulatif</h4>
          </div>

          {/* Lignes */}
          {items.map((item, idx) => (
            <div key={idx} className="flex justify-between text-sm">
              <span className="text-gray-600">
                {item.equipType?.label || item.equipmentTypeCode}
                {item.equipType?.has_unit_pricing && item.quantity > 1 && (
                  <span className="text-gray-400 ml-1">x{item.quantity}</span>
                )}
              </span>
              <span className="font-medium text-gray-900 tabular-nums">{item.lineTotal?.toFixed(2)}€</span>
            </div>
          ))}

          <div className="border-t border-gray-200 pt-2 mt-2" />

          {/* Sous-total */}
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Sous-total</span>
            <span className="font-medium text-gray-900 tabular-nums">{pricing.subtotal.toFixed(2)}€</span>
          </div>

          {/* Remise */}
          {pricing.discountPercent > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-green-700 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5" />
                Remise {items.filter((i) => i.basePrice > 0).length} equip. (-{pricing.discountPercent}%)
              </span>
              <span className="font-medium text-green-700 tabular-nums">-{pricing.discountAmount.toFixed(2)}€</span>
            </div>
          )}

          {/* Total */}
          <div className="flex justify-between text-base pt-1">
            <span className="font-semibold text-gray-900">Total annuel</span>
            <span className="font-bold text-blue-700 tabular-nums">{pricing.total.toFixed(2)}€</span>
          </div>
        </div>
      )}

      {/* Message si aucun équipement sélectionné */}
      {items.length === 0 && groupedTypes.length > 0 && (
        <div className="text-center py-4 text-gray-500">
          <Wrench className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm">Sélectionnez au moins un équipement pour calculer le tarif</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ÉTAPE 3 — DÉTAILS DU CONTRAT + RÉSUMÉ
// ============================================================================

function Step3Contract({
  selectedClient,
  newClientData,
  clientMode,
  contractData,
  calculator,
  onContractDataChange,
}) {
  const clientName =
    clientMode === 'search'
      ? selectedClient?.display_name || `${selectedClient?.last_name || ''} ${selectedClient?.first_name || ''}`.trim()
      : `${newClientData.lastName} ${newClientData.firstName}`.trim();

  const clientLocation =
    clientMode === 'search'
      ? [selectedClient?.postal_code, selectedClient?.city].filter(Boolean).join(' ')
      : [newClientData.postalCode, newClientData.city].filter(Boolean).join(' ');

  return (
    <div className="space-y-5">
      {/* Résumé client */}
      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-blue-600" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{clientName || 'Nouveau client'}</p>
          {clientLocation && (
            <p className="text-sm text-gray-500 truncate">{clientLocation}</p>
          )}
          {clientMode === 'create' && (
            <p className="text-xs text-blue-600 mt-0.5">Nouveau client — sera créé automatiquement</p>
          )}
        </div>
      </div>

      {/* Résumé tarification */}
      {calculator.hasItems && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-800 flex items-center gap-1.5">
              <Wrench className="w-4 h-4" />
              {calculator.items.length} équipement{calculator.items.length > 1 ? 's' : ''} · {calculator.activeZone?.code}
            </span>
            <span className="text-lg font-bold text-blue-700 tabular-nums">
              {calculator.pricing.total.toFixed(2)} €
            </span>
          </div>
          <div className="space-y-1">
            {calculator.items.map((item, idx) => (
              <p key={idx} className="text-xs text-blue-700">
                • {item.equipType?.label || item.equipmentTypeCode}
                {item.quantity > 1 && ` (×${item.quantity})`}
                {' — '}{item.lineTotal?.toFixed(0)}€
              </p>
            ))}
            {calculator.pricing.discountPercent > 0 && (
              <p className="text-xs text-green-700">
                • Remise -{calculator.pricing.discountPercent}% : -{calculator.pricing.discountAmount.toFixed(0)}€
              </p>
            )}
          </div>
        </div>
      )}

      {/* Séparateur */}
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t border-gray-200" />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Détails du contrat</span>
        <div className="flex-1 border-t border-gray-200" />
      </div>

      {/* Date de début + Mois de maintenance */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date de début">
          <StyledInput
            type="date"
            value={contractData.startDate}
            onChange={(e) => onContractDataChange('startDate', e.target.value)}
          />
        </FormField>
        <FormField label="Mois de maintenance">
          <StyledSelect
            value={contractData.maintenanceMonth}
            onChange={(e) => onContractDataChange('maintenanceMonth', e.target.value)}
            options={MAINTENANCE_MONTHS}
            placeholder="— Choisir —"
          />
        </FormField>
      </div>

      {/* Notes */}
      <FormField label="Notes">
        <textarea
          value={contractData.notes}
          onChange={(e) => onContractDataChange('notes', e.target.value)}
          placeholder="Notes complémentaires..."
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm
            focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
            placeholder:text-gray-400 transition-colors resize-none"
        />
      </FormField>
    </div>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default CreateContractModal;
