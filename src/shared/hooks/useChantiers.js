/**
 * useChantiers.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour le Kanban chantiers (workflow post-vente).
 *
 * @version 1.0.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chantiersService } from '@services/chantiers.service';
import { savService } from '@services/sav.service';
import { chantierPvService } from '@services/chantierPv.service';
import { CAMPAGNE_AVIS_POSE, contratsParClient } from '@/lib/chantierApresVente';
import { chantierKeys, appointmentKeys, pennylaneKeys, leadKeys, kanbanCardKeys } from '@hooks/cacheKeys';
import { unwrapResult } from '@/lib/serviceHelpers';
import { useAuth } from '@contexts/AuthContext';

// Re-export for backward compatibility
export { chantierKeys } from '@hooks/cacheKeys';

// ============================================================================
// HOOK - useChantiers (liste pour le Kanban)
// ============================================================================

export function useChantiers(orgId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: chantierKeys.list(orgId),
    queryFn: async () => {
      const { data, error } = await chantiersService.getChantiers({ orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 15_000,
  });

  return {
    chantiers: data || [],
    isLoading,
    error,
    refresh: refetch,
  };
}

// ============================================================================
// HOOK - useChantiersApresVente (contrats par client, avis déjà demandés)
// ============================================================================

/**
 * Listes de l'après-vente. Tant que la requête n'a pas répondu (ou si elle échoue),
 * `contrats` et `avis` valent `undefined` : l'écran affiche « inconnu » et ferme
 * l'envoi du SMS, il ne suppose jamais une liste vide.
 * @returns {{ contrats: Map<string, string[]>|undefined, avis: Set<string>|undefined }}
 */
export function useChantiersApresVente(orgId) {
  const { data } = useQuery({
    queryKey: chantierKeys.apresVente(orgId),
    queryFn: async () => {
      const { data: listes, error } = await chantiersService.getApresVente(orgId);
      if (error) throw error;
      return listes;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  return useMemo(() => (data
    ? {
      contrats: contratsParClient(data.contrats),
      avis: new Set(data.avis.map((ligne) => ligne.client_id).filter(Boolean)),
    }
    : { contrats: undefined, avis: undefined }), [data]);
}

// ============================================================================
// HOOK - useDemanderAvisPose (SMS de demande d'avis après une installation)
// ============================================================================

export function useDemanderAvisPose() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const mutation = useMutation({
    mutationFn: (chantier) => unwrapResult(savService.sendAvisRequest({
      campaign: CAMPAGNE_AVIS_POSE,
      clientId: chantier.client_id,
      clientFirstName: chantier.first_name,
      clientPhone: chantier.phone,
      orgId,
    })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chantierKeys.apresVente(orgId) }),
  });

  return {
    demanderAvis: mutation.mutateAsync,
    // Chantier dont l'envoi est en cours (un seul à la fois).
    envoiEnCoursPour: mutation.isPending ? mutation.variables?.id ?? null : null,
  };
}

// ============================================================================
// HOOKS - PV de réception signé en ligne
// ============================================================================

/** Enregistrement du PV en ligne d'un chantier (envoi, ouverture, signature) ; `null` s'il n'y en a pas. */
export function useChantierPv(orgId, chantierId, { enabled = true } = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: chantierKeys.pv(orgId, chantierId),
    queryFn: () => unwrapResult(chantierPvService.getPv(orgId, chantierId)),
    enabled: !!orgId && !!chantierId && enabled,
    staleTime: 15_000,
  });
  return { pv: data ?? null, isLoading, error };
}

