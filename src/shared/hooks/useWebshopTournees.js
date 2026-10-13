/**
 * useWebshopTournees.js — Tournées de livraison palettes (Webshop → Tournées)
 * ============================================================================
 * Lectures React Query scopées org (org CORE, `organization.id`) ; mutations via
 * unwrapResult (rejettent sur refus de la RPC, l'appelant fait try/catch + toast).
 * Toute mutation invalide toute la famille `webshopTourKeys.all(orgId)` : un
 * déplacement change deux tournées et la liste « à planifier ».
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { unwrapResult } from '@lib/serviceHelpers';
import { webshopTourneesService } from '@services/webshopTournees.service';
import { webshopTourKeys } from '@hooks/cacheKeys';

export { webshopTourKeys };

function useOrgId() {
  const { organization } = useAuth();
  return organization?.id;
}

export function useWebshopSectors() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: webshopTourKeys.sectors(orgId),
    queryFn: () => unwrapResult(webshopTourneesService.getSectors(orgId)),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
}

export function useWebshopSlots({ from, to }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: webshopTourKeys.slots(orgId, from, to),
    queryFn: () => unwrapResult(webshopTourneesService.getSlots(orgId, { from, to })),
    enabled: !!orgId,
  });
}

export function useWebshopSlotOrders(slotId) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: webshopTourKeys.slotOrders(orgId, slotId),
    queryFn: () => unwrapResult(webshopTourneesService.getSlotOrders(orgId, slotId)),
    enabled: !!orgId && !!slotId,
  });
}

export function useWebshopUnplannedOrders() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: webshopTourKeys.unplanned(orgId),
    queryFn: () => unwrapResult(webshopTourneesService.getUnplannedOrders(orgId)),
    enabled: !!orgId,
  });
}

/**
 * Résultat du dernier envoi manuel. Interroge toutes les 3 s tant que la réponse
 * du site n'est pas arrivée (pg_net est asynchrone), s'arrête ensuite.
 */
export function useWebshopSendResult(slotId, { enabled = true } = {}) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: webshopTourKeys.sendResult(orgId, slotId),
    queryFn: () => unwrapResult(webshopTourneesService.getSendResult(slotId)),
    enabled: !!orgId && !!slotId && enabled,
    refetchInterval: (query) => (query.state.data?.state === 'pending' ? 3000 : false),
  });
}

export function useWebshopTourMutations() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: webshopTourKeys.all(orgId) });

  const setStatus = useMutation({
    mutationFn: ({ slotId, status, note }) => unwrapResult(webshopTourneesService.setSlotStatus(slotId, status, note)),
    onSettled: invalidate,
  });
  const cancel = useMutation({
    mutationFn: ({ slotId, note }) => unwrapResult(webshopTourneesService.cancelSlot(slotId, note)),
    onSettled: invalidate,
  });
  const moveOrder = useMutation({
    mutationFn: ({ orderId, targetSlotId }) => unwrapResult(webshopTourneesService.moveOrder(orderId, targetSlotId)),
    onSettled: invalidate,
  });
  const sendRouteSheet = useMutation({
    mutationFn: ({ slotId }) => unwrapResult(webshopTourneesService.sendRouteSheet(slotId)),
    onSettled: invalidate,
  });

  return { setStatus, cancel, moveOrder, sendRouteSheet };
}
