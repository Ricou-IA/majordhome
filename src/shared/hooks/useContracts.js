/**
 * useContracts.js - Majord'home Artisan
 * ============================================================================
 * Hooks React pour la gestion des contrats d'entretien.
 * Utilise TanStack React Query pour le cache et les mutations.
 *
 * v2.0.0 - Refonte : table majordhome.contracts (remplace pending_contracts)
 * v1.0.0 - Sprint 5 (ancien système pending_contracts — supprimé)
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contractsService } from '@/shared/services/contracts.service';
import { entretiensService } from '@/shared/services/entretiens.service';
import { clientsService } from '@/shared/services/clients.service';
import { clientKeys } from '@/shared/hooks/useClients';
import { interventionKeys } from '@/shared/hooks/useInterventions';

// ============================================================================
// CLÉS DE CACHE
// ============================================================================

export const contractKeys = {
  all: ['contracts'],
  lists: () => [...contractKeys.all, 'list'],
  detail: (contractId) => [...contractKeys.all, 'detail', contractId],
  byClient: (clientId) => [...contractKeys.all, 'byClient', clientId],
  equipments: (contractId) => [...contractKeys.all, 'equipments', contractId],
  stats: (orgId, year) => [...contractKeys.all, 'stats', orgId, year],
};

// ============================================================================
// HOOK - useClientContract (contrat d'un client, 1:1)
// ============================================================================

/**
 * Hook pour charger le contrat d'un client (1 client = max 1 contrat)
 *
 * @param {string} clientId - UUID du client
 * @returns {Object} État et méthodes
 *
 * @example
 * const { contract, isLoading, createContract, updateContract, deleteContract } = useClientContract(clientId);
 */
