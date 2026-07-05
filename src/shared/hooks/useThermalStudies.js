// src/shared/hooks/useThermalStudies.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { thermalService } from '@services/thermal.service';
import { thermalKeys } from './cacheKeys';

export { thermalKeys } from './cacheKeys';

/** Liste paginée des études thermiques (recherche par titre). */
export function useThermalStudies({ search = '', page = 0 } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: thermalKeys.list(orgId, { search, page }),
    queryFn: async () => {
      const { data, error } = await thermalService.list({ orgId, search, page });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

/** Détail complet d'une étude pour rechargement à l'identique. */
export function useThermalStudy(id) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: thermalKeys.detail(orgId, id),
    queryFn: async () => {
      const { data, error } = await thermalService.getById(orgId, id);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!id,
  });
}

export function useThermalStudyMutations() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();

  const createStudy = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await thermalService.create({ ...payload, orgId, userId: user?.id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: thermalKeys.all(orgId) }),
  });

  const updateStudy = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await thermalService.update(orgId, id, patch);
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: thermalKeys.all(orgId) }),
  });

  const deleteStudy = useMutation({
    mutationFn: async (id) => {
      const { data, error } = await thermalService.remove(orgId, id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: thermalKeys.all(orgId) }),
  });

  return { createStudy, updateStudy, deleteStudy };
}
