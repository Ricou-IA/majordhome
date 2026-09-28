// src/shared/hooks/useFumisterie.js
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { fumisterieService } from '@services/fumisterie.service';
import { fumisterieKeys } from '@hooks/cacheKeys';
import { unwrapResult } from '@/lib/serviceHelpers';

export { fumisterieKeys };

export function useFumConfigurations(orgId) {
  return useQuery({ queryKey: fumisterieKeys.configurations(orgId), queryFn: () => unwrapResult(fumisterieService.getConfigurations(orgId)), enabled: !!orgId, staleTime: 5 * 60 * 1000 });
}
export function useFumBundle(orgId, configurationId) {
  return useQuery({ queryKey: fumisterieKeys.bundle(orgId, configurationId), queryFn: () => unwrapResult(fumisterieService.getBundle(orgId, configurationId)), enabled: !!orgId && !!configurationId, staleTime: 5 * 60 * 1000 });
}
export function useFumSupplier(orgId) {
  return useQuery({ queryKey: fumisterieKeys.supplier(orgId), queryFn: () => unwrapResult(fumisterieService.getSupplier(orgId)), enabled: !!orgId, staleTime: 30 * 60 * 1000 });
}
export function useFumArticles(orgId, supplierId, gammesTarif, diametre) {
  return useQuery({
    queryKey: fumisterieKeys.articles(orgId, supplierId, gammesTarif, diametre),
    queryFn: () => unwrapResult(fumisterieService.getArticles(orgId, supplierId, { gammesTarif, diametre })),
    enabled: !!orgId && !!supplierId && !!diametre && (gammesTarif?.length || 0) > 0, staleTime: 5 * 60 * 1000,
    // Changement de Ø : garder les articles précédents le temps du fetch (le relevé ne se démonte pas)
    placeholderData: keepPreviousData,
  });
}
export function useFumMetreByQuote(orgId, quoteId) {
  return useQuery({ queryKey: fumisterieKeys.metreByQuote(orgId, quoteId), queryFn: () => unwrapResult(fumisterieService.getMetreByQuote(orgId, quoteId)), enabled: !!orgId && !!quoteId });
}
export function useFumMetreMutations(orgId) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (payload) => unwrapResult(fumisterieService.saveMetre({ orgId, ...payload })),
    onSuccess: (data) => { if (data?.quote_id) qc.invalidateQueries({ queryKey: fumisterieKeys.metreByQuote(orgId, data.quote_id) }); },
  });
  return { saveMetre: save.mutateAsync, isSaving: save.isPending };
}
