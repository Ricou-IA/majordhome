/**
 * useEquipmentModels.js — Modèles fabricant d'appareil, nomenclature, images, rattachement d'un équipement
 * ============================================================================
 * Mutation au contrat unique : `mutateAsync` résout avec la donnée et REJETTE sur refus (unwrapResult) —
 * l'appelant fait try/catch + toast.
 * ============================================================================
 */

import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { equipmentModelsService } from '@services/equipmentModels.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { cle } from '@/lib/catalogue/nomenclature';
import { equipmentModelKeys, equipmentDocumentKeys, clientKeys } from '@hooks/cacheKeys';

export { equipmentModelKeys } from '@hooks/cacheKeys';

const lire = (promesse) => async () => {
  const { data, error } = await promesse();
  if (error) throw error;
  return data;
};

/** `{ model, isLoading, error }` — un modèle fabricant. */
export function useEquipmentModel(modelId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error } = useQuery({
    queryKey: equipmentModelKeys.detail(orgId, modelId),
    queryFn: lire(() => equipmentModelsService.getById(orgId, modelId)),
    enabled: !!orgId && !!modelId,
    staleTime: 10 * 60 * 1000,
  });
  return { model: data || null, isLoading, error };
}

/** `{ parts, isLoading, error }` — nomenclature d'un modèle (chargée seulement quand `enabled`). */
export function useEquipmentModelParts(modelId, enabled = true) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error } = useQuery({
    queryKey: equipmentModelKeys.parts(orgId, modelId),
    queryFn: lire(() => equipmentModelsService.getParts(orgId, modelId)),
    enabled: !!orgId && !!modelId && enabled,
    staleTime: 10 * 60 * 1000,
  });
  return { parts: data || [], isLoading, error };
}

/**
 * `{ partsByModel, isLoading, error }` — nomenclatures de plusieurs modèles (devis depuis les pièces identifiées d'une
 * fiche SAV). Même clé de cache que `useEquipmentModelParts`.
 */
export function useEquipmentModelPartsMany(modelIds = []) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const resultats = useQueries({
    queries: modelIds.map((id) => ({
      queryKey: equipmentModelKeys.parts(orgId, id),
      queryFn: lire(() => equipmentModelsService.getParts(orgId, id)),
      enabled: !!orgId && !!id,
      staleTime: 10 * 60 * 1000,
    })),
  });
  const partsByModel = {};
  modelIds.forEach((id, i) => { partsByModel[id] = resultats[i]?.data || []; });
  return {
    partsByModel,
    isLoading: resultats.some((r) => r.isLoading),
    error: resultats.find((r) => r.error)?.error || null,
  };
}

/** `{ photo, vues, manquantes, isLoading }` — URL signées (1 h) ; rafraîchies avant leur expiration. */
export function useEquipmentModelImages(model, enabled = true) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading } = useQuery({
    queryKey: equipmentModelKeys.images(orgId, model?.id),
    queryFn: lire(() => equipmentModelsService.getImages(model)),
    enabled: !!orgId && !!model?.id && enabled,
    staleTime: 45 * 60 * 1000,
    gcTime: 50 * 60 * 1000,
  });
  return { photo: data?.photo || null, vues: data?.vues || [], manquantes: data?.manquantes || 0, isLoading };
}

/** `{ modeles, marqueReconnue, isLoading, error }` — modèles proposables pour la marque d'un équipement. */
export function useEquipmentModelsForBrand(brand, enabled = true) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error } = useQuery({
    queryKey: equipmentModelKeys.forBrand(orgId, cle(brand)),
    queryFn: lire(() => equipmentModelsService.listForBrand(orgId, brand)),
    enabled: !!orgId && enabled,
    staleTime: 10 * 60 * 1000,
  });
  return { modeles: data?.modeles || [], marqueReconnue: !!data?.marqueReconnue, isLoading, error };
}

/** `{ marques, isLoading }` — marques de référence de l'org (« JOLLY MEC »…). */
export function useBrandRefs(enabled = true) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading } = useQuery({
    queryKey: equipmentModelKeys.brandRefs(orgId),
    queryFn: lire(() => equipmentModelsService.listBrandRefs(orgId)),
    enabled: !!orgId && enabled,
    staleTime: 10 * 60 * 1000,
  });
  return { marques: data || [], isLoading };
}

