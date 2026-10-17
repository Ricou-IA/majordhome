/**
 * useWebshopSettings.js — Settings → Webshop (secteurs, codes postaux, tarifs colis, points de retrait)
 * ============================================================================
 * Lectures scopées org CORE (`organization.id`, comme le site) ; mutations via
 * unwrapResult : `mutateAsync` rejette sur refus de la RPC, l'appelant fait
 * try/catch + toast (message via `messageErreurWebshop`). Toute mutation
 * invalide la famille Settings ET celle des tournées (secteurs et créneaux y
 * sont affichés).
 * ============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { unwrapResult } from '@lib/serviceHelpers';
import { webshopSettingsService } from '@services/webshopSettings.service';
import { webshopSettingsKeys, webshopTourKeys } from '@hooks/cacheKeys';

export { webshopSettingsKeys };

function useOrgId() {
  const { organization } = useAuth();
  return organization?.id;
}

export function useWebshopSettingsSectors() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: webshopSettingsKeys.sectors(orgId),
    queryFn: () => unwrapResult(webshopSettingsService.getSectors(orgId)),
    enabled: !!orgId,
  });
}

export function useWebshopSectorPostcodes(sectorId) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: webshopSettingsKeys.sectorPostcodes(orgId, sectorId),
    queryFn: () => unwrapResult(webshopSettingsService.getSectorPostcodes(orgId, sectorId)),
    enabled: !!orgId && !!sectorId,
  });
}

export function useWebshopShippingRates() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: webshopSettingsKeys.shippingRates(orgId),
    queryFn: () => unwrapResult(webshopSettingsService.getShippingRates(orgId)),
    enabled: !!orgId,
  });
}

export function useWebshopPickupPoints() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: webshopSettingsKeys.pickupPoints(orgId),
    queryFn: () => unwrapResult(webshopSettingsService.getPickupPoints(orgId)),
    enabled: !!orgId,
  });
}

export function useWebshopSettingsMutations() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: webshopSettingsKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: webshopTourKeys.all(orgId) });
  };

  const upsertSector = useMutation({
    mutationFn: (sector) => unwrapResult(webshopSettingsService.upsertSector(orgId, sector)),
    onSuccess,
  });
  const setSectorPostcodes = useMutation({
    mutationFn: ({ sectorId, rows }) => unwrapResult(webshopSettingsService.setSectorPostcodes(sectorId, rows)),
    onSuccess,
  });
  const regenerateSlots = useMutation({
    mutationFn: () => unwrapResult(webshopSettingsService.regenerateFutureSlots(orgId)),
    onSuccess,
  });
  const upsertShippingRate = useMutation({
    mutationFn: (rate) => unwrapResult(webshopSettingsService.upsertShippingRate(orgId, rate)),
    onSuccess,
  });
  const deleteShippingRate = useMutation({
    mutationFn: (rateId) => unwrapResult(webshopSettingsService.deleteShippingRate(rateId)),
    onSuccess,
  });
  const upsertPickupPoint = useMutation({
    mutationFn: (point) => unwrapResult(webshopSettingsService.upsertPickupPoint(orgId, point)),
    onSuccess,
  });

  return {
    upsertSector: upsertSector.mutateAsync,
    setSectorPostcodes: setSectorPostcodes.mutateAsync,
    regenerateSlots: regenerateSlots.mutateAsync,
    upsertShippingRate: upsertShippingRate.mutateAsync,
    deleteShippingRate: deleteShippingRate.mutateAsync,
    upsertPickupPoint: upsertPickupPoint.mutateAsync,
    isSavingSector: upsertSector.isPending || setSectorPostcodes.isPending,
    isRegenerating: regenerateSlots.isPending,
    isSavingRate: upsertShippingRate.isPending || deleteShippingRate.isPending,
    isSavingPoint: upsertPickupPoint.isPending,
  };
}
