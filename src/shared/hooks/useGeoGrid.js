import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { geogridKeys } from './cacheKeys';
import geogridService from '@services/geogrid.service';

export { geogridKeys };

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

/** Résultats d'un scan spécifique. */
export function useGeoGridResults(scanId) {
  return useQuery({
    queryKey: geogridKeys.results(scanId),
    queryFn: async () => {
      const { data, error } = await geogridService.getScanResults(scanId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!scanId,
  });
}

/** Mutation pour lancer un nouveau scan. */
export function useLaunchScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params) => geogridService.launchScan(params),
    onSuccess: (result, variables) => {
      if (result.error) {
        toast.error(`Erreur scan : ${result.error.message || result.error}`);
        return;
      }
      const stats = result.data?.stats;
      toast.success(
        `Scan terminé — Top 3 : ${stats?.top3}/${stats?.total}, Trouvé : ${stats?.found}/${stats?.total}`
      );
      queryClient.invalidateQueries({ queryKey: geogridKeys.list(variables.orgId) });
    },
    onError: (error) => {
      toast.error(`Erreur : ${error.message}`);
    },
  });
}

/** Mutation pour supprimer un scan. */
export function useDeleteScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scanId) => geogridService.deleteScan(scanId),
    onSuccess: () => {
      toast.success('Scan supprimé');
      queryClient.invalidateQueries({ queryKey: geogridKeys.all });
    },
    onError: (error) => {
      toast.error(`Erreur suppression : ${error.message}`);
    },
  });
}
