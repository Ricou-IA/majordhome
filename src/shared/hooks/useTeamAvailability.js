/**
 * useTeamAvailability.js - Majord'home Artisan
 * ============================================================================
 * Mutation des horaires de travail d'un membre (Settings → Équipe).
 * Contrat unique des mutations : mutateAsync résout avec la valeur STOCKÉE et
 * rejette sur refus (unwrapResult) — l'appelant fait try/catch + toast.
 *
 * Le cache `teamMembers` est patché avec ce que la RPC a réellement écrit
 * (jamais de mise à jour optimiste), puis invalidé pour que les écrans planning
 * relisent la ressource.
 * ============================================================================
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentKeys } from '@hooks/cacheKeys';
import { unwrapResult } from '@/lib/serviceHelpers';
import { teamAvailabilityService } from '@services/teamAvailability.service';

/**
 * @param {string} orgId  org core (clé de cache)
 * @returns {{ setAvailability: (p: { teamMemberId: string, availability: object }) => Promise<object>, isSaving: boolean }}
 */
export function useSetTeamMemberAvailability(orgId) {
  const queryClient = useQueryClient();
  const teamMembersKey = appointmentKeys.teamMembers(orgId);

  const mutation = useMutation({
    mutationFn: ({ teamMemberId, availability }) =>
      unwrapResult(teamAvailabilityService.setAvailability(teamMemberId, availability)),
    onSuccess: (stored, { teamMemberId }) => {
      queryClient.setQueryData(teamMembersKey, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((tm) => (tm.id === teamMemberId ? { ...tm, default_availability: stored } : tm)),
        };
      });
      queryClient.invalidateQueries({ queryKey: teamMembersKey });
    },
  });

  return { setAvailability: mutation.mutateAsync, isSaving: mutation.isPending };
}

export default useSetTeamMemberAvailability;
