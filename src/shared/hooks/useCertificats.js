/**
 * useCertificats.js - Majord'home Artisan
 * ============================================================================
 * Hooks TanStack React Query v5 pour les certificats d'entretien.
 *
 * @version 1.0.0 - Module Certificat d'Entretien & Ramonage
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { certificatsService } from '@services/certificats.service';
import { certificatKeys } from '@/shared/hooks/cacheKeys';

// Re-export for backward compatibility
export { certificatKeys } from '@/shared/hooks/cacheKeys';

// ============================================================================
// QUERY : Certificat par intervention
// ============================================================================

export function useCertificat(interventionId) {
  const { data: certificat, isLoading, error, refetch } = useQuery({
    queryKey: certificatKeys.byIntervention(interventionId),
    queryFn: async () => {
      const { data, error } = await certificatsService.getCertificatByIntervention(interventionId);
      if (error) throw error;
      return data; // peut être null
    },
    enabled: !!interventionId,
    staleTime: 30_000,
  });

  return { certificat, isLoading, error, refetch };
}

// ============================================================================
// MUTATIONS
// ============================================================================

export function useCertificatMutations() {
  const queryClient = useQueryClient();

  const invalidate = useCallback((interventionId) => {
    if (interventionId) {
      queryClient.invalidateQueries({ queryKey: certificatKeys.byIntervention(interventionId) });
    }
    queryClient.invalidateQueries({ queryKey: certificatKeys.all });
  }, [queryClient]);

  // Sauvegarder brouillon
  const draftMutation = useMutation({
    mutationFn: (formData) => certificatsService.saveDraft(formData),
    onSuccess: (result) => {
      if (result.data?.intervention_id) {
        invalidate(result.data.intervention_id);
      }
    },
  });

  // Signer le certificat
  const signMutation = useMutation({
    mutationFn: ({ certificatId, signatureBase64, signataireNom }) =>
      certificatsService.signCertificat(certificatId, signatureBase64, signataireNom),
    onSuccess: (result) => {
      if (result.data?.intervention_id) {
        invalidate(result.data.intervention_id);
      }
    },
  });

  // Upload PDF
  const uploadPdfMutation = useMutation({
    mutationFn: ({ clientId, certificatId, pdfBlob }) =>
      certificatsService.uploadPdf(clientId, certificatId, pdfBlob),
  });

  // Mettre à jour infos PDF
  const updatePdfMutation = useMutation({
    mutationFn: ({ certificatId, storagePath, pdfUrl }) =>
      certificatsService.updatePdfInfo(certificatId, storagePath, pdfUrl),
    onSuccess: (result) => {
      if (result.data?.intervention_id) {
        invalidate(result.data.intervention_id);
      }
    },
  });

  return {
    saveDraft: useCallback(
      async (formData) => {
        const result = await draftMutation.mutateAsync(formData);
        return result;
      },
      [draftMutation]
    ),

    signCertificat: useCallback(
      async (certificatId, signatureBase64, signataireNom) => {
        const result = await signMutation.mutateAsync({ certificatId, signatureBase64, signataireNom });
        return result;
      },
      [signMutation]
    ),

    uploadPdf: useCallback(
      async (clientId, certificatId, pdfBlob) => {
        const result = await uploadPdfMutation.mutateAsync({ clientId, certificatId, pdfBlob });
        return result;
      },
      [uploadPdfMutation]
    ),

    updatePdfInfo: useCallback(
      async (certificatId, storagePath, pdfUrl) => {
        const result = await updatePdfMutation.mutateAsync({ certificatId, storagePath, pdfUrl });
        return result;
      },
      [updatePdfMutation]
    ),

    getSignedUrl: certificatsService.getSignedUrl,

    isSaving: draftMutation.isPending,
    isSigning: signMutation.isPending,
    isUploadingPdf: uploadPdfMutation.isPending,
  };
}