/** Envoyer le lien au client, le copier, produire le PDF. Chaque geste rejette avec un message affichable. */
export function useChantierPvMutations() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;
  const invalider = () => queryClient.invalidateQueries({ queryKey: chantierKeys.all(orgId) });

  const envoi = useMutation({
    mutationFn: (chantierId) => unwrapResult(chantierPvService.envoyer({ orgId, chantierId })),
    onSuccess: invalider,
  });
  const lien = useMutation({
    mutationFn: (chantierId) => unwrapResult(chantierPvService.lien({ orgId, chantierId })),
  });
  const pdf = useMutation({
    mutationFn: ({ chantier, company }) => unwrapResult(chantierPvService.genererPdf({ orgId, chantier, company })),
    onSuccess: invalider,
  });
  const preparation = useMutation({
    mutationFn: ({ chantierId, reponses }) => unwrapResult(chantierPvService.preparer({ orgId, chantierId, reponses })),
    onSuccess: invalider,
  });
  const reponseReserves = useMutation({
    mutationFn: ({ chantierId, reponse, echeance }) =>
      unwrapResult(chantierPvService.repondreReserves({ orgId, chantierId, reponse, echeance })),
    onSuccess: invalider,
  });
  const demandeLevee = useMutation({
    mutationFn: ({ chantierId, mode }) => unwrapResult(chantierPvService.demanderLevee({ orgId, chantierId, mode })),
    onSuccess: invalider,
  });
  const pdfLevee = useMutation({
    mutationFn: ({ chantier, company }) => unwrapResult(chantierPvService.genererPdfLevee({ orgId, chantier, company })),
    onSuccess: invalider,
  });

  return {
    envoyerPv: envoi.mutateAsync,
    lienPv: lien.mutateAsync,
    genererPdfPv: pdf.mutateAsync,
    preparerPv: preparation.mutateAsync,
    repondreReservesPv: reponseReserves.mutateAsync,
    demanderLeveePv: demandeLevee.mutateAsync,
    genererPdfLeveePv: pdfLevee.mutateAsync,
    isEnvoiPv: envoi.isPending,
    isLienPv: lien.isPending,
    isPdfPv: pdf.isPending,
    isPreparationPv: preparation.isPending,
    isReponseReservesPv: reponseReserves.isPending,
    isDemandeLeveePv: demandeLevee.isPending,
    isPdfLeveePv: pdfLevee.isPending,
  };
}

// ============================================================================
// HOOK - useChantierMutations
// ============================================================================

