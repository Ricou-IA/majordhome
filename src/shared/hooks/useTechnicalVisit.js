/**
 * useTechnicalVisit.js - Majord'home Artisan
 * ============================================================================
 * Hook React Query pour la Fiche Technique Terrain.
 * Pattern identique à useLeads.js / useChantiers.js
 *
 * Contrat unique des mutations : `mutateAsync` résout avec la donnée et REJETTE
 * sur refus (unwrapResult, dans la mutationFn — pas dans un wrapper, sinon
 * onSuccess / isError de la mutation ne reflètent pas le refus).
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { technicalVisitService } from '@services/technicalVisit.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { technicalVisitKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';

// Re-export for backward compatibility
export { technicalVisitKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK PRINCIPAL — Fiche technique d'un lead
// ============================================================================

/**
 * Charge la fiche technique pour un lead donné.
 * Retourne null si inexistante (pas d'erreur).
 */
export function useTechnicalVisit(leadId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: technicalVisitKeys.byLead(orgId, leadId),
    queryFn: () => technicalVisitService.getByLeadId(leadId),
    enabled: !!orgId && !!leadId,
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
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: technicalVisitKeys.photos(orgId, visitId),
    queryFn: async () => {
      const { data: photos, error } = await technicalVisitService.getPhotosByVisitId(visitId);
      if (error) return [];
      return technicalVisitService.getPhotoSignedUrls(photos);
    },
    enabled: !!orgId && !!visitId,
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
  const { organization } = useAuth();
  const orgId = organization?.id;

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: technicalVisitKeys.all(orgId) });
  }, [queryClient, orgId]);

  const invalidateDetail = useCallback((leadId) => {
    queryClient.invalidateQueries({ queryKey: technicalVisitKeys.byLead(orgId, leadId) });
  }, [queryClient, orgId]);

  const invalidatePhotos = useCallback((visitId) => {
    queryClient.invalidateQueries({ queryKey: technicalVisitKeys.photos(orgId, visitId) });
  }, [queryClient, orgId]);

  // CREATE
  const createMutation = useMutation({
    mutationFn: (payload) => unwrapResult(technicalVisitService.create(payload)),
    onSuccess: () => invalidateAll(),
  });

  // UPDATE
  const updateMutation = useMutation({
    mutationFn: ({ visitId, updates }) => unwrapResult(technicalVisitService.update(visitId, updates)),
    onSuccess: (_visit, { leadId }) => {
      if (leadId) invalidateDetail(leadId);
    },
  });

  const updateVisit = useCallback(
    (visitId, updates, leadId) => updateMutation.mutateAsync({ visitId, updates, leadId }),
    [updateMutation]
  );

  // AUTO-SAVE (pas d'invalidation automatique — on update le cache manuellement)
  const autoSaveMutation = useMutation({
    mutationFn: ({ visitId, field, value }) =>
      unwrapResult(technicalVisitService.autoSaveField(visitId, field, value)),
    onSuccess: (_visit, { field, value, leadId }) => {
      if (!leadId) return;
      queryClient.setQueryData(technicalVisitKeys.byLead(orgId, leadId), (old) => {
        if (!old?.data) return old;
        return { ...old, data: { ...old.data, [field]: value } };
      });
    },
  });

  const autoSave = useCallback(
    (visitId, field, value, leadId) => autoSaveMutation.mutateAsync({ visitId, field, value, leadId }),
    [autoSaveMutation]
  );

  // LOCK
  const lockMutation = useMutation({
    mutationFn: ({ visitId, userId }) => unwrapResult(technicalVisitService.lock(visitId, userId)),
    onSuccess: () => invalidateAll(),
  });

  const lockVisit = useCallback(
    (visitId, userId) => lockMutation.mutateAsync({ visitId, userId }),
    [lockMutation]
  );

  // UNLOCK
  const unlockMutation = useMutation({
    mutationFn: (visitId) => unwrapResult(technicalVisitService.unlock(visitId)),
    onSuccess: () => invalidateAll(),
  });

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
      unwrapResult(technicalVisitService.deletePhoto(photoId, storagePath)),
    onSuccess: (_r, { visitId }) => invalidatePhotos(visitId),
  });

  const deletePhoto = useCallback(
    (photoId, storagePath, visitId) => deletePhotoMutation.mutateAsync({ photoId, storagePath, visitId }),
    [deletePhotoMutation]
  );

  return {
    createVisit: createMutation.mutateAsync,
    updateVisit,
    autoSave,
    lockVisit,
    unlockVisit: unlockMutation.mutateAsync,
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
