/**
 * useMailCampaigns — React Query hook pour templates mailing paramétrables
 * ============================================================================
 * Expose list + mutations (create / update / archive / duplicate / delete).
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mailCampaignsService } from '@services/mailCampaigns.service';
import { mailCampaignKeys } from './cacheKeys';
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: mailCampaignKeys.all });

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
    mutationFn: async ({ campaign, newKey }) => {
      const { data, error } = await mailCampaignsService.duplicate(campaign, newKey);
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
