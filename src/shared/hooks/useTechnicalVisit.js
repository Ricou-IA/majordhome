/**
 * useTechnicalVisit.js - Majord'home Artisan
 * ============================================================================
 * Hook React Query pour la Fiche Technique Terrain.
 * Pattern identique à useLeads.js / useChantiers.js
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { technicalVisitService } from '@services/technicalVisit.service';
import { technicalVisitKeys } from '@/shared/hooks/cacheKeys';

// Re-export for backward compatibility
export { technicalVisitKeys } from '@/shared/hooks/cacheKeys';

// ============================================================================
// HOOK PRINCIPAL — Fiche technique d'un lead
// ============================================================================

/**
 * Charge la fiche technique pour un lead donné.
 * Retourne null si inexistante (pas d'erreur).
 */
export function useTechnicalVisit(leadId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: technicalVisitKeys.byLead(leadId),
    queryFn: () => technicalVisitService.getByLeadId(leadId),
    enabled: !!leadId,
    staleTime: 30_000,
    select: (result) => result?.data || null,
  });

  return {
    visit: data,
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK PHOTOS
// ============================================================================

/**
 * Charge les photos d'une fiche technique avec URLs signées.
 */
export function useTechnicalVisitPhotos(visitId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: technicalVisitKeys.photos(visitId),
    queryFn: async () => {
      const { data: photos, error } = await technicalVisitService.getPhotosByVisitId(visitId);
      if (error) return [];
      return technicalVisitService.getPhotoSignedUrls(photos);
    },
    enabled: !!visitId,
    staleTime: 60_000, // URLs signées valables 1h, refresh toutes les minutes
  });

  return {
    photos: data || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK MUTATIONS
// ============================================================================

export function useTechnicalVisitMutations() {
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: technicalVisitKeys.all });
  }, [queryClient]);

  const invalidateDetail = useCallback((leadId) => {
    queryClient.invalidateQueries({ queryKey: technicalVisitKeys.byLead(leadId) });
  }, [queryClient]);

  const invalidatePhotos = useCallback((visitId) => {
    queryClient.invalidateQueries({ queryKey: technicalVisitKeys.photos(visitId) });
  }, [queryClient]);

  // CREATE
  const createMutation = useMutation({
    mutationFn: (payload) => technicalVisitService.create(payload),
    onSuccess: () => invalidateAll(),
  });

  const createVisit = useCallback(async (payload) => {
    const result = await createMutation.mutateAsync(payload);
    if (result.error) throw result.error;
    return result.data;
  }, [createMutation]);

  // UPDATE
  const updateMutation = useMutation({
    mutationFn: ({ visitId, updates }) => technicalVisitService.update(visitId, updates),
  });

  const updateVisit = useCallback(async (visitId, updates, leadId) => {
    const result = await updateMutation.mutateAsync({ visitId, updates });
    if (result.error) throw result.error;
    if (leadId) invalidateDetail(leadId);
    return result.data;
  }, [updateMutation, invalidateDetail]);

  // AUTO-SAVE (pas d'invalidation automatique — on update le cache manuellement)
  const autoSaveMutation = useMutation({
    mutationFn: ({ visitId, field, value }) =>
      technicalVisitService.autoSaveField(visitId, field, value),
  });

  const autoSave = useCallback(async (visitId, field, value, leadId) => {
    const result = await autoSaveMutation.mutateAsync({ visitId, field, value });
    if (result.error) throw result.error;
    // Mettre à jour le cache optimistiquement
    if (leadId) {
      queryClient.setQueryData(technicalVisitKeys.byLead(leadId), (old) => {
        if (!old?.data) return old;
        return { ...old, data: { ...old.data, [field]: value } };
      });
    }
    return result.data;
  }, [autoSaveMutation, queryClient]);

  // LOCK
  const lockMutation = useMutation({
    mutationFn: ({ visitId, userId }) => technicalVisitService.lock(visitId, userId),
    onSuccess: () => invalidateAll(),
  });

  const lockVisit = useCallback(async (visitId, userId) => {
    const result = await lockMutation.mutateAsync({ visitId, userId });
    if (result.error) throw result.error;
    return result.data;
  }, [lockMutation]);

  // UNLOCK
  const unlockMutation = useMutation({
    mutationFn: (visitId) => technicalVisitService.unlock(visitId),
    onSuccess: () => invalidateAll(),
  });

  const unlockVisit = useCallback(async (visitId) => {
    const result = await unlockMutation.mutateAsync(visitId);
    if (result.error) throw result.error;
    return result.data;
  }, [unlockMutation]);

  // UPLOAD PHOTO
  const uploadPhotoMutation = useMutation({
    mutationFn: ({ orgId, leadId, file, category, visitId, userId }) =>
      technicalVisitService.uploadPhoto(orgId, leadId, file, category).then(async (result) => {
        if (result.error) throw result.error;
        // Créer l'enregistrement DB
        const record = {
          technical_visit_id: visitId,
          org_id: orgId,
          category,
          storage_path: result.path,
          file_name: file.name || null,
          file_size: file.size || null,
          uploaded_by: userId,
        };
        const dbResult = await technicalVisitService.createPhotoRecord(record);
        if (dbResult.error) throw dbResult.error;
        return { ...dbResult.data, signed_url: result.url };
      }),
  });

  const uploadPhoto = useCallback(async (params) => {
    const result = await uploadPhotoMutation.mutateAsync(params);
    invalidatePhotos(params.visitId);
    return result;
  }, [uploadPhotoMutation, invalidatePhotos]);

  // DELETE PHOTO
  const deletePhotoMutation = useMutation({
    mutationFn: ({ photoId, storagePath }) =>
      technicalVisitService.deletePhoto(photoId, storagePath),
  });

  const deletePhoto = useCallback(async (photoId, storagePath, visitId) => {
    const result = await deletePhotoMutation.mutateAsync({ photoId, storagePath });
    if (result.error) throw result.error;
    invalidatePhotos(visitId);
  }, [deletePhotoMutation, invalidatePhotos]);

  return {
    createVisit,
    updateVisit,
    autoSave,
    lockVisit,
    unlockVisit,
    uploadPhoto,
    deletePhoto,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isSaving: autoSaveMutation.isPending,
    isLocking: lockMutation.isPending,
    isUnlocking: unlockMutation.isPending,
    isUploadingPhoto: uploadPhotoMutation.isPending,
    isDeletingPhoto: deletePhotoMutation.isPending,
  };
}
