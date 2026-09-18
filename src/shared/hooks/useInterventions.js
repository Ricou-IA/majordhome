/**
 * useInterventions.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour la gestion des interventions terrain (tablette).
 *
 * Inclut un système de brouillon localStorage pour auto-save du formulaire.
 *
 * @version 1.0.0 - Sprint 3 Outil Terrain Tablette
 * @version 1.1.0 - Contrat unique des mutations : mutateAsync résout avec la
 *   donnée et REJETTE sur refus (unwrapResult) — l'appelant fait try/catch +
 *   toast, jamais de lecture de { error }.
 * ============================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { interventionsService } from '@services/interventions.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { interventionKeys, clientKeys } from '@hooks/cacheKeys';
import { useAuth } from '@contexts/AuthContext';

// Re-export for backward compatibility
export { interventionKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK - useProjectInterventions (liste par projet/client)
// ============================================================================

/**
 * Hook pour charger les interventions d'un projet (fiche client)
 *
 * @param {string} projectId - UUID du projet (core.projects)
 * @returns {Object} { interventions, isLoading, error, refresh }
 */
export function useProjectInterventions(projectId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: interventionKeys.byProject(orgId, projectId),
    queryFn: async () => {
      const { data, error } = await interventionsService.getInterventionsByProject(projectId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!projectId,
    staleTime: 30_000,
  });

  return {
    interventions: data || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useCreateIntervention (mutation création)
// ============================================================================

/**
 * Hook pour créer une intervention
 *
 * @returns {Object} { createIntervention, isCreating }
 */
export function useCreateIntervention() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const mutation = useMutation({
    mutationFn: (params) => unwrapResult(interventionsService.createIntervention(params)),
    onSuccess: (_created, variables) => {
      // Invalider la liste interventions du projet
      queryClient.invalidateQueries({
        queryKey: interventionKeys.byProject(orgId, variables.projectId),
      });
      // Invalider le détail client (il charge aussi les interventions)
      queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
    },
  });

  return {
    createIntervention: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
}

// ============================================================================
// HOOK PRINCIPAL - useIntervention (détail)
// ============================================================================

/**
 * Hook pour charger une intervention avec client et équipement
 *
 * @param {string} interventionId - UUID de l'intervention
 * @returns {Object} { intervention, client, equipment, isLoading, error, refresh }
 *
 * @example
 * const { intervention, client, equipment, isLoading } = useIntervention(id);
 */
export function useIntervention(interventionId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: interventionKeys.detail(orgId, interventionId),
    queryFn: () => interventionsService.getInterventionById(interventionId),
    enabled: !!orgId && !!interventionId,
    staleTime: 30_000, // 30s
    select: (result) => result?.data || null,
  });

  return {
    intervention: data?.intervention || null,
    client: data?.client || null,
    equipment: data?.equipment || null,
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useInterventionFileUrls
// ============================================================================

/**
 * Hook pour charger les URLs signées des fichiers d'une intervention
 *
 * @param {Object} intervention - L'objet intervention
 * @returns {Object} { photoBeforeUrl, photoAfterUrl, photosExtraUrls, signatureUrl, isLoading }
 */
export function useInterventionFileUrls(intervention) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const {
    data,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: interventionKeys.fileUrls(orgId, intervention?.id),
    queryFn: async () => {
      const { data, error } = await interventionsService.getInterventionFileUrls(intervention);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!intervention?.id,
    staleTime: 55 * 60 * 1000, // 55min (URLs signées valables 1h)
  });

  return {
    photoBeforeUrl: data?.photoBeforeUrl || null,
    photoAfterUrl: data?.photoAfterUrl || null,
    photosExtraUrls: data?.photosExtraUrls || [],
    signatureUrl: data?.signatureUrl || null,
    isLoading,
    refreshUrls: refetch,
  };
}

// ============================================================================
// HOOK - useInterventionMutations
// ============================================================================

/**
 * Hook regroupant toutes les mutations d'une intervention
 *
 * @param {string} interventionId
 * @returns {Object} Mutations et états
 */
export function useInterventionMutations(interventionId) {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const invalidateIntervention = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: interventionKeys.detail(orgId, interventionId) });
    queryClient.invalidateQueries({ queryKey: interventionKeys.fileUrls(orgId, interventionId) });
  }, [queryClient, interventionId, orgId]);

  // Mutation : mettre à jour l'intervention
  const updateMutation = useMutation({
    mutationFn: (updates) => unwrapResult(interventionsService.updateIntervention(interventionId, updates)),
    onSuccess: invalidateIntervention,
  });

  // Mutation : changer le statut
  const statusMutation = useMutation({
    mutationFn: (status) => unwrapResult(interventionsService.updateInterventionStatus(interventionId, status)),
    onSuccess: invalidateIntervention,
  });

  // Mutation : upload fichier — résout avec { path, url }
  const uploadMutation = useMutation({
    mutationFn: ({ projectId, file, fileType }) =>
      unwrapResult(interventionsService.uploadFile(projectId, interventionId, file, fileType)),
    onSuccess: invalidateIntervention,
  });

  // Mutation : supprimer fichier
  const deleteFileMutation = useMutation({
    mutationFn: (path) => unwrapResult(interventionsService.deleteFile(path)),
    onSuccess: invalidateIntervention,
  });

  // Mutation : générer PDF via N8N — résout avec { success, pdfPath }
  const pdfMutation = useMutation({
    mutationFn: () => unwrapResult(interventionsService.triggerPdfGeneration(interventionId)),
    onSuccess: () => {
      // Le PDF est uploadé par N8N, on rafraîchit après un délai
      setTimeout(invalidateIntervention, 3000);
    },
  });

  // Mutation : envoyer rapport signé via N8N — résout avec { success }
  const signedReportMutation = useMutation({
    mutationFn: () => unwrapResult(interventionsService.triggerSignedReport(interventionId)),
  });

  const uploadFile = useCallback(
    (projectId, file, fileType) => uploadMutation.mutateAsync({ projectId, file, fileType }),
    [uploadMutation]
  );

  return {
    updateIntervention: updateMutation.mutateAsync,
    updateStatus: statusMutation.mutateAsync,
    uploadFile,
    deleteFile: deleteFileMutation.mutateAsync,
    triggerPdf: pdfMutation.mutateAsync,
    triggerSignedReport: signedReportMutation.mutateAsync,

    // États
    isUpdating: updateMutation.isPending,
    isChangingStatus: statusMutation.isPending,
    isUploading: uploadMutation.isPending,
    isDeletingFile: deleteFileMutation.isPending,
    isGeneratingPdf: pdfMutation.isPending,
    isSendingReport: signedReportMutation.isPending,

    // Refresh
    invalidate: invalidateIntervention,
  };
}

