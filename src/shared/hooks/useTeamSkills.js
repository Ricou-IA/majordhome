/**
 * useTeamSkills.js - Majord'home Artisan
 * ============================================================================
 * Compétences techniciens (type × rôle), cochées comme des droits dans
 * Settings → Équipe. Lecture par membres, écriture par remplacement atomique
 * (RPC team_member_set_skills via teamSkills.service.js).
 *
 * Le cache n'est JAMAIS mis à jour de façon optimiste : on relit après succès.
 * Une case qui n'a pas pu être enregistrée revient donc à son état réel.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamSkillKeys } from '@hooks/cacheKeys';
import { teamSkillsService, indexerCompetences } from '@services/teamSkills.service';

/**
 * @param {string} orgId  org core (clé de cache)
 * @param {string[]} teamMemberIds
 * @returns {{ skillsByMember: Map<string, { entretien: Set<string>, pose: Set<string> }>, isLoading: boolean, error: Error|null }}
 */
export function useTeamSkills(orgId, teamMemberIds) {
  const ids = useMemo(() => [...new Set((teamMemberIds || []).filter(Boolean))], [teamMemberIds]);
  const { data, isLoading, error } = useQuery({
    queryKey: teamSkillKeys.byMembers(orgId, ids),
    queryFn: async () => {
      const r = await teamSkillsService.getTeamMemberSkills(ids);
      if (r.error) throw r.error;
      return r.data;
    },
    enabled: !!orgId && ids.length > 0,
    staleTime: 60_000,
  });
  const skillsByMember = useMemo(() => indexerCompetences(data || [], ids), [data, ids]);
  return { skillsByMember, isLoading, error: error || null };
}

/**
 * @param {string} orgId
 * @returns {{ setSkills: (p: { teamMemberId: string, role: 'entretien'|'pose', equipmentTypeIds: string[] }) => Promise<{ data, error }>, isSaving: boolean }}
 */
export function useSetTeamMemberSkills(orgId) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ teamMemberId, role, equipmentTypeIds }) =>
      teamSkillsService.setTeamMemberSkills(teamMemberId, role, equipmentTypeIds),
    onSuccess: (result) => {
      // Échec logique (error dans le résultat) → rien à rafraîchir, le caller affiche.
      if (result?.error) return;
      queryClient.invalidateQueries({ queryKey: teamSkillKeys.all(orgId) });
    },
  });
  return { setSkills: mutation.mutateAsync, isSaving: mutation.isPending };
}

export default useTeamSkills;
