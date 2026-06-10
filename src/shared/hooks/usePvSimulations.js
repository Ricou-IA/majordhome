// src/shared/hooks/usePvSimulations.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { pvService } from '@services/pv.service';
import { pvKeys } from './cacheKeys';

export { pvKeys } from './cacheKeys';

/** Liste des simulations (RLS : les miennes, ou toutes si org_admin). */
export function usePvSimulations({ search = '', page = 0 } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: pvKeys.list(orgId, { search, page }),
    queryFn: async () => {
      const { data, error } = await pvService.list({ orgId, search, page });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

/** Détail complet pour rechargement à l'identique. */
export function usePvSimulation(id) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: pvKeys.detail(orgId, id),
    queryFn: async () => {
      const { data, error } = await pvService.getById(orgId, id);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!id,
  });
}

export function usePvSimulationMutations() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();

  const createSimulation = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await pvService.create({ ...payload, orgId, userId: user?.id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pvKeys.all(orgId) }),
  });

  const deleteSimulation = useMutation({
    mutationFn: async (id) => {
      const { data, error } = await pvService.remove(orgId, id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pvKeys.all(orgId) }),
  });

  return { createSimulation, deleteSimulation };
}
