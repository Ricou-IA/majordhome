// src/shared/hooks/useFumisterie.js
import { useMemo } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { motifDependDuDiametre } from '@/lib/fumisterie/articles.js';
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
/**
 * Chaque fabricant de fumisterie de l'organisation avec ce qu'il faut pour calculer le relevé chez lui :
 * mapping des composants de la configuration, équivalences de gamme, articles au Ø du relevé. Un fabricant sans
 * mapping pour la configuration est écarté par le moteur (comparerFabricants), pas ici.
 * @returns {{ fabricants: Array<{ supplierId, nom, mapping, articles, equivalences, historique }>, avecVue: boolean,
 *   isLoading: boolean, isPlaceholder: boolean, error: Error|null }}
 */
export function useFumFabricantsDuMetre(orgId, bundle, diametre) {
  const fabQ = useQuery({ queryKey: fumisterieKeys.fabricants(orgId), queryFn: () => unwrapResult(fumisterieService.getFabricants(orgId)), enabled: !!orgId, staleTime: 30 * 60 * 1000 });
  const liste = fabQ.data?.fabricants || [];
  const codes = [...new Set((bundle?.composants || []).map((c) => c.composant_code))];
  const configCode = bundle?.configuration?.code;
  const eqQ = useQuery({ queryKey: fumisterieKeys.equivalences(orgId, configCode), queryFn: () => unwrapResult(fumisterieService.getEquivalences(orgId, configCode)), enabled: !!orgId && !!configCode, staleTime: 5 * 60 * 1000 });
  const mapQs = useQueries({ queries: liste.map((f) => ({
    queryKey: fumisterieKeys.mapping(orgId, f.id, codes), queryFn: () => unwrapResult(fumisterieService.getMapping(orgId, f.id, codes)),
    enabled: !!orgId && codes.length > 0, staleTime: 5 * 60 * 1000 })) });
  const artQs = useQueries({ queries: liste.map((f, i) => {
    const mapping = mapQs[i]?.data || [];
    const gammes = [...new Set(mapping.map((m) => m.gamme_tarif))];
    const sansD = [...new Set(mapping.filter((m) => !motifDependDuDiametre(m.motif_code)).map((m) => m.gamme_tarif))];
    return { queryKey: fumisterieKeys.articles(orgId, f.id, [...gammes, ...sansD.map((g) => `*${g}`)], diametre),
      queryFn: () => unwrapResult(fumisterieService.getArticles(orgId, f.id, { gammesTarif: gammes, diametre, gammesSansDiametre: sansD })),
      enabled: !!orgId && !!diametre && gammes.length > 0, staleTime: 5 * 60 * 1000, placeholderData: keepPreviousData };
  }) });
  // Liste stable entre deux rendus tant qu'aucune donnée n'a changé (le calcul du métré en dépend).
  const signature = [fabQ.dataUpdatedAt, eqQ.dataUpdatedAt, ...mapQs.map((q) => q.dataUpdatedAt), ...artQs.map((q) => q.dataUpdatedAt), liste.length].join('|');
  const fabricants = useMemo(() => {
    const equivalences = eqQ.data || [];
    return liste.map((f, i) => {
      // Le fabricant dont le mapping a été écrit avec le catalogue des configurations fait référence (aucune équivalence).
      const historique = !equivalences.some((e) => e.supplier_id === f.id);
      return {
        supplierId: f.id, nom: f.name, mapping: mapQs[i]?.data || [], articles: artQs[i]?.data || [],
        equivalences: equivalences.filter((e) => e.supplier_id === f.id), historique,
        // Achat = prix net négocié, vente = prix public : confirmé par Eric pour DINAK le 2026-11-28 (mis à jour à l'usage).
        prixVerifies: true,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const requetes = [fabQ, eqQ, ...mapQs, ...artQs];
  return {
    fabricants, avecVue: fabQ.data?.avecVue !== false,
    isLoading: fabQ.isLoading || eqQ.isLoading || mapQs.some((q) => q.isLoading) || artQs.some((q) => q.isLoading && q.fetchStatus !== 'idle'),
    isPlaceholder: artQs.some((q) => q.isPlaceholderData),
    error: requetes.find((q) => q.isError)?.error || null,
  };
}
/** Dernier métré enregistré d'un devis (null si le devis n'en a pas). */
export function useFumMetreByQuote(orgId, quoteId) {
  return useQuery({ queryKey: fumisterieKeys.metreByQuote(orgId, quoteId), queryFn: () => unwrapResult(fumisterieService.getMetreByQuote(orgId, quoteId)), enabled: !!orgId && !!quoteId, staleTime: 5 * 60 * 1000 });
}
export function useFumMetreMutations(orgId) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (payload) => unwrapResult(fumisterieService.saveMetre({ orgId, ...payload })),
    onSuccess: (data) => { if (data?.quote_id) qc.invalidateQueries({ queryKey: fumisterieKeys.metreByQuote(orgId, data.quote_id) }); },
  });
  return { saveMetre: save.mutateAsync, isSaving: save.isPending };
}
