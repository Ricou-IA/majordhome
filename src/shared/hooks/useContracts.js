/**
 * useContracts.js - Majord'home Artisan
 * ============================================================================
 * Hooks React pour la gestion des contrats d'entretien.
 *
 * v2.2.0 - Contrat unique des mutations : mutateAsync REJETTE sur refus (unwrapResult)
 * v2.1.0 - P0.11 : propagation orgId dans toutes les cache keys
 * v2.0.0 - Refonte : table majordhome.contracts (remplace pending_contracts)
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { contractsService } from '@services/contracts.service';
import { savService } from '@services/sav.service';
import { entretiensService } from '@services/entretiens.service';
import { clientsService } from '@services/clients.service';
import { unwrapResult } from '@/lib/serviceHelpers';
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

  // Contrat unique : `mutateAsync` résout avec la donnée et REJETTE sur refus
  // (unwrapResult) — l'appelant fait try/catch + toast, jamais de lecture de { error }.
  const createMutation = useMutation({
    mutationFn: (contractData) => unwrapResult(contractsService.createContract({ ...contractData, clientId })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ contractId: cId, updates }) => unwrapResult(contractsService.updateContract(cId, updates)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({ contractId: cId, reason }) => unwrapResult(contractsService.closeContract(cId, reason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (contractId) => unwrapResult(contractsService.deleteContract(contractId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.byClient(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, clientId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
    },
  });

  const updateContract = useCallback(
    (contractId, updates) => updateMutation.mutateAsync({ contractId, updates }),
    [updateMutation]
  );

  const closeContract = useCallback(
    (contractId, reason) => closeMutation.mutateAsync({ contractId, reason }),
    [closeMutation]
  );

  return {
    contract,
    isLoading,
    error,
    createContract: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    updateContract,
    isUpdating: updateMutation.isPending,
    closeContract,
    isClosing: closeMutation.isPending,
    deleteContract: deleteMutation.mutateAsync,
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
    mutationFn: (equipmentId) => unwrapResult(contractsService.addEquipmentToContract(contractId, equipmentId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.equipments(orgId, contractId) });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (equipmentId) => unwrapResult(contractsService.removeEquipmentFromContract(contractId, equipmentId)),
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
// HOOK - useEntretienByContract (carte entretien active d'un contrat)
// ============================================================================

export function useEntretienByContract(orgId, contractId) {
  const { data: card, isLoading } = useQuery({
    queryKey: [...entretienSavKeys.all(orgId), 'by-contract', contractId],
    queryFn: async () => {
      const { data } = await supabase
        .from('majordhome_entretien_sav')
        .select('id, workflow_status, next_rdv_date, scheduled_date')
        .eq('org_id', orgId)
        .eq('contract_id', contractId)
        .eq('intervention_type', 'entretien')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data || null;
    },
    enabled: !!orgId && !!contractId,
    staleTime: 30_000,
  });
  return { card, isLoading };
}

// ============================================================================
// HOOK - useContractMutations (actions modale Entretiens)
// ============================================================================

export function useContractMutations() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const updateMutation = useMutation({
    mutationFn: ({ contractId, updates }) => unwrapResult(entretiensService.updateContract(contractId, updates)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists(orgId) });
    },
  });

  const recordVisitMutation = useMutation({
    mutationFn: (params) => unwrapResult(entretiensService.recordVisit(params)),
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
    mutationFn: ({ visitId, status, notes }) => unwrapResult(entretiensService.updateVisitStatus(visitId, status, notes)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
    },
  });

  return {
    updateContract: useCallback(
      (contractId, updates) => updateMutation.mutateAsync({ contractId, updates }),
      [updateMutation]
    ),
    recordVisit: recordVisitMutation.mutateAsync,
    updateVisitStatus: useCallback(
      (visitId, status, notes) => updateVisitMutation.mutateAsync({ visitId, status, notes }),
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

  // La mutationFn throw déjà à chaque étape : on expose mutateAsync tel quel
  // (résout avec { client, contract }, rejette sinon) — même contrat que le reste du fichier.
  return {
    createContractWithClient: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useClientContract;
