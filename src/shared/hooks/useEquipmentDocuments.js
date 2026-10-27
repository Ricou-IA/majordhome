/**
 * useEquipmentDocuments.js — Documents du modèle d'appareil (notice, vue éclatée…)
 * ============================================================================
 * Lecture par equipment_id (vue majordhome_equipment_model_documents) ; mutations
 * au contrat unique : `mutateAsync` résout avec la donnée et REJETTE sur refus
 * (unwrapResult) — l'appelant fait try/catch + toast.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { equipmentDocumentsService } from '@services/equipmentDocuments.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { equipmentDocumentKeys } from '@hooks/cacheKeys';

export { equipmentDocumentKeys } from '@hooks/cacheKeys';

/** `{ documentsByEquipmentId, isLoading, error }` pour une liste d'équipements (une seule requête). */
export function useEquipmentModelDocuments(equipmentIds = []) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const ids = useMemo(() => [...new Set((equipmentIds || []).filter(Boolean))].sort(), [equipmentIds]);
  const idsKey = ids.join(',');

  const { data, isLoading, error } = useQuery({
    queryKey: equipmentDocumentKeys.byEquipments(orgId, idsKey),
    queryFn: async () => {
      const { data, error } = await equipmentDocumentsService.getByEquipmentIds(orgId, ids);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && ids.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  return { documentsByEquipmentId: data || {}, isLoading, error };
}

/** `{ upload, remove, isUploading, isRemoving }` — invalident la famille entière (un document est partagé). */
export function useEquipmentDocumentMutations() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: equipmentDocumentKeys.all(orgId) });

  const uploadMutation = useMutation({
    mutationFn: ({ equipment, file, documentType, label }) =>
      unwrapResult(equipmentDocumentsService.upload({ orgId, equipment, file, documentType, label, userId: user?.id || null })),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (doc) => unwrapResult(equipmentDocumentsService.remove(orgId, doc)),
    onSuccess: invalidate,
  });

  return {
    upload: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    remove: removeMutation.mutateAsync,
    isRemoving: removeMutation.isPending,
  };
}
