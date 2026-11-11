/**
 * useEquipmentModels.js — Modèles fabricant d'appareil, nomenclature, images, rattachement d'un équipement
 * ============================================================================
 * Mutation au contrat unique : `mutateAsync` résout avec la donnée et REJETTE sur refus (unwrapResult) —
 * l'appelant fait try/catch + toast.
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
