/**
 * useFeuilleDeRoute.js — Feuille de route d'une personne pour une journée
 * ============================================================================
 * Orchestration unique écran ↔ impression : RDV du jour → arrêts de la
 * personne → itinéraire → trajets → `buildFeuilleDeRoute`. Le panneau journée
 * et l'impression en vue Jour lisent ce même modèle.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appointmentKeys } from '@hooks/cacheKeys';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useClientEquipmentLabels } from '@hooks/useClients';
import { feuilleDeRouteService } from '@services/feuilleDeRoute.service';
import { APPOINTMENT_TYPES } from '@services/appointments.service';
import { getOrgHeadquarters } from '@lib/territoire-config';
import { MAPBOX_CONFIG } from '@/lib/mapbox';
import {
  arretsDeLaJournee, pointsItineraire, cleItineraire, buildFeuilleDeRoute,
  lienGoogleMapsTournee, urlCarteStatique,
} from '@/lib/feuilleDeRoute';

const TYPE_LABELS = Object.fromEntries(APPOINTMENT_TYPES.map((t) => [t.value, t.label]));

/**
 * @param {object} p
 * @param {string} p.orgId        org CORE
 * @param {string|null} p.date    'YYYY-MM-DD' ; null = désactivé
 * @param {string[]} p.memberIds  ids de la personne (team_members.id / commercials.id)
 * @param {{ displayName: string, color?: string }} p.person
 * @returns {{ feuille: object|null, lienMaps: string|null, carteUrl: string|null, isLoading: boolean, error: Error|null }}
 */
export function useFeuilleDeRoute({ orgId, date, memberIds = [], person }) {
  const { settings } = useOrgSettings();
  const { labelsByClientId } = useClientEquipmentLabels();
  const depot = useMemo(() => getOrgHeadquarters(settings), [settings]);
  const enabled = !!orgId && !!date && memberIds.length > 0;

  const rdvsQuery = useQuery({
    queryKey: appointmentKeys.dayRoute(orgId, date),
    queryFn: async () => {
      const { data, error } = await feuilleDeRouteService.getRdvsDuJour({ coreOrgId: orgId, date });
      if (error) throw error;
      return data;
    },
    enabled,
    staleTime: 30_000,
  });

  const idsKey = memberIds.join(',');
  const arrets = useMemo(
    () => arretsDeLaJournee(rdvsQuery.data || [], idsKey ? idsKey.split(',') : []),
    [rdvsQuery.data, idsKey],
  );
  const points = useMemo(() => pointsItineraire(depot, arrets), [depot, arrets]);
  const itineraryKey = cleItineraire(points);

  const legsQuery = useQuery({
    queryKey: appointmentKeys.routeLegs(orgId, itineraryKey),
    queryFn: async () => (await feuilleDeRouteService.calculerTroncons(points)).data,
    enabled: enabled && points.length >= 2,
    staleTime: 10 * 60_000,
  });

  const feuille = useMemo(() => {
    if (!enabled || !rdvsQuery.data) return null;
    return buildFeuilleDeRoute({
      date,
      person,
      depot,
      arrets,
      troncons: legsQuery.data?.troncons || null,
      estime: legsQuery.data?.estime,
      typeLabels: TYPE_LABELS,
      equipmentLabelsByClient: labelsByClientId,
    });
  }, [enabled, rdvsQuery.data, date, person, depot, arrets, legsQuery.data, labelsByClientId]);

  return {
    feuille,
    lienMaps: lienGoogleMapsTournee(depot, arrets),
    carteUrl: urlCarteStatique({ points, geometry: legsQuery.data?.geometry || null, token: MAPBOX_CONFIG.accessToken }),
    sansDepot: !depot,
    isLoading: rdvsQuery.isLoading || (points.length >= 2 && legsQuery.isLoading),
    error: rdvsQuery.error || null,
  };
}
