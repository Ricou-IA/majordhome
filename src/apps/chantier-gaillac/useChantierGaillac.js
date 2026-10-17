/**
 * useChantierGaillac.js — hooks du suivi « Chantier Gaillac » (module provisoire).
 *
 * Cache keys LOCALES au module (exception assumée à la centralisation cacheKeys.js : le module
 * se retire en supprimant son dossier). Convention P0.11 respectée : orgId en 1ᵉʳ paramètre.
 * Rafraîchissement : pas de Realtime dans l'app → refetch toutes les 60 s + au retour sur l'onglet.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMajordhomeOrgId, unwrapResult } from '@/lib/serviceHelpers';
import { chantierGaillacService } from './chantierGaillac.service';

export const chantierGaillacKeys = {
  all: (orgId) => ['chantier-gaillac', orgId],
  mdhOrg: (orgId) => ['chantier-gaillac', orgId, 'mdh-org'],
  taches: (orgId) => ['chantier-gaillac', orgId, 'taches'],
  planning: (orgId) => ['chantier-gaillac', orgId, 'planning'],
  team: (orgId) => ['chantier-gaillac', orgId, 'team'],
};

const LIVE = { refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 15_000 };

/**
 * Données du chantier. `orgId` = org CORE (useAuth().organization.id) ; les tables portent l'org majordhome.
 */
export function useChantierGaillac(orgId) {
  const mdh = useQuery({
    queryKey: chantierGaillacKeys.mdhOrg(orgId),
    queryFn: () => getMajordhomeOrgId(orgId),
    enabled: !!orgId,
    staleTime: Infinity,
  });
  const mdhOrgId = mdh.data;

  const taches = useQuery({
    queryKey: chantierGaillacKeys.taches(orgId),
    queryFn: () => unwrapResult(chantierGaillacService.fetchTaches(mdhOrgId)),
    enabled: !!orgId && !!mdhOrgId,
    ...LIVE,
  });
  const planning = useQuery({
    queryKey: chantierGaillacKeys.planning(orgId),
    queryFn: () => unwrapResult(chantierGaillacService.fetchPlanning(mdhOrgId)),
    enabled: !!orgId && !!mdhOrgId,
    ...LIVE,
  });
  const team = useQuery({
    queryKey: chantierGaillacKeys.team(orgId),
    queryFn: () => unwrapResult(chantierGaillacService.fetchTeam(mdhOrgId)),
    enabled: !!orgId && !!mdhOrgId,
    staleTime: 10 * 60_000,
  });

  return {
    mdhOrgId,
    taches: taches.data || [],
    planning: planning.data || [],
    team: team.data || [],
    isLoading: mdh.isLoading || taches.isLoading || planning.isLoading,
    error: mdh.error || taches.error || planning.error || team.error,
    isFetching: taches.isFetching || planning.isFetching,
    dataUpdatedAt: taches.dataUpdatedAt,
  };
}

/** Patch optimiste d'une tâche dans le cache ; renvoie l'état précédent pour le retour arrière. */
function useOptimisticTache(orgId) {
  const qc = useQueryClient();
  const key = chantierGaillacKeys.taches(orgId);
  return {
    async apply(id, patch) {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData(key);
      qc.setQueryData(key, (old) => (old || []).map((t) => (t.id === id ? { ...t, ...patch } : t)));
      return { previous };
    },
    rollback(ctx) {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    merge(id, row) {
      qc.setQueryData(key, (old) => (old || []).map((t) => (t.id === id ? { ...t, ...row } : t)));
    },
  };
}

/** Mutations du suivi. mutateAsync REJETTE sur refus (try/catch + toast côté appelant). */
export function useChantierGaillacMutations(orgId, mdhOrgId, userId) {
  const qc = useQueryClient();
  const optimistic = useOptimisticTache(orgId);

  const setFait = useMutation({
    mutationFn: ({ id, fait }) => unwrapResult(chantierGaillacService.setFait(mdhOrgId, id, fait)),
    onMutate: ({ id, fait }) => optimistic.apply(id, {
      fait,
      fait_le: fait ? new Date().toISOString() : null,
      fait_par: fait ? userId : null,
    }),
    onError: (_e, _v, ctx) => optimistic.rollback(ctx),
    onSuccess: (row) => optimistic.merge(row.id, row),
  });

  const setCommentaire = useMutation({
    mutationFn: ({ id, texte }) => unwrapResult(chantierGaillacService.setCommentaire(mdhOrgId, id, texte)),
    onMutate: ({ id, texte }) => optimistic.apply(id, { commentaire_terrain: (texte || '').trim() || null }),
    onError: (_e, _v, ctx) => optimistic.rollback(ctx),
    onSuccess: (row) => optimistic.merge(row.id, row),
  });

  const setDatePrevue = useMutation({
    mutationFn: ({ code, date }) => unwrapResult(chantierGaillacService.setDatePrevue(mdhOrgId, code, date)),
    onSuccess: () => qc.invalidateQueries({ queryKey: chantierGaillacKeys.planning(orgId) }),
  });

  return { setFait, setCommentaire, setDatePrevue };
}