export function useChantierMutations() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const invalidateChantiers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: chantierKeys.all(orgId) });
  }, [queryClient, orgId]);
  // Grouper / détacher / supprimer déplacent devis et RDV : invalidation croisée.
  const invalidateCroisee = useCallback(() => {
    invalidateChantiers();
    queryClient.invalidateQueries({ queryKey: appointmentKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: pennylaneKeys.linkedQuotes(orgId) });
    queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
  }, [invalidateChantiers, queryClient, orgId]);

  // Mutation : changer le statut chantier
  const statusMutation = useMutation({
    mutationFn: ({ chantierId, newStatus }) =>
      unwrapResult(chantiersService.updateChantierStatus(orgId, chantierId, newStatus)),
    onSuccess: invalidateChantiers,
  });

  // Mutation : mettre à jour les commandes (équipement + matériaux).
  // Exception au contrat unwrapResult : garde le retour composite
  // { data, error, autoTransitioned }, lu tel quel par ChantierReceptionSection.
  // Déballage à la main : le service porte `autoTransitioned` / `newChantierStatus`
  // hors `data` (contrat des mutations, cf. CLAUDE.md → Hooks). Rejette sur { error }.
  const orderMutation = useMutation({
    mutationFn: async ({ chantierId, ...params }) => {
      const { data, error, autoTransitioned, newChantierStatus } =
        await chantiersService.updateOrderStatus(orgId, chantierId, params);
      if (error) throw error;
      return { chantier: data, autoTransitioned, newChantierStatus };
    },
    onSuccess: invalidateChantiers,
  });

  // Mutation : notes
  const notesMutation = useMutation({
    mutationFn: ({ chantierId, notes }) =>
      unwrapResult(chantiersService.updateChantierNotes(orgId, chantierId, notes)),
    onSuccess: invalidateChantiers,
  });

  // Mutation : intitulé du chantier
  const labelMutation = useMutation({
    mutationFn: ({ chantierId, label }) =>
      unwrapResult(chantiersService.updateLabel(orgId, chantierId, label)),
    onSuccess: invalidateChantiers,
  });

  // Mutation : type d'équipement du chantier (choisi depuis la préparation du PV)
  const equipmentTypeMutation = useMutation({
    mutationFn: ({ chantierId, equipmentTypeId }) =>
      unwrapResult(chantiersService.updateEquipmentType(orgId, chantierId, equipmentTypeId)),
    onSuccess: invalidateChantiers,
  });

  // Mutation : commande « personnes × jours » (spec 2026-09-21)
  const plannedOrderMutation = useMutation({
    mutationFn: ({ chantierId, teamSize, days }) =>
      unwrapResult(chantiersService.updatePlannedOrder(orgId, chantierId, { teamSize, days })),
    onSuccess: invalidateChantiers,
  });

  // Mutation : upload PV de réception
  const pvMutation = useMutation({
    mutationFn: ({ chantierId, file }) =>
      unwrapResult(chantiersService.uploadPvReception(orgId, chantierId, file)),
    onSuccess: invalidateChantiers,
  });

  // Gestes (RPC) : regrouper, détacher, supprimer un chantier
  const groupMutation = useMutation({
    mutationFn: ({ targetId, sourceIds }) =>
      unwrapResult(chantiersService.groupChantiers(targetId, sourceIds)),
    onSuccess: invalidateCroisee,
  });

  const detachMutation = useMutation({
    mutationFn: (params) => unwrapResult(chantiersService.detachChantier(params)),
    onSuccess: invalidateCroisee,
  });

  const deleteMutation = useMutation({
    mutationFn: (chantierId) => unwrapResult(chantiersService.deleteChantier(chantierId)),
    onSuccess: invalidateCroisee,
  });

  return {
    updateChantierStatus: useCallback(
      (chantierId, newStatus) => statusMutation.mutateAsync({ chantierId, newStatus }),
      [statusMutation]
    ),
    updateOrderStatus: useCallback(
      (chantierId, params) => orderMutation.mutateAsync({ chantierId, ...params }),
      [orderMutation]
    ),
    updateChantierNotes: useCallback(
      (chantierId, notes) => notesMutation.mutateAsync({ chantierId, notes }),
      [notesMutation]
    ),
    updateLabel: useCallback(
      (chantierId, label) => labelMutation.mutateAsync({ chantierId, label }),
      [labelMutation]
    ),
    updateEquipmentType: useCallback(
      (chantierId, equipmentTypeId) => equipmentTypeMutation.mutateAsync({ chantierId, equipmentTypeId }),
      [equipmentTypeMutation]
    ),
    uploadPvReception: useCallback(
      (chantierId, file) => pvMutation.mutateAsync({ chantierId, file }),
      [pvMutation]
    ),
    updatePlannedOrder: useCallback(
      (chantierId, { teamSize, days }) => plannedOrderMutation.mutateAsync({ chantierId, teamSize, days }),
      [plannedOrderMutation]
    ),
    groupChantiers: useCallback(
      (targetId, sourceIds) => groupMutation.mutateAsync({ targetId, sourceIds }),
      [groupMutation]
    ),
    detachChantier: useCallback(
      (params) => detachMutation.mutateAsync(params),
      [detachMutation]
    ),
    deleteChantier: useCallback(
      (chantierId) => deleteMutation.mutateAsync(chantierId),
      [deleteMutation]
    ),

    // États
    isUpdatingStatus: statusMutation.isPending,
    isUpdatingOrder: orderMutation.isPending,
    isUploadingPv: pvMutation.isPending,
    isUpdatingEquipmentType: equipmentTypeMutation.isPending,
    isGrouping: groupMutation.isPending,
    isDetaching: detachMutation.isPending,
    isDeleting: deleteMutation.isPending,

    invalidate: invalidateChantiers,
  };
}
