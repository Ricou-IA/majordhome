// src/shared/hooks/usePvDossier.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { pvDossierService } from '@services/pvDossier.service';
import { pvDossierKeys } from './cacheKeys';

export { pvDossierKeys } from './cacheKeys';

/** Dossier attaché à une simulation (null tant qu'aucun n'existe). */
export function usePvDossier(simulationId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: pvDossierKeys.bySimulation(orgId, simulationId),
    queryFn: async () => {
      const { data, error } = await pvDossierService.getBySimulation(orgId, simulationId);
      if (error) throw error;
      return data; // peut être null
    },
    enabled: !!orgId && !!simulationId,
    staleTime: 30_000,
  });
}

export function usePvDossierMutations() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: pvDossierKeys.all(orgId) });

  const ensureDossier = useMutation({
    mutationFn: async ({ simulationId, leadId, clientId }) => {
      const { data, error } = await pvDossierService.upsertForSimulation({
        orgId, userId: user?.id, simulationId, leadId, clientId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const patchBlock = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await pvDossierService.patchBlock({ orgId, id, patch });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const advance = useMutation({
    mutationFn: async ({ id, targetStatus }) => {
      const { data, error } = await pvDossierService.advance({ id, targetStatus });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  return { ensureDossier, patchBlock, advance };
}
