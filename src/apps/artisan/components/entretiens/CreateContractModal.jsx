/**
 * CreateContractModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale centrée pour la création d'un contrat d'entretien.
 * 3 étapes :
 *   1. Sélection/Création client (ContractStepClient)
 *   2. Sélection famille d'équipements + calcul tarif temps réel (ContractStepEquipment)
 *   3. Détails du contrat (dates, notes) + résumé tarifaire (ContractStepSummary)
 *
 * Orchestrateur : logique métier + state. Le JSX des étapes est dans :
 *   - ContractStepClient.jsx
 *   - ContractStepEquipment.jsx
 *   - ContractStepSummary.jsx
 *
 * @version 3.0.0 - Refactoring extraction sous-composants
 * ============================================================================
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  X,
  ArrowLeft,
  ArrowRight,
  FileText,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useClientSearch, useDuplicateCheck } from '@hooks/useClients';
import { useCreateContractWithClient } from '@hooks/useContracts';
import { usePricingData, usePricingCalculator } from '@hooks/usePricing';
import { pricingService } from '@services/pricing.service';
import { Step1Client } from './ContractStepClient';
import { Step2Equipment } from './ContractStepEquipment';
import { Step3Contract } from './ContractStepSummary';

// ============================================================================
// CONSTANTES
// ============================================================================

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
// INDICATEUR D'ÉTAPE
// ============================================================================

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

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function CreateContractModal({ isOpen, onClose, onSuccess, preSelectedClient = null }) {
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
  const clientAddress = useMemo(() => {
    if (clientMode === 'search' && selectedClient) {
      return {
        address: selectedClient.address || '',
        postalCode: selectedClient.postal_code || '',
        city: selectedClient.city || '',
      };
    }
    if (clientMode === 'create') {
      return {
        address: newClientData.address || '',
        postalCode: newClientData.postalCode || '',
        city: newClientData.city || '',
      };
    }
    return { address: '', postalCode: '', city: '' };
  }, [clientMode, selectedClient, newClientData.address, newClientData.postalCode, newClientData.city]);

  const calculator = usePricingCalculator(pricingData, clientAddress);

  // ========== Refs ==========
  const searchInputRef = useRef(null);

  // ========== Effects ==========

  // Reset à l'ouverture
  useEffect(() => {
    if (isOpen) {
      if (preSelectedClient) {
        setSelectedClient(preSelectedClient);
        setClientMode('search');
        setStep(1); // Skip étape client
      } else {
        setStep(0);
        setClientMode('search');
        setSelectedClient(null);
      }
      setNewClientData(INITIAL_CLIENT_DATA);
      setContractData(INITIAL_CONTRACT_DATA);
      setDuplicateAcknowledged(false);
      setSearchQuery('');
      clearSearch();
      calculator.reset();
      if (!preSelectedClient) {
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
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
      }
    }

    toast.success('Contrat créé avec succès');
    onClose();
    onSuccess?.();
  }, [isCreating, orgId, userId, calculator, contractData, clientMode, selectedClient, newClientData, createContractWithClient, onClose, onSuccess]);

  // ========== Render ==========

  if (!isOpen) return null;

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
                clientAddress={clientAddress}
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
                  onClick={() => preSelectedClient ? onClose() : setStep(0)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {preSelectedClient ? 'Annuler' : 'Retour'}
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

export default CreateContractModal;
