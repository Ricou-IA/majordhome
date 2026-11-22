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
import { logger } from '@lib/logger';

/** Échec d'écriture : une phrase pour l'utilisateur, le détail dans le journal. */
const echec = (message) => (err) => {
  logger.error('[useMailCampaigns]', message, err);
  toast.error(message);
};
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
    onError: echec('L’enregistrement n’a pas abouti. Réessayez.'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await mailCampaignsService.update(id, patch, orgId);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Campagne mise à jour');
    },
    onError: echec('L’enregistrement n’a pas abouti. Réessayez.'),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id) => {
      const { data, error } = await mailCampaignsService.archive(id, orgId);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Campagne archivée');
    },
    onError: echec('L’archivage n’a pas abouti. Réessayez.'),
  });

  const restoreMutation = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await mailCampaignsService.restore(id, patch, orgId);
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(),
    onError: echec('La restauration n’a pas abouti. Réessayez.'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { data, error } = await mailCampaignsService.remove(id, orgId);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Campagne supprimée');
    },
    onError: echec('La suppression n’a pas abouti. Réessayez.'),
  });

  const duplicateMutation = useMutation({
    mutationFn: async ({ campaign, newKey, newLabel }) => {
      const { data, error } = await mailCampaignsService.duplicate(campaign, newKey, newLabel, orgId);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Copie créée. Elle n’envoie rien toute seule : c’est une campagne à lancer à la main.');
    },
    onError: echec('La copie n’a pas abouti. Réessayez.'),
  });

  return {
    campaigns: query.data || [],
    isLoading: query.isLoading,
    isFetched: query.isFetched,
    error: query.error,
    refetch: query.refetch,
    createCampaign: createMutation.mutateAsync,
    updateCampaign: updateMutation.mutateAsync,
    archiveCampaign: archiveMutation.mutateAsync,
    restoreCampaign: restoreMutation.mutateAsync,
    deleteCampaign: deleteMutation.mutateAsync,
    duplicateCampaign: duplicateMutation.mutateAsync,
    isMutating:
      createMutation.isPending ||
      updateMutation.isPending ||
      archiveMutation.isPending ||
      restoreMutation.isPending ||
      deleteMutation.isPending ||
      duplicateMutation.isPending,
  };
}

/**
 * Nombre d'envois au journal d'une campagne (par son nom ENREGISTRÉ). `nombre` vaut `undefined` tant qu'il est
 * inconnu (chargement, erreur) : la page fige alors le nom (`nomVerrouille`).
 * @param {string | undefined} orgId
 * @param {string | null | undefined} libelle
 * @param {{ enabled?: boolean }} [options]
 * @returns {{ nombre: number | undefined, echec: boolean }}
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
  return {
    nombre: query.isError || typeof query.data !== 'number' ? undefined : query.data,
    echec: query.isError,
  };
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