/** `{ articles, isLoading, error }` — articles du catalogue qui pourraient être l'appareil saisi. */
export function useArticlesForEquipment(brand, model, enabled = true) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error } = useQuery({
    queryKey: equipmentModelKeys.articles(orgId, cle(brand), cle(model)),
    queryFn: lire(() => equipmentModelsService.searchArticles(orgId, brand, model)),
    enabled: !!orgId && enabled && cle(model).length >= 3,
    staleTime: 5 * 60 * 1000,
  });
  return { articles: data || [], isLoading, error };
}

/**
 * `{ searchWeb, createFromWeb, createFromCatalog, isSearching, isCreating }` — recherche web (rien n'est écrit),
 * création de la fiche validée sur place, fiche depuis un article. Chaque appel résout avec la donnée et REJETTE sur
 * refus (le message de l'edge est gardé dans `error.message`).
 */
export function useEquipmentEnrichment() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const invalider = () => queryClient.invalidateQueries({ queryKey: equipmentModelKeys.all(orgId) });
  const recherche = useMutation({ mutationFn: (saisie) => unwrapResult(equipmentModelsService.searchWeb(orgId, saisie)) });
  const web = useMutation({
    mutationFn: ({ appareil, equipmentTypeId, champs }) => unwrapResult(equipmentModelsService.createFromWeb(orgId, appareil, { equipmentTypeId, champs })),
    onSuccess: invalider,
  });
  const catalogue = useMutation({
    mutationFn: (catalogItemId) => unwrapResult(equipmentModelsService.createFromCatalog(catalogItemId)),
    onSuccess: invalider,
  });
  return {
    searchWeb: recherche.mutateAsync, createFromWeb: web.mutateAsync, createFromCatalog: catalogue.mutateAsync,
    isSearching: recherche.isPending, isCreating: web.isPending || catalogue.isPending,
  };
}

/** `{ fiches, isLoading, error }` — file de contrôle des fiches créées sur le terrain (org_admin). */
export function useModelsToReview(enabled = true) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error } = useQuery({
    queryKey: equipmentModelKeys.toReview(orgId),
    queryFn: lire(() => equipmentModelsService.listToReview(orgId)),
    enabled: !!orgId && enabled,
    staleTime: 60 * 1000,
  });
  return { fiches: data || [], isLoading, error };
}

/** `{ documents, isLoading }` — documents rattachés à une fiche. */
export function useModelFiles(modelId, enabled = true) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading } = useQuery({
    queryKey: equipmentModelKeys.files(orgId, modelId),
    queryFn: lire(() => equipmentModelsService.getModelFiles(orgId, modelId)),
    enabled: !!orgId && !!modelId && enabled,
    staleTime: 60 * 1000,
  });
  return { documents: data || [], isLoading };
}

/** `{ review, merge, isSaving }` — valider / corriger, fusionner (org_admin). */
export function useModelReview() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const invalider = () => {
    queryClient.invalidateQueries({ queryKey: equipmentModelKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: equipmentDocumentKeys.all(orgId) });
  };
  const controle = useMutation({ mutationFn: ({ modelId, patch }) => unwrapResult(equipmentModelsService.review(modelId, patch)), onSuccess: invalider });
  const fusion = useMutation({ mutationFn: ({ absorbedId, survivorId }) => unwrapResult(equipmentModelsService.merge(absorbedId, survivorId)), onSuccess: invalider });
  return { review: controle.mutateAsync, merge: fusion.mutateAsync, isSaving: controle.isPending || fusion.isPending };
}

/** `{ setModel, isSaving }` — rattache / détache un équipement ; rafraîchit équipements du client et documents. */
export function useSetEquipmentModel() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ equipmentId, modelId }) => unwrapResult(equipmentModelsService.setEquipmentModel(equipmentId, modelId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: equipmentDocumentKeys.all(orgId) });
    },
  });
  return { setModel: mutation.mutateAsync, isSaving: mutation.isPending };
}
