/**
 * useMailCampaigns — React Query hook pour templates mailing paramétrables
 * ============================================================================
 * Expose list + mutations (create / update / archive / duplicate / delete).
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mailCampaignsService } from '@services/mailCampaigns.service';
import { mailCampaignKeys } from './cacheKeys';
import { unwrapResult } from '@lib/serviceHelpers';
import { toast } from 'sonner';

export { mailCampaignKeys };

export function useMailCampaigns(orgId, { includeArchived = false } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...mailCampaignKeys.list(orgId), includeArchived],
    queryFn: async () => {
      const { data, error } = await mailCampaignsService.list(orgId, { includeArchived });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: mailCampaignKeys.all(orgId) });

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await mailCampaignsService.create({ ...payload, org_id: orgId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Campagne créée');
    },
    onError: (err) => toast.error(`Création échouée : ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await mailCampaignsService.update(id, patch);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Campagne mise à jour');
    },
    onError: (err) => toast.error(`Mise à jour échouée : ${err.message}`),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id) => {
      const { data, error } = await mailCampaignsService.archive(id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Campagne archivée');
    },
    onError: (err) => toast.error(`Archivage échoué : ${err.message}`),
  });

  const duplicateMutation = useMutation({
    mutationFn: async ({ campaign, newKey, newLabel }) => {
      const { data, error } = await mailCampaignsService.duplicate(campaign, newKey, newLabel);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Campagne dupliquée');
    },
    onError: (err) => toast.error(`Duplication échouée : ${err.message}`),
  });

  return {
    campaigns: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    createCampaign: createMutation.mutateAsync,
    updateCampaign: updateMutation.mutateAsync,
    archiveCampaign: archiveMutation.mutateAsync,
    duplicateCampaign: duplicateMutation.mutateAsync,
    isMutating:
      createMutation.isPending ||
      updateMutation.isPending ||
      archiveMutation.isPending ||
      duplicateMutation.isPending,
  };
}

/**
 * Nombre d'envois au journal d'une campagne (par son nom ENREGISTRÉ). `nombre` vaut `undefined` tant qu'il est
 * inconnu (chargement, erreur) : la page fige alors le nom (`nomVerrouille`).
 * @param {string | undefined} orgId
 * @param {string | null | undefined} libelle
 * @param {{ enabled?: boolean }} [options]
 * @returns {{ nombre: number | undefined }}
 */
export function useNombreEnvois(orgId, libelle, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: mailCampaignKeys.envois(orgId, libelle),
    queryFn: async () => {
      const { data, error } = await mailCampaignsService.compterEnvois(orgId, libelle);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!libelle && enabled,
    staleTime: 60_000,
  });
  return { nombre: query.isError || typeof query.data !== 'number' ? undefined : query.data };
}

/**
 * Rédaction assistée d'un mail (edge `mailing-rediger`). Rien n'est écrit en base : `rediger(demande)` résout avec
 * `{ objet, objets, corps }` et REJETTE avec `{ code }` (message : `messageErreurRedaction(code)`).
 * @param {string | undefined} orgId
 */
export function useRedactionMail(orgId) {
  const mutation = useMutation({
    mutationFn: (demande) => unwrapResult(mailCampaignsService.rediger(orgId, demande)),
  });
  return { rediger: mutation.mutateAsync, enCours: mutation.isPending };
}
