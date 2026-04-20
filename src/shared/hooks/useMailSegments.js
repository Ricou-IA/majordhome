/**
 * useMailSegments — React Query hook pour le catalogue de segments mailing
 * ============================================================================
 * Expose list + mutations (create / update / archive / duplicate / delete)
 * + count/preview live pour le builder UI.
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mailSegmentsService } from '@services/mailSegments.service';
import { mailSegmentKeys } from './cacheKeys';
import { toast } from 'sonner';

export { mailSegmentKeys };

export function useMailSegments(orgId, { includeArchived = false } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...mailSegmentKeys.list(orgId), includeArchived],
    queryFn: async () => {
      const { data, error } = await mailSegmentsService.list(orgId, { includeArchived });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: mailSegmentKeys.all });

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await mailSegmentsService.create({ ...payload, org_id: orgId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Segment créé');
    },
    onError: (err) => toast.error(`Création échouée : ${err.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await mailSegmentsService.update(id, patch);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Segment mis à jour');
    },
    onError: (err) => toast.error(`Mise à jour échouée : ${err.message}`),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id) => {
      const { data, error } = await mailSegmentsService.archive(id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Segment archivé');
    },
    onError: (err) => toast.error(`Archivage échoué : ${err.message}`),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (segment) => {
      const { data, error } = await mailSegmentsService.duplicate(segment);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Segment dupliqué');
    },
    onError: (err) => toast.error(`Duplication échouée : ${err.message}`),
  });

  return {
    segments: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    createSegment: createMutation.mutateAsync,
    updateSegment: updateMutation.mutateAsync,
    archiveSegment: archiveMutation.mutateAsync,
    duplicateSegment: duplicateMutation.mutateAsync,
    isMutating:
      createMutation.isPending ||
      updateMutation.isPending ||
      archiveMutation.isPending ||
      duplicateMutation.isPending,
  };
}

/**
 * useSegmentCount — compte live des destinataires d'un segment (debounced côté appelant)
 */
export function useSegmentCount({ filters, campaignName = null, orgId, enabled = true }) {
  return useQuery({
    queryKey: mailSegmentKeys.count(filters, campaignName, orgId),
    queryFn: async () => {
      const { data, error } = await mailSegmentsService.count({ filters, campaignName, orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!filters && enabled,
    staleTime: 30_000,
  });
}

/**
 * useSegmentPreview — 20 premiers destinataires (debounced côté appelant)
 */
export function useSegmentPreview({ filters, campaignName = null, orgId, limit = 20, enabled = true }) {
  return useQuery({
    queryKey: [...mailSegmentKeys.preview(filters, campaignName, orgId), limit],
    queryFn: async () => {
      const { data, error } = await mailSegmentsService.preview({
        filters,
        campaignName,
        orgId,
        limit,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!filters && enabled,
    staleTime: 30_000,
  });
}
