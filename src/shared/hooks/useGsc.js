import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { gscKeys } from './cacheKeys';
import gscService from '@services/gsc.service';

export { gscKeys };

/** Statut de connexion GSC pour l'org. */
export function useGscStatus(orgId) {
  return useQuery({
    queryKey: gscKeys.status(orgId),
    queryFn: async () => {
      const { data, error } = await gscService.getStatus(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

/**
 * Lit les metrics GSC pour un range donne.
 * range = { dateFrom, dateTo } en YYYY-MM-DD.
 */
export function useGscMetrics(orgId, range, queries) {
  return useQuery({
    queryKey: gscKeys.metrics(orgId, range, queries),
    queryFn: async () => {
      const { data, error } = await gscService.getMetrics(orgId, {
        dateFrom: range?.dateFrom,
        dateTo: range?.dateTo,
        queries,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && !!range?.dateFrom && !!range?.dateTo,
    staleTime: 5 * 60_000,
  });
}

/** Lance le flow OAuth (redirige le browser vers Google). */
export function useGscConnect() {
  return useMutation({
    mutationFn: async ({ orgId, returnTo }) => {
      const { data, error } = await gscService.getAuthUrl(orgId, returnTo);
      if (error) throw error;
      return data;
    },
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err) => {
      toast.error(`Connexion GSC echouee : ${err?.message || err}`);
    },
  });
}

/** Lance une sync GSC manuelle. */
export function useGscSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orgId, monthsBack = 1 }) => {
      const { data, error } = await gscService.triggerSync(orgId, monthsBack);
      if (error) throw error;
      return data;
    },
    onSuccess: (result, variables) => {
      const rows = result?.rowsImported ?? 0;
      const range = result?.dateRange;
      toast.success(
        `Sync GSC OK — ${rows.toLocaleString('fr-FR')} lignes importees${
          range ? ` (${range.startDate} -> ${range.endDate})` : ''
        }`,
      );
      queryClient.invalidateQueries({ queryKey: gscKeys.status(variables.orgId) });
      queryClient.invalidateQueries({ queryKey: [...gscKeys.all, 'metrics', variables.orgId] });
    },
    onError: (err) => {
      toast.error(`Sync GSC echouee : ${err?.message || err}`);
    },
  });
}

/** Disconnect GSC (clear refresh_token). */
export function useGscDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orgId) => {
      const { error } = await gscService.disconnect(orgId);
      if (error) throw error;
      return true;
    },
    onSuccess: (_data, orgId) => {
      toast.success('Search Console deconnecte');
      queryClient.invalidateQueries({ queryKey: gscKeys.status(orgId) });
    },
    onError: (err) => {
      toast.error(`Deconnexion echouee : ${err?.message || err}`);
    },
  });
}