export function useClientContract(clientId) {
  const queryClient = useQueryClient();

  const {
    data: contract,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: contractKeys.byClient(clientId),
    queryFn: async () => {
      const { data, error } = await contractsService.getContractByClientId(clientId);
      if (error) throw error;
      return data; // null si pas de contrat
    },
    enabled: !!clientId,
    staleTime: 30_000,
  });

  // Mutation création
  const createMutation = useMutation({
    mutationFn: (contractData) => contractsService.createContract({ ...contractData, clientId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });

  // Mutation mise à jour
  const updateMutation = useMutation({
    mutationFn: ({ contractId: cId, updates }) => contractsService.updateContract(cId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });

  // Mutation suppression
  const deleteMutation = useMutation({
    mutationFn: (contractId) => contractsService.deleteContract(contractId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });

  const createContract = useCallback(
    async (data) => {
      try {
        const result = await createMutation.mutateAsync(data);
        return result;
      } catch (err) {
        return { data: null, error: err };
      }
    },
    [createMutation]
  );

  const updateContract = useCallback(
    async (contractId, updates) => {
      try {
        const result = await updateMutation.mutateAsync({ contractId, updates });
        return result;
      } catch (err) {
        return { data: null, error: err };
      }
    },
    [updateMutation]
  );

  const deleteContract = useCallback(
    async (contractId) => {
      try {
        const result = await deleteMutation.mutateAsync(contractId);
        return result;
      } catch (err) {
        return { success: false, error: err };
      }
    },
    [deleteMutation]
  );

  return {
    contract,
    isLoading,
    error,
    createContract,
    isCreating: createMutation.isPending,
    updateContract,
    isUpdating: updateMutation.isPending,
    deleteContract,
    isDeleting: deleteMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useContractEquipments
// ============================================================================

/**
 * Hook pour les équipements liés à un contrat
 *
 * @param {string} contractId - UUID du contrat
 */
export function useContractEquipments(contractId) {
  const queryClient = useQueryClient();

  const {
    data: equipments,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: contractKeys.equipments(contractId),
    queryFn: async () => {
      const { data, error } = await contractsService.getContractEquipments(contractId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!contractId,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: (equipmentId) => contractsService.addEquipmentToContract(contractId, equipmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.equipments(contractId) });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (equipmentId) => contractsService.removeEquipmentFromContract(contractId, equipmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.equipments(contractId) });
    },
  });

  return {
    equipments: equipments || [],
    isLoading,
    error,
    addEquipment: addMutation.mutateAsync,
    removeEquipment: removeMutation.mutateAsync,
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useContracts (liste paginée pour page Entretiens)
// ============================================================================

/**
 * Hook pour la liste paginée de contrats avec filtres (page Entretiens)
 *
 * @param {Object} options
 * @param {string} options.orgId - UUID de l'organisation
 */
export function useContracts({ orgId, initialFilters } = {}) {
  const queryClient = useQueryClient();
  const [filters, setFiltersState] = useState(() => ({
    search: '',
    status: 'active',
    frequency: '',
    visitStatus: '', // 'remaining' | 'done' | ''
    ...initialFilters,
  }));
  const [offset, setOffset] = useState(0);
  const [allContracts, setAllContracts] = useState([]);
  const LIMIT = 50;

  const {
    data,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [...contractKeys.lists(), orgId, filters, offset],
    queryFn: async () => {
      const { data, count, error } = await entretiensService.getContracts({
        orgId,
        filters,
        limit: LIMIT,
        offset,
      });
      if (error) throw error;
      return { data, count };
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  // Accumuler les résultats pour pagination infinie
  useEffect(() => {
    if (data?.data) {
      if (offset === 0) {
        setAllContracts(data.data);
      } else {
        setAllContracts((prev) => [...prev, ...data.data]);
      }
    }
  }, [data, offset]);

  // Reset offset quand les filtres changent
  // NB : on ne vide PAS allContracts — l'effet d'accumulation ci-dessus
  // le remplace dès que data arrive (offset===0 → remplacement complet).
  // Vider allContracts causait un flash "Aucun contrat" quand les données
  // étaient déjà en cache React Query (isLoading=false + contracts=[]).
  const setFilters = useCallback((newFilters) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
    setOffset(0);
  }, []);

  const setSearch = useCallback((search) => {
    setFiltersState((prev) => ({ ...prev, search }));
    setOffset(0);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState({ search: '', status: 'active', frequency: '', visitStatus: '' });
    setOffset(0);
  }, []);

  const loadMore = useCallback(() => {
    if (data && allContracts.length < (data.count || 0)) {
      setOffset((prev) => prev + LIMIT);
    }
  }, [data, allContracts.length]);

  const totalCount = data?.count || 0;
  const hasMore = allContracts.length < totalCount;

  return {
    contracts: allContracts,
    totalCount,
    isLoading: isLoading && offset === 0,
    loadingMore: isFetching && offset > 0,
    hasMore,
    error,
    filters,
    setFilters,
    setSearch,
    resetFilters,
    loadMore,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useContract (détail contrat pour modale Entretiens)
// ============================================================================

/**
 * Hook pour charger un contrat par ID (enrichi avec infos client)
 * @param {string} contractId - UUID du contrat
 */
export function useContract(contractId) {
  const { data: contract, isLoading, error } = useQuery({
    queryKey: contractKeys.detail(contractId),
    queryFn: async () => {
      const { data, error } = await entretiensService.getContractById(contractId);
      if (error) throw error;
      return data;
    },
    enabled: !!contractId,
    staleTime: 30_000,
  });

  return { contract, isLoading, error };
}

// ============================================================================
// HOOK - useContractStats (dashboard Entretiens)
// ============================================================================

/**
 * Hook pour les statistiques du dashboard entretiens
 */
export function useContractStats(orgId, year) {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: contractKeys.stats(orgId, year),
    queryFn: async () => {
      const { data, error } = await entretiensService.getStats(orgId, year);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!year,
    staleTime: 60_000,
  });

  return { stats, isLoading, error };
}

// ============================================================================
// HOOK - useContractSectors (vue secteurs Entretiens)
// ============================================================================

/**
 * Hook pour les contrats groupés par secteur géographique
 */
export function useContractSectors(orgId) {
  const { data: sectors, isLoading, error } = useQuery({
    queryKey: [...contractKeys.all, 'sectors', orgId],
    queryFn: async () => {
      const { data, error } = await entretiensService.getContractsBySector(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  return { sectors: sectors || [], isLoading, error };
}

// ============================================================================
// HOOK - useContractVisits (historique visites modale Entretiens)
// ============================================================================

/**
 * Hook pour les visites de maintenance d'un contrat
 */
export function useContractVisits(contractId) {
  const { data: visits, isLoading, error, refetch } = useQuery({
    queryKey: [...contractKeys.all, 'visits', contractId],
    queryFn: async () => {
      const { data, error } = await entretiensService.getVisitsForContract(contractId);
      if (error) throw error;
      return data;
    },
    enabled: !!contractId,
    staleTime: 30_000,
  });

  return { visits: visits || [], isLoading, error, refresh: refetch };
}

// ============================================================================
// HOOK - useContractMutations (actions modale Entretiens)
// ============================================================================

/**
 * Hook pour les mutations contrat/visites (page Entretiens)
 */
export function useContractMutations() {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ contractId, updates }) => entretiensService.updateContract(contractId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });

  const recordVisitMutation = useMutation({
    mutationFn: (params) => entretiensService.recordVisit(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...contractKeys.all, 'visits', variables.contractId] });
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(variables.contractId) });
      queryClient.invalidateQueries({ queryKey: contractKeys.stats(variables.orgId, variables.year) });
      // Cascade crée une intervention → invalider le cache interventions
      queryClient.invalidateQueries({ queryKey: interventionKeys.all });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });

  const updateVisitMutation = useMutation({
    mutationFn: ({ visitId, status, notes }) => entretiensService.updateVisitStatus(visitId, status, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });

  return {
    updateContract: useCallback(
      async (contractId, updates) => updateMutation.mutateAsync({ contractId, updates }),
      [updateMutation]
    ),
    recordVisit: useCallback(
      async (params) => recordVisitMutation.mutateAsync(params),
      [recordVisitMutation]
    ),
    updateVisitStatus: useCallback(
      async (visitId, status, notes) => updateVisitMutation.mutateAsync({ visitId, status, notes }),
      [updateVisitMutation]
    ),
    isUpdating: updateMutation.isPending,
    isRecordingVisit: recordVisitMutation.isPending,
    isUpdatingVisit: updateVisitMutation.isPending,
  };
}

// ============================================================================
// HOOK - useCreateContractWithClient (création contrat + client optionnel)
// ============================================================================

/**
 * Hook composé pour créer un contrat avec client existant ou nouveau.
 * Utilisé par CreateContractModal.
 *
 * @returns {Object} État et méthodes
 *
 * @example
 * const { createContractWithClient, isCreating, error } = useCreateContractWithClient();
 * await createContractWithClient({
 *   orgId,
 *   existingClientId: 'xxx', // OU newClientData: { lastName, firstName, ... }
 *   contractData: { frequency, amount, startDate, ... },
 *   userId,
 * });
 */
export function useCreateContractWithClient() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ orgId, existingClientId, newClientData, contractData, userId }) => {
      let clientId = existingClientId;

      // Étape 1 : Créer le client si besoin
      if (!clientId && newClientData) {
        console.log('[useCreateContractWithClient] Création nouveau client...');
        const clientResult = await clientsService.createClient({
          orgId,
          lastName: newClientData.lastName,
          firstName: newClientData.firstName,
          email: newClientData.email,
          phone: newClientData.phone,
          address: newClientData.address,
          postalCode: newClientData.postalCode,
          city: newClientData.city,
          clientCategory: newClientData.clientCategory || 'particulier',
          createdBy: userId,
        });

        if (clientResult.error) {
          throw new Error(clientResult.error.message || 'Erreur lors de la création du client');
        }
        if (!clientResult.data?.id) {
          throw new Error('Création client échouée : aucun ID retourné');
        }

        clientId = clientResult.data.id;
        console.log('[useCreateContractWithClient] Client créé:', clientId);
      }

      if (!clientId) {
        throw new Error('Aucun client sélectionné ou créé');
      }

      // Étape 2 : Créer le contrat
      console.log('[useCreateContractWithClient] Création contrat pour client:', clientId);
      const contractResult = await contractsService.createContract({
        orgId,
        clientId,
        status: contractData.status || 'active',
        frequency: contractData.frequency || 'annuel',
        startDate: contractData.startDate || null,
        endDate: contractData.endDate || null,
        nextMaintenanceDate: contractData.nextMaintenanceDate || null,
        maintenanceMonth: contractData.maintenanceMonth || null,
        amount: contractData.amount || null,
        estimatedTime: contractData.estimatedTime || null,
        notes: contractData.notes || null,
        zoneId: contractData.zoneId || null,
        subtotal: contractData.subtotal || null,
        discountPercent: contractData.discountPercent || null,
      });

      if (contractResult.error) {
        throw new Error(contractResult.error.message || 'Erreur lors de la création du contrat');
      }

      return {
        client: clientId,
        contract: contractResult.data,
      };
    },
    onSuccess: () => {
      // Invalider tous les caches liés
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });

  const createContractWithClient = useCallback(
    async (params) => {
      try {
        const result = await mutation.mutateAsync(params);
        return { data: result, error: null };
      } catch (err) {
        console.error('[useCreateContractWithClient] error:', err);
        return { data: null, error: err };
      }
    },
    [mutation]
  );

  return {
    createContractWithClient,
    isCreating: mutation.isPending,
    error: mutation.error,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useClientContract;
