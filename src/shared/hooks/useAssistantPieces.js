/**
 * useAssistantPieces.js — Assistant « Trouver une pièce » : historique d'un appareil, lancement, suivi
 * ============================================================================
 * `mutateAsync` du lancement résout avec `{ id }` et REJETTE sur refus (unwrapResult) : l'appelant fait
 * try/catch + toast.error(messageErreurAssistant(err)).
 * ============================================================================
 */

import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { assistantPiecesService } from '@services/assistantPieces.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { assistantPiecesKeys } from '@hooks/cacheKeys';

const lire = (promesse) => async () => {
  const { data, error } = await promesse();
  if (error) throw error;
  return data;
};

/** `{ recherches, isLoading, error }` — les 20 dernières recherches de l'appareil, la plus récente d'abord. */
export function useRecherchesPieces(equipmentId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error } = useQuery({
    queryKey: assistantPiecesKeys.parEquipement(orgId, equipmentId),
    queryFn: lire(() => assistantPiecesService.lister(orgId, equipmentId)),
    enabled: !!orgId && !!equipmentId,
  });
  return { recherches: data || [], isLoading, error };
}

/** `{ lancer, isLaunching }` — lance une recherche ; rafraîchit l'historique de l'appareil. */
export function useLancerRecherche(equipmentId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ interventionId = null, demande }) =>
      unwrapResult(assistantPiecesService.lancer(orgId, { equipmentId, interventionId, demande })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantPiecesKeys.parEquipement(orgId, equipmentId) }),
  });
  return { lancer: mutation.mutateAsync, isLaunching: mutation.isPending };
}

/**
 * `{ suivi, isLoading, error }` — suit une recherche toutes les 5 s tant qu'elle est `en_cours`.
 * `onTermine` est appelé UNE fois par recherche, quand son état devient final.
 */
export function useSuiviRecherche(id, onTermine) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { data, isLoading, error } = useQuery({
    queryKey: assistantPiecesKeys.detail(orgId, id),
    queryFn: lire(() => assistantPiecesService.suivre(orgId, id)),
    enabled: !!orgId && !!id,
    refetchInterval: (query) => (query.state.data?.statut === 'en_cours' ? 5000 : false),
    retry: 1,
  });

  const signale = useRef(null);
  const statut = data?.statut;
  useEffect(() => {
    if (!id || !statut || statut === 'en_cours' || signale.current === id) return;
    signale.current = id;
    onTermine?.(id);
  }, [id, statut, onTermine]);

  return { suivi: data || null, isLoading, error };
}
