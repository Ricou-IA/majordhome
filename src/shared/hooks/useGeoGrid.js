import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { geogridKeys } from './cacheKeys';
import geogridService from '@services/geogrid.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { useAuth } from '@contexts/AuthContext';

export { geogridKeys };

// Contrat unique des mutations : `mutateAsync` résout avec la donnée et REJETTE
// sur refus (unwrapResult). Les toasts vivent ici : succès dans onSuccess (qui ne
// se déclenche plus sur un refus), erreur dans onError. Les composants appellent
// `mutate` / `mutateAsync` sans relire { error }.

/** Liste des scans passés pour l'org. */
export function useGeoGridScans(orgId) {
  return useQuery({
    queryKey: geogridKeys.list(orgId),
    queryFn: async () => {
      const { data, error } = await geogridService.getScans(orgId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });
}

/**
 * Consommation Google Places API du mois calendaire en cours (bornes UTC).
 * Retourne { requestsUsed, scansCount, monthStart, freeTierLimit, percentUsed }.
 * Le free tier Google Places API Text Search Pro = 5000 req / mois UTC.
 */
const FREE_TIER_LIMIT = 5000;

export function useGeoGridQuota(orgId) {
  return useQuery({
    queryKey: geogridKeys.quota(orgId),
    queryFn: async () => {
      const { data, error } = await geogridService.getMonthlyUsage(orgId);
      if (error) throw error;
      const requestsUsed = data?.requestsUsed || 0;
      return {
        requestsUsed,
        scansCount: data?.scansCount || 0,
        monthStart: data?.monthStart,
        freeTierLimit: FREE_TIER_LIMIT,
        percentUsed: Math.round((requestsUsed / FREE_TIER_LIMIT) * 100),
        remaining: Math.max(0, FREE_TIER_LIMIT - requestsUsed),
      };
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

/** Résultats d'un scan spécifique. */
export function useGeoGridResults(scanId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: geogridKeys.results(orgId, scanId),
    queryFn: async () => {
      const { data, error } = await geogridService.getScanResults(scanId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && !!scanId,
  });
}

/** Mutation pour lancer un nouveau scan. */
export function useLaunchScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params) => unwrapResult(geogridService.launchScan(params)),
    onSuccess: (scan, variables) => {
      const stats = scan?.stats;
      toast.success(
        `Scan terminé — Top 3 : ${stats?.top3}/${stats?.total}, Trouvé : ${stats?.found}/${stats?.total}`
      );
      queryClient.invalidateQueries({ queryKey: geogridKeys.list(variables.orgId) });
      queryClient.invalidateQueries({ queryKey: geogridKeys.quota(variables.orgId) });
    },
    onError: (error) => {
      toast.error(`Erreur scan : ${error?.message || error}`);
    },
  });
}

/** Mutation pour supprimer un scan. */
export function useDeleteScan() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  return useMutation({
    mutationFn: (scanId) => unwrapResult(geogridService.deleteScan(scanId)),
    onSuccess: () => {
      toast.success('Scan supprimé');
      queryClient.invalidateQueries({ queryKey: geogridKeys.all(orgId) });
    },
    onError: (error) => {
      toast.error(`Erreur suppression : ${error?.message || error}`);
    },
  });
}

// =============================================================
// Listes de keywords (curated, réutilisables pour benchmarks)
// =============================================================

export function useKeywordLists(orgId) {
  return useQuery({
    queryKey: geogridKeys.keywordLists(orgId),
    queryFn: async () => {
      const { data, error } = await geogridService.getKeywordLists(orgId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });
}

export function useCreateKeywordList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, ...payload }) => unwrapResult(geogridService.createKeywordList(orgId, payload)),
    onSuccess: (_list, variables) => {
      toast.success('Liste créée');
      queryClient.invalidateQueries({ queryKey: geogridKeys.keywordLists(variables.orgId) });
    },
    onError: (error) => toast.error(`Erreur : ${error?.message || error}`),
  });
}

export function useUpdateKeywordList() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useMutation({
    mutationFn: ({ listId, ...payload }) => unwrapResult(geogridService.updateKeywordList(listId, payload)),
    onSuccess: (_list, variables) => {
      toast.success('Liste mise à jour');
      if (variables.orgId) {
        queryClient.invalidateQueries({ queryKey: geogridKeys.keywordLists(variables.orgId) });
      } else {
        queryClient.invalidateQueries({ queryKey: geogridKeys.all(orgId) });
      }
    },
    onError: (error) => toast.error(`Erreur : ${error?.message || error}`),
  });
}

export function useDeleteKeywordList() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useMutation({
    mutationFn: (listId) => unwrapResult(geogridService.deleteKeywordList(listId)),
    onSuccess: () => {
      toast.success('Liste supprimée');
      queryClient.invalidateQueries({ queryKey: geogridKeys.all(orgId) });
    },
    onError: (error) => toast.error(`Erreur : ${error?.message || error}`),
  });
}

// =============================================================
// Benchmarks (run d'une liste sur N keywords = N scans liés)
// =============================================================

export function useBenchmarks(orgId) {
  return useQuery({
    queryKey: geogridKeys.benchmarks(orgId),
    queryFn: async () => {
      const { data, error } = await geogridService.getBenchmarks(orgId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });
}

export function useBenchmarkScans(benchmarkId) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useQuery({
    queryKey: geogridKeys.benchmarkScans(orgId, benchmarkId),
    queryFn: async () => {
      const { data, error } = await geogridService.getBenchmarkScans(benchmarkId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && !!benchmarkId,
  });
}

export function useDeleteBenchmark() {
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;
  return useMutation({
    mutationFn: (benchmarkId) => unwrapResult(geogridService.deleteBenchmark(benchmarkId)),
    onSuccess: () => {
      toast.success('Benchmark supprimé');
      queryClient.invalidateQueries({ queryKey: geogridKeys.all(orgId) });
    },
    onError: (error) => toast.error(`Erreur : ${error?.message || error}`),
  });
}

export { FREE_TIER_LIMIT };