// ============================================================================
// HOOK - useInterventionDraft (auto-save localStorage)
// ============================================================================

const DRAFT_PREFIX = 'intervention_draft_';
const AUTOSAVE_INTERVAL = 30_000; // 30 secondes

/**
 * Hook pour gérer le brouillon d'un formulaire d'intervention
 * Auto-save dans localStorage toutes les 30s
 *
 * @param {string} interventionId
 * @returns {Object} { draft, saveDraft, clearDraft, hasDraft, lastSaved }
 */
export function useInterventionDraft(interventionId) {
  // P1.9 — clé localStorage suffixée par userId (draft personnel, ne doit
  // pas leaker à un autre user qui se connecterait sur le même device).
  const { user } = useAuth();
  const userId = user?.id || 'anon';
  const storageKey = `${DRAFT_PREFIX}${userId}_${interventionId}`;
  const [lastSaved, setLastSaved] = useState(null);
  const draftRef = useRef(null);
  const intervalRef = useRef(null);

  // Charger le brouillon au mount
  const loadDraft = useCallback(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        draftRef.current = parsed.data;
        setLastSaved(parsed.savedAt ? new Date(parsed.savedAt) : null);
        return parsed.data;
      }
    } catch (err) {
      console.error('[useInterventionDraft] Erreur lecture localStorage:', err);
    }
    return null;
  }, [storageKey]);

  // Sauvegarder le brouillon
  const saveDraft = useCallback((data) => {
    try {
      draftRef.current = data;
      const payload = {
        data,
        savedAt: new Date().toISOString(),
        interventionId,
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setLastSaved(new Date());
    } catch (err) {
      console.error('[useInterventionDraft] Erreur écriture localStorage:', err);
    }
  }, [storageKey, interventionId]);

  // Supprimer le brouillon
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      draftRef.current = null;
      setLastSaved(null);
    } catch (err) {
      console.error('[useInterventionDraft] Erreur suppression localStorage:', err);
    }
  }, [storageKey]);

  // Auto-save périodique
  const startAutoSave = useCallback((getFormData) => {
    // Nettoyer l'ancien interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      const data = getFormData();
      if (data) {
        saveDraft(data);
      }
    }, AUTOSAVE_INTERVAL);
  }, [saveDraft]);

  const stopAutoSave = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Nettoyage au démontage
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Vérifier s'il y a un brouillon
  const hasDraft = useCallback(() => {
    try {
      return localStorage.getItem(storageKey) !== null;
    } catch {
      return false;
    }
  }, [storageKey]);

  return {
    loadDraft,
    saveDraft,
    clearDraft,
    hasDraft,
    startAutoSave,
    stopAutoSave,
    lastSaved,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useIntervention;
