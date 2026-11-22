/**
 * CreateContractModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale centrée pour la création d'un contrat d'entretien.
 * 3 étapes :
 *   1. Sélection/Création client (ContractStepClient)
 *   2. Équipements du contrat + calcul tarif temps réel (ContractStepEquipment) :
 *      ceux DÉJÀ RECENSÉS chez le client sont proposés d'emblée (cochés) et seront
 *      RATTACHÉS au contrat ; les types cochés en plus créent de nouveaux équipements.
 *   3. Détails du contrat (dates, notes) + résumé tarifaire (ContractStepSummary)
 *
 * Orchestrateur : logique métier + state. Le JSX des étapes est dans :
 *   - ContractStepClient.jsx
 *   - ContractStepEquipment.jsx
 *   - ContractStepSummary.jsx
 *   - ContractModalFooter.jsx (boutons du pied)
 * Lignes et écriture des équipements : useContractCreationLines.js
 *
 * @version 3.0.0 - Refactoring extraction sous-composants
 * ============================================================================
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { contractKeys, clientKeys, entretienSavKeys } from '@/shared/hooks/cacheKeys';
import { useClientSearch, useDuplicateCheck } from '@hooks/useClients';
import { useCreateContractWithClient } from '@hooks/useContracts';
import { usePricingData, usePricingCalculator } from '@hooks/usePricing';
import { useContractCreationLines, saveContractCreationEquipments } from './useContractCreationLines';
import { Step1Client } from './ContractStepClient';
import { Step2Equipment } from './ContractStepEquipment';
import { Step3Contract } from './ContractStepSummary';
import { ContractModalFooter } from './ContractModalFooter';
import { EnvoiPropositionDOffice } from './EnvoiProposition';
import { logger } from '@lib/logger';
import { emailsValides } from '@/lib/emailUtils';

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
          i < current ? 'w-8 bg-blue-600' : i === current ? 'w-8 bg-blue-400' : 'w-6 bg-secondary-200'
        }`}
      />
    ))}
    <span className="text-xs text-secondary-500 ml-1">
      Étape {current + 1}/{total}
    </span>
  </div>
);

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function CreateContractModal({ isOpen, onClose, onSuccess, preSelectedClient = null, preSelectedEquipmentTypeId = null, contractDefaults = null }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;
  const queryClient = useQueryClient();

  // ========== State machine ==========
  const [step, setStep] = useState(0); // 0 = client, 1 = équipements, 2 = contrat
  const [clientMode, setClientMode] = useState('search');
  const [selectedClient, setSelectedClient] = useState(null);
  const [newClientData, setNewClientData] = useState(INITIAL_CLIENT_DATA);
  // Mois de maintenance proposé par l'appelant (depuis un chantier : le mois du PV de réception).
  // Proposé seulement : le champ reste modifiable.
  const moisPropose = contractDefaults?.maintenanceMonth || '';
  const [contractData, setContractData] = useState({ ...INITIAL_CONTRACT_DATA, maintenanceMonth: moisPropose });
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Création en cours, puis envoi de la proposition : la fenêtre reste ouverte jusqu'au bout.
  const [soumission, setSoumission] = useState(false);
  const [envoi, setEnvoi] = useState(null); // { clientId } une fois la proposition créée
  const isProposal = contractDefaults?.status === 'pending';

  // ========== Hooks ==========
  const { results: searchResults, searching, search: performSearch, clear: clearSearch } = useClientSearch(orgId, {
    debounceMs: 300,
    minChars: 2,
  });
  const { duplicates, isChecking: checkingDuplicates } = useDuplicateCheck(
    orgId,
    clientMode === 'create' ? newClientData : null,
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

  // Équipements déjà recensés chez le client (cochés d'office, rattachés à la création) + types
  // ajoutés ici : lignes et total du contrat. Cf. useContractCreationLines.
  const existingClientId = clientMode === 'search' ? selectedClient?.id || null : null;
  const {
    recensedLines,
    recensedEquipments,
    lines: contractLines,
    pricing: contractPricing,
    isLoading: loadingRecensed,
    error: recensedError,
    retry: refreshRecensed,
    toggle: handleToggleRecensed,
    resetSelection: resetRecensedSelection,
  } = useContractCreationLines({ clientId: existingClientId, pricingData, calculator });

  // ========== Refs ==========
  const searchInputRef = useRef(null);
  const equipmentPreSelectedRef = useRef(false);

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
      setContractData({ ...INITIAL_CONTRACT_DATA, maintenanceMonth: moisPropose });
      setDuplicateAcknowledged(false);
      setSearchQuery('');
      clearSearch();
      calculator.reset();
      resetRecensedSelection();
      equipmentPreSelectedRef.current = false;
      if (!preSelectedClient) {
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-add équipement pré-sélectionné (ex: depuis chantier).
  // On attend la liste des équipements recensés : si le client a déjà un équipement de ce type
  // (posé par le chantier, recensé à la main), c'est LUI qui entre au contrat — ajouter le type
  // en plus créerait un doublon et compterait deux fois le prix.
  useEffect(() => {
    if (
      isOpen &&
      preSelectedEquipmentTypeId &&
      pricingData.equipmentTypes?.length > 0 &&
      !equipmentPreSelectedRef.current &&
      !loadingRecensed &&
      !recensedError
    ) {
      const dejaRecense = recensedEquipments.some((eq) => eq.equipment_type_id === preSelectedEquipmentTypeId);
      if (!dejaRecense) calculator.addItem(preSelectedEquipmentTypeId);
      equipmentPreSelectedRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, preSelectedEquipmentTypeId, pricingData.equipmentTypes, loadingRecensed, recensedError, recensedEquipments]);

  // ========== Handlers ==========

  const handleSearchChange = useCallback((e) => {
    const value = e.target.value;
    setSearchQuery(value);
    performSearch(value);
  }, [performSearch]);

  const handleSelectClient = useCallback((client) => {
    setSelectedClient(client);
    setClientMode('search');
    resetRecensedSelection(); // autre client, autres équipements : tout repart coché
  }, [resetRecensedSelection]);

  const handleChooseDuplicate = useCallback((client) => {
    setSelectedClient(client);
    setClientMode('search');
    setDuplicateAcknowledged(false);
    resetRecensedSelection();
  }, [resetRecensedSelection]);

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
    if (['lastName', 'firstName', 'postalCode', 'phone', 'email'].includes(field)) {
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
    if (clientMode === 'create') return newClientData.lastName.trim().length >= 2 && !hasDuplicates && emailsValides(newClientData.email);
    return false;
  })();

  // Liste des équipements recensés inconnue (chargement ou échec) ⇒ on n'avance pas : créer le
  // contrat sans elle, c'est recréer en double des équipements qui existent peut-être déjà.
  // Idem pour la grille tarifaire : sans elle un équipement recensé se chiffrerait à 0 €.
  const canGoToStep2 = contractLines.length > 0 && !loadingRecensed && !recensedError
    && !pricingData.isLoading && !pricingData.error;

  // ========== Submit ==========

  const creer = useCallback(async (envoyerEnsuite) => {

    const params = {
      orgId,
      userId,
      contractData: {
        status: contractDefaults?.status || 'active',
        workflowStatus: contractDefaults?.workflowStatus || null,
        source: contractDefaults?.source || 'manual',
        amount: contractPricing.total || null,
        subtotal: contractPricing.subtotal || null,
        discountPercent: contractPricing.discountPercent || null,
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

    // Rejette si le client ou le contrat n'a pas pu être créé (contrat unique des hooks)
    let result;
    try {
      result = await createContractWithClient(params);
    } catch (err) {
      logger.error('[CreateContractModal] createContractWithClient error:', err);
      const msg = err?.message || 'Erreur lors de la création';
      if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('23505')) {
        toast.error('Ce client possède déjà un contrat actif');
      } else {
        toast.error(msg);
      }
      return;
    }

    // Sauvegarder les lignes tarifaires
    const contractId = result?.contract?.id;
    const resolvedClientId = result?.client || result?.contract?.client_id;

    // Équipements du contrat : types ajoutés → créés ; déjà recensés → rattachés. Un rattachement
    // refusé se dit : le contrat existe et son montant compte ces équipements.
    if (contractId) {
      const { linkFailures } = await saveContractCreationEquipments({
        contractId,
        clientId: resolvedClientId,
        newItems: calculator.getItemsForSave(),
        recensedLines: recensedLines.filter((line) => line.included),
        zoneId: calculator.activeZone?.id || null,
      });
      if (linkFailures > 0) {
        toast.warning(
          linkFailures > 1
            ? `Contrat créé, mais ${linkFailures} équipements déjà recensés n'ont pas pu être rattachés : à ajouter depuis l'onglet Équipements.`
            : "Contrat créé, mais un équipement déjà recensé n'a pas pu être rattaché : à ajouter depuis l'onglet Équipements.",
        );
      }
    }

    // Équipements et liens sont écrits APRÈS la mutation : son `onSuccess` a déjà
    // invalidé les caches sur un état intermédiaire (contrat sans équipement) et
    // rien ne les rafraîchit ensuite. Sans cette seconde invalidation, la fiche
    // client sert 30 s (staleTime) un contrat « sans équipement lié » : badge
    // « Hors contrat » et proposition de rattacher un équipement déjà rattaché
    // (vécu CTR-00834, 2026-09-23).
    queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });

    // Proposition à envoyer : l'envoi prend la suite, la fenêtre se ferme quand il a fini.
    if (envoyerEnsuite && contractId && resolvedClientId) {
      setEnvoi({ clientId: resolvedClientId });
      return;
    }

    const isPending = contractDefaults?.status === 'pending';
    toast.success(isPending ? 'Proposition créée — visible dans Pipeline Contrats' : 'Contrat créé avec succès');
    onClose();
    onSuccess?.();
  }, [orgId, userId, calculator, contractPricing, recensedLines, contractData, clientMode, selectedClient, newClientData, createContractWithClient, contractDefaults, onClose, onSuccess, queryClient]);

  // « Créer » ou « Envoyer la proposition » : un seul passage à la fois, du clic jusqu'au bout.
  const handleSubmit = async (suite) => {
    if (isCreating || soumission || envoi) return;
    setSoumission(true);
    try {
      await creer(suite === 'envoyer');
    } finally {
      setSoumission(false);
    }
  };

  // ========== Render ==========

  // PDF de la proposition (bibliothèque lourde, chargée à la demande) : pris d'avance à la dernière étape.
  useEffect(() => {
    if (isOpen && isProposal && step === 2) import('@apps/artisan/components/contrat/ContractPDF').catch(() => {});
  }, [isOpen, isProposal, step]);

  if (!isOpen) return null;
  // Pendant l'envoi, on ne ferme pas : il s'arrêterait en route sans rien dire.
  const fermer = envoi ? undefined : onClose;

  const modalWidth = step === 1 ? 'max-w-2xl' : 'max-w-lg';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={fermer}
      />

      {/* Modale centrée */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className={`bg-white rounded-xl shadow-2xl w-full ${modalWidth} max-h-[90vh] flex flex-col overflow-hidden transition-all`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ===== HEADER ===== */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-200">
            <div>
              <h2 className="text-lg font-semibold text-secondary-900">
                {isProposal ? 'Proposition de contrat' : 'Nouveau contrat'}
              </h2>
              <StepIndicator current={step} total={preSelectedClient ? 2 : 3} />
            </div>
            <button
              type="button"
              onClick={fermer}
              disabled={Boolean(envoi)}
              className="p-2 rounded-lg text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100 transition-colors disabled:opacity-40"
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
                lines={contractLines}
                pricing={contractPricing}
                recensed={{
                  lines: recensedLines,
                  isLoading: loadingRecensed,
                  error: recensedError,
                  onToggle: handleToggleRecensed,
                  onRetry: refreshRecensed,
                }}
              />
            )}

            {step === 2 && (
              <Step3Contract
                selectedClient={selectedClient}
                newClientData={newClientData}
                clientMode={clientMode}
                contractData={contractData}
                lines={contractLines}
                pricing={contractPricing}
                zoneCode={calculator.activeZone?.code || null}
                onContractDataChange={handleContractDataChange}
              />
            )}
          </div>

          {/* ===== FOOTER ===== */}
          <ContractModalFooter
            step={step}
            hasPreSelectedClient={!!preSelectedClient}
            canGoToStep1={!!canGoToStep1}
            canGoToStep2={canGoToStep2}
            total={contractLines.length > 0 ? contractPricing.total : null}
            isCreating={isCreating || soumission}
            isProposal={isProposal}
            isSending={Boolean(envoi)}
            onStep={setStep}
            onClose={onClose}
            onSubmit={() => handleSubmit('creer')}
            onSubmitAndSend={() => handleSubmit('envoyer')}
          />

          {envoi && (
            <EnvoiPropositionDOffice
              clientId={envoi.clientId}
              orgId={orgId}
              onFini={() => { setEnvoi(null); onClose(); onSuccess?.(); }}
            />
          )}
        </div>
      </div>
    </>
  );
}

export default CreateContractModal;
