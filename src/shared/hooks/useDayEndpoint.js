/**
 * useDayEndpoint.js — Exception « Départ / Retour : Agence » d'une journée
 * ============================================================================
 * Lit et écrit l'exception d'un technicien pour une date. Écrire invalide la
 * feuille de route du jour et les journées du moteur de tournées (qui lisent la
 * même exception via loaders.js).
 * ============================================================================
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentKeys, dayEndpointKeys, tourneeKeys } from '@hooks/cacheKeys';
import { dayEndpointsService } from '@services/dayEndpoints.service';
import { unwrapResult } from '@/lib/serviceHelpers';

/**
 * @param {{ orgId: string, teamMemberId: string|null, date: string|null }} p  `orgId` = org CORE
 * @returns {{ exception: { depart: string|null, retour: string|null }|null, isLoading: boolean,
 *   setException: (next: { depart: string|null, retour: string|null }) => Promise<object|null>, isSaving: boolean }}
 */
export function useDayEndpoint({ orgId, teamMemberId, date }) {
  const queryClient = useQueryClient();
  const enabled = !!orgId && !!teamMemberId && !!date;
  const key = dayEndpointKeys.byDay(orgId, teamMemberId, date);

  const query = useQuery({
    queryKey: key,
    queryFn: () => unwrapResult(dayEndpointsService.get({ coreOrgId: orgId, teamMemberId, date })),
    enabled,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (next) => unwrapResult(dayEndpointsService.set({
      teamMemberId, date, depart: next?.depart ?? null, retour: next?.retour ?? null,
    })),
    onSuccess: (row) => {
      queryClient.setQueryData(key, row ?? null);
      queryClient.invalidateQueries({ queryKey: dayEndpointKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: appointmentKeys.dayRoute(orgId, date) });
      queryClient.invalidateQueries({ queryKey: tourneeKeys.all(orgId) });
    },
  });

  return {
    exception: query.data ?? null,
    isLoading: enabled && query.isLoading,
    setException: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
