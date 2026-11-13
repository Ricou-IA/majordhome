/**
 * useSavPieces.js — Pièces identifiées d'une carte SAV
 * ============================================================================
 * `setQuantity` : mutation optimiste, clé d'unicité (equipment_id + piece_reference + repere) ;
 * quantité 0 retire la ligne du cache, une quantité positive la remplace ou l'ajoute.
 * `ranger` (useRangerPiecesSurSav) résout avec `{ count }` et REJETTE sur refus (unwrapResult).
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { savPiecesService } from '@services/savPieces.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { savPieceKeys } from '@hooks/cacheKeys';

const memeLigne = (a, b) =>
  a.equipment_id === b.equipment_id &&
  a.piece_reference === b.piece_reference &&
  (a.repere ?? '') === (b.repere ?? '');

/** `{ selections, isLoading, error, setQuantity, isSaving }` — `isLoading` vrai tant que la liste est inconnue. */
export function useSavPieces(interventionId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const key = savPieceKeys.byCard(orgId, interventionId);

  // `isPending` (et non `isLoading`) : une requête désactivée faute d'orgId reste « liste inconnue ».
  const { data, isPending, error } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data: rows, error: err } = await savPiecesService.list(orgId, interventionId);
      if (err) throw err;
      return rows;
    },
    enabled: !!orgId && !!interventionId,
  });

  const mutation = useMutation({
    mutationFn: (photo) => unwrapResult(savPiecesService.setQuantity(orgId, interventionId, photo)),
    onMutate: async (photo) => {
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData(key);
      // Remplacement EN PLACE : une ligne qui changerait de position déplacerait les boutons
      // sous le doigt, et un second tap modifierait une AUTRE pièce.
      queryClient.setQueryData(key, (old = []) => {
        if (!(photo.quantity > 0)) return old.filter((l) => !memeLigne(l, photo));
        const nouvelle = { ...photo, repere: photo.repere ?? '' };
        if (!old.some((l) => memeLigne(l, photo))) return [...old, nouvelle];
        return old.map((l) => (memeLigne(l, photo) ? { ...l, ...nouvelle } : l));
      });
      return { snapshot };
    },
    onError: (_err, _photo, ctx) => {
      queryClient.setQueryData(key, ctx?.snapshot);
      toast.error("La pièce n'a pas pu être enregistrée");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return {
    selections: data || [],
    isLoading: isPending,
    error,
    setQuantity: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}

/** `{ ranger, isRanging }` — `ranger({ interventionId, photos })` → `{ count }`. */
export function useRangerPiecesSurSav() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ interventionId, photos }) =>
      unwrapResult(savPiecesService.ranger(orgId, interventionId, photos)),
    onSettled: (_d, _e, vars) =>
      queryClient.invalidateQueries({ queryKey: savPieceKeys.byCard(orgId, vars?.interventionId) }),
  });
  return { ranger: mutation.mutateAsync, isRanging: mutation.isPending };
}
