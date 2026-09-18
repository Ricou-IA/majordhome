/**
 * useCertificats.js - Majord'home Artisan
 * ============================================================================
 * Hooks TanStack React Query v5 pour les certificats d'entretien.
 *
 * @version 1.0.0 - Module Certificat d'Entretien & Ramonage
 * @version 1.1.0 - Contrat unique des mutations : mutateAsync résout avec la
 *   donnée et REJETTE sur refus (unwrapResult) — l'appelant fait try/catch +
 *   toast, jamais de lecture de { error }.
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { certificatsService } from '@services/certificats.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { certificatKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';

// Re-export for backward compatibility
export { certificatKeys } from '@hooks/cacheKeys';

// ============================================================================
// QUERY : Certificat par intervention
// ============================================================================

export function useCertificat(interventionId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data: certificat, isLoading, error, refetch } = useQuery({
    queryKey: certificatKeys.byIntervention(orgId, interventionId),
    queryFn: async () => {
      const { data, error } = await certificatsService.getCertificatByIntervention(interventionId);
      if (error) throw error;
      return data; // peut être null
    },
    enabled: !!orgId && !!interventionId,
    staleTime: 30_000,
  });

  return { certificat, isLoading, error, refetch };
}

// ============================================================================
// MUTATIONS
// ============================================================================

export function useCertificatMutations() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const invalidate = useCallback((interventionId) => {
    if (interventionId) {
      queryClient.invalidateQueries({ queryKey: certificatKeys.byIntervention(orgId, interventionId) });
    }
    queryClient.invalidateQueries({ queryKey: certificatKeys.all(orgId) });
  }, [queryClient, orgId]);

  // Sauvegarder brouillon — résout avec le certificat
  const draftMutation = useMutation({
    mutationFn: (formData) => unwrapResult(certificatsService.saveDraft(formData)),
    onSuccess: (certificat) => {
      if (certificat?.intervention_id) {
        invalidate(certificat.intervention_id);
      }
    },
  });

  // Signer le certificat
  const signMutation = useMutation({
    mutationFn: ({ certificatId, signatureBase64, signataireNom }) =>
      unwrapResult(certificatsService.signCertificat(certificatId, signatureBase64, signataireNom)),
    onSuccess: (certificat) => {
      if (certificat?.intervention_id) {
        invalidate(certificat.intervention_id);
      }
    },
  });

  // Upload PDF — orgId requis depuis P0.0.7 (storage RLS scopée org_id).
  // Résout avec { path, storagePath }.
  const uploadPdfMutation = useMutation({
    mutationFn: ({ orgId, clientId, certificatId, pdfBlob }) =>
      unwrapResult(certificatsService.uploadPdf(orgId, clientId, certificatId, pdfBlob)),
  });

  // Mettre à jour infos PDF
  const updatePdfMutation = useMutation({
    mutationFn: ({ certificatId, storagePath, pdfUrl }) =>
      unwrapResult(certificatsService.updatePdfInfo(certificatId, storagePath, pdfUrl)),
    onSuccess: (certificat) => {
      if (certificat?.intervention_id) {
        invalidate(certificat.intervention_id);
      }
    },
  });

  return {
    saveDraft: draftMutation.mutateAsync,

    signCertificat: useCallback(
      (certificatId, signatureBase64, signataireNom) =>
        signMutation.mutateAsync({ certificatId, signatureBase64, signataireNom }),
      [signMutation]
    ),

    uploadPdf: uploadPdfMutation.mutateAsync,

    updatePdfInfo: useCallback(
      (certificatId, storagePath, pdfUrl) =>
        updatePdfMutation.mutateAsync({ certificatId, storagePath, pdfUrl }),
      [updatePdfMutation]
    ),

    getSignedUrl: certificatsService.getSignedUrl,

    isSaving: draftMutation.isPending,
    isSigning: signMutation.isPending,
    isUploadingPdf: uploadPdfMutation.isPending,
  };
}
