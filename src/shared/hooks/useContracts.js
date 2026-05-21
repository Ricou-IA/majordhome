/**
 * useContracts.js - Majord'home Artisan
 * ============================================================================
 * Hooks React pour la gestion des contrats d'entretien.
 *
 * v2.1.0 - P0.11 : propagation orgId dans toutes les cache keys
 * v2.0.0 - Refonte : table majordhome.contracts (remplace pending_contracts)
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contractsService } from '@services/contracts.service';
import { savService } from '@services/sav.service';
import { entretiensService } from '@services/entretiens.service';
import { clientsService } from '@services/clients.service';
import { contractKeys, clientKeys, interventionKeys, entretienSavKeys, appointmentKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';

// Re-export for backward compatibility
export { contractKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK - useClientContract (contrat d'un client, 1:1)
// ============================================================================

export function useClientContract(clientId) {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const {
    data: contract,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: contractKeys.byClient(orgId, clientId),
    queryFn: async () => {
      const { data, error } = await contractsService.getContractByClientId(clientId);
      if (error) throw error;
      return data; // null si pas de contrat
    },
    enabled: !!orgId && !!clientId,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (contractData) => contractsService.createContract({ ...contractData, clientId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ contractId: cId, updates }) => contractsService.updateContract(cId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({ contractId: cId, reason }) => contractsService.closeContract(cId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (contractId) => contractsService.deleteContract(contractId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
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

  const closeContract = useCallback(
    async (contractId, reason) => {
      try {
        const result = await closeMutation.mutateAsync({ contractId, reason });
        return result;
      } catch (err) {
        return { data: null, error: err };
      }
    },
    [closeMutation]
  );

  return {
    contract,
    isLoading,
    error,
    createContract,
    isCreating: createMutation.isPending,
    updateContract,
    isUpdating: updateMutation.isPending,
    closeContract,
    isClosing: closeMutation.isPending,
    deleteContract,
    isDeleting: deleteMutation.isPending,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useContractEquipments
// ============================================================================

export function useContractEquipments(contractId) {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const {
    data: equipments,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: contractKeys.equipments(orgId, contractId),
    queryFn: async () => {
      const { data, error } = await contractsService.getContractEquipments(contractId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && !!contractId,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: (equipmentId) => contractsService.addEquipmentToContract(contractId, equipmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.equipments(orgId, contractId) });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (equipmentId) => contractsService.removeEquipmentFromContract(contractId, equipmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.equipments(orgId, contractId) });
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

export function useContracts({ orgId, initialFilters } = {}) {
  const [filters, setFiltersState] = useState(() => ({
    search: '',
    status: 'active',
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
    queryKey: [...contractKeys.lists(orgId), filters, offset],
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

  const setFilters = useCallback((newFilters) => {
    setFiltersState((prev) => ({ ...prev, ...newFilters }));
    setOffset(0);
  }, []);

  const setSearch = useCallback((search) => {
    setFiltersState((prev) => ({ ...prev, search }));
    setOffset(0);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState({ search: '', status: 'active', visitStatus: '' });
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

export function useContract(contractId) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { data: contract, isLoading, error } = useQuery({
    queryKey: contractKeys.detail(orgId, contractId),
    queryFn: async () => {
      const { data, error } = await entretiensService.getContractById(contractId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!contractId,
    staleTime: 30_000,
  });

  return { contract, isLoading, error };
}

// ============================================================================
// HOOK - useContractStats (dashboard Entretiens)
// ============================================================================

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

export function useContractSectors(orgId) {
  const { data: sectors, isLoading, error } = useQuery({
    queryKey: [...contractKeys.all(orgId), 'sectors'],
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

export function useContractVisits(contractId) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { data: visits, isLoading, error, refetch } = useQuery({
    queryKey: [...contractKeys.all(orgId), 'visits', contractId],
    queryFn: async () => {
      const { data, error } = await entretiensService.getVisitsForContract(contractId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!contractId,
    staleTime: 30_000,
  });

  return { visits: visits || [], isLoading, error, refresh: refetch };
}

// ============================================================================
// HOOK - useContractMutations (actions modale Entretiens)
// ============================================================================

export function useContractMutations() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const updateMutation = useMutation({
    mutationFn: ({ contractId, updates }) => entretiensService.updateContract(contractId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
    },
  });

  const recordVisitMutation = useMutation({
    mutationFn: (params) => entretiensService.recordVisit(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...contractKeys.all(orgId), 'visits', variables.contractId] });
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(orgId, variables.contractId) });
      queryClient.invalidateQueries({ queryKey: contractKeys.stats(orgId, variables.year) });
      // Cascade Kanban (entretien parent) + Planning (appointment)
      queryClient.invalidateQueries({ queryKey: interventionKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
    },
  });

  const updateVisitMutation = useMutation({
    mutationFn: ({ visitId, status, notes }) => entretiensService.updateVisitStatus(visitId, status, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
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

export function useCreateContractWithClient() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ orgId, existingClientId, newClientData, contractData, userId, source }) => {
      let clientId = existingClientId;
      const isWeb = source === 'web';

      // Étape 1 : Créer le client si besoin
      if (!clientId && newClientData) {
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
          leadSource: isWeb ? 'web' : null,
          isWebDraft: isWeb,
          createdBy: userId,
        });

        if (clientResult.error) {
          throw new Error(clientResult.error.message || 'Erreur lors de la création du client');
        }
        if (!clientResult.data?.id) {
          throw new Error('Création client échouée : aucun ID retourné');
        }

        clientId = clientResult.data.id;
      }

      if (!clientId) {
        throw new Error('Aucun client sélectionné ou créé');
      }

      // Étape 2 : Créer le contrat
      const contractResult = await contractsService.createContract({
        orgId,
        clientId,
        status: contractData.status || 'active',
        workflowStatus: contractData.workflowStatus || null,
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
        source: contractData.source || 'app',
      });

      if (contractResult.error) {
        throw new Error(contractResult.error.message || 'Erreur lors de la création du contrat');
      }

      // Étape 3 : Créer l'entretien "à planifier" automatiquement
      const contractId = contractResult.data?.id;
      if (contractId) {
        try {
          await savService.createEntretien({
            orgId,
            clientId,
            contractId,
            projectId: null,
            scheduledDate: null,
            createdBy: userId,
          });
        } catch (entretienErr) {
          // Non bloquant : le contrat est créé même si l'entretien échoue
        }
      }

      return {
        client: clientId,
        contract: contractResult.data,
      };
    },
    onSuccess: (_, variables) => {
      // Invalider tous les caches liés
      const orgId = variables?.orgId;
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
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
