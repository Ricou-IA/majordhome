/**
 * useFeuilleDeRoute.js — Feuille de route d'une personne pour une journée
 * ============================================================================
 * Orchestration unique écran ↔ impression : RDV du jour → arrêts de la
 * personne → itinéraire → trajets → `buildFeuilleDeRoute`. Le panneau journée
 * et l'impression en vue Jour lisent ce même modèle.
 *
 * Départ / retour : `resoudreExtremites` (tournee/extremites.js), la même règle
 * que le moteur — exception du jour > réglage du technicien > agence.
 * `simulation` (local, jamais enregistré) passe devant pour voir en direct les
 * trajets depuis un autre point ; le moteur de tournées ne le voit pas.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appointmentKeys } from '@hooks/cacheKeys';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useClientEquipmentLabels } from '@hooks/useClients';
import { useTeamMembers } from '@hooks/useAppointments';
import { useDayEndpoint } from '@hooks/useDayEndpoint';
import { useAuth } from '@contexts/AuthContext';
import { resoudreExtremites } from '@/lib/tournee/extremites.js';
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
 * @param {{ depart?: object|null, retour?: object|null }|null} [p.simulation]  points simulés `{ lat, lng, label }`
 * @returns {{ feuille: object|null, lienMaps: string|null, carteUrl: string|null, isLoading: boolean, error: Error|null,
 *   depart: object|null, retour: object|null, membre: object|null, exception: object|null,
 *   setException: Function, isSavingException: boolean, peutChoisir: boolean }}
 *   `peutChoisir` : l'utilisateur peut poser l'exception du jour (team_leader+) et la personne a une ressource planning.
 */
export function useFeuilleDeRoute({ orgId, date, memberIds = [], person, simulation = null }) {
  const { settings } = useOrgSettings();
  const { labelsByClientId } = useClientEquipmentLabels();
  const { isTeamLeaderOrAbove } = useAuth();
  const { members } = useTeamMembers(orgId);
  const siege = useMemo(() => getOrgHeadquarters(settings), [settings]);
  const enabled = !!orgId && !!date && memberIds.length > 0;

  // La ressource planning de la personne (un commercial sans ressource reste à l'agence).
  const membre = useMemo(
    () => (members || []).find((tm) => memberIds.includes(tm.id)) || null,
    [members, memberIds],
  );
  const { exception, setException, isSaving: isSavingException } = useDayEndpoint({
    orgId, teamMemberId: membre?.id || null, date,
  });
  const reels = useMemo(
    () => resoudreExtremites({ siege, membre, exception }),
    [siege, membre, exception],
  );
  const depart = simulation?.depart || reels.depart;
  const retour = simulation?.retour || reels.retour;

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
  const points = useMemo(() => pointsItineraire(depart, arrets, retour), [depart, arrets, retour]);
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
      depart,
      retour,
      arrets,
      troncons: legsQuery.data?.troncons || null,
      estime: legsQuery.data?.estime,
      typeLabels: TYPE_LABELS,
      equipmentLabelsByClient: labelsByClientId,
    });
  }, [enabled, rdvsQuery.data, date, person, depart, retour, arrets, legsQuery.data, labelsByClientId]);

  return {
    feuille,
    lienMaps: lienGoogleMapsTournee(depart, arrets, retour),
    carteUrl: urlCarteStatique({ points, geometry: legsQuery.data?.geometry || null, token: MAPBOX_CONFIG.accessToken }),
    sansDepot: !depart,
    depart,
    retour,
    membre,
    exception,
    setException,
    isSavingException,
    peutChoisir: !!isTeamLeaderOrAbove && !!membre,
    isLoading: rdvsQuery.isLoading || (points.length >= 2 && legsQuery.isLoading),
    error: rdvsQuery.error || null,
  };
}
