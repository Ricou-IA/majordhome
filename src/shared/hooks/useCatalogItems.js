/**
 * useCatalogItems.js — Articles Majord'home (base du devis) et harmonisation
 * ============================================================================
 * Contrat unique des mutations : `mutateAsync` résout avec la donnée et REJETTE sur refus (unwrapResult) —
 * l'appelant fait try/catch + toast. Toute mutation invalide la famille `catalogItemKeys.all(orgId)` ET la
 * famille fournisseurs (`supplierKeys.all(orgId)`) : une fusion ou un rattachement change les lignes fournisseur.
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { catalogItemsService } from '@services/catalogItems.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { catalogItemKeys, supplierKeys } from '@hooks/cacheKeys';

export { catalogItemKeys } from '@hooks/cacheKeys';

/** Liste paginée d'articles. `filtres` : { search, categories, brand, gamme, sansCategorie, sansOffreFraiche, avecOffreActive, page, pageSize }. */
export function useCatalogItems(orgId, filtres = {}) {
  const query = useQuery({
    queryKey: catalogItemKeys.list(orgId, filtres),
    queryFn: async () => {
      const { data, count, error } = await catalogItemsService.listItems(orgId, filtres);
      if (error) throw error;
      return { items: data, count };
    },
    enabled: !!orgId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  return { items: query.data?.items || [], count: query.data?.count || 0, isLoading: query.isLoading, isFetching: query.isFetching, refetch: query.refetch, error: query.error };
}

/** Un article. */
export function useCatalogItem(orgId, itemId) {
  const query = useQuery({
    queryKey: catalogItemKeys.detail(orgId, itemId),
    queryFn: async () => {
      const { data, error } = await catalogItemsService.getItem(orgId, itemId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!itemId,
    staleTime: 30_000,
  });
  return { item: query.data ?? null, isLoading: query.isLoading, refetch: query.refetch };
}

/** Offres (lignes fournisseur) d'un ou plusieurs articles. */
export function useCatalogItemOffers(orgId, itemIds = []) {
  const ids = [...new Set((itemIds || []).filter(Boolean))].sort();
  const query = useQuery({
    queryKey: catalogItemKeys.offers(orgId, ids.join(',')),
    queryFn: async () => {
      const { data, error } = await catalogItemsService.getOffers(orgId, ids);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && ids.length > 0,
    staleTime: 30_000,
  });
  return { offers: query.data || [], isLoading: query.isLoading };
}

/** Marques distinctes des articles de l'org. */
export function useCatalogBrands(orgId) {
  const { data, isLoading } = useQuery({
    queryKey: catalogItemKeys.brands(orgId),
    queryFn: async () => {
      const { data, error } = await catalogItemsService.getDistinctBrands(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
  return { brands: data || [], isLoading };
}

/** Gammes distinctes des articles de l'org, pour des catégories (vide = toutes). */
export function useCatalogGammes(orgId, categories = []) {
  const key = (categories || []).join(',');
  const { data, isLoading } = useQuery({
    queryKey: catalogItemKeys.gammes(orgId, key),
    queryFn: async () => {
      const { data, error } = await catalogItemsService.getDistinctGammes(orgId, key ? key.split(',') : []);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
  return { gammes: data || [], isLoading };
}

/** Propositions de fusion par statut (propose | fusionne | refuse | null). */
export function useCatalogProposals(orgId, statut = null) {
  const query = useQuery({
    queryKey: catalogItemKeys.proposals(orgId, statut),
    queryFn: async () => {
      const { data, error } = await catalogItemsService.listProposals(orgId, statut);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
  return { proposals: query.data || [], isLoading: query.isLoading, refetch: query.refetch };
}

/** Compteurs de la page Harmoniser. */
export function useCatalogStats(orgId) {
  const { data, isLoading } = useQuery({
    queryKey: catalogItemKeys.stats(orgId),
    queryFn: async () => {
      const { data, error } = await catalogItemsService.getStats(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
  return { stats: data ?? null, isLoading };
}

/** Mutations : champs humains, fusion, rattacher / détacher, décisions, relance des propositions. */
export function useCatalogItemMutations(orgId) {
  const queryClient = useQueryClient();
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: catalogItemKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: supplierKeys.all(orgId) });
  }, [queryClient, orgId]);

  const update = useMutation({
    mutationFn: ({ itemId, updates }) => unwrapResult(catalogItemsService.updateItem(orgId, itemId, updates)),
    onSuccess: invalidate,
  });
  const merge = useMutation({
    mutationFn: ({ survivorId, absorbedId }) => unwrapResult(catalogItemsService.merge(survivorId, absorbedId)),
    onSuccess: invalidate,
  });
  const attach = useMutation({
    mutationFn: ({ productId, itemId }) => unwrapResult(catalogItemsService.attach(productId, itemId)),
    onSuccess: invalidate,
  });
  const detach = useMutation({
    mutationFn: ({ productId }) => unwrapResult(catalogItemsService.detach(productId)),
    onSuccess: invalidate,
  });
  const decide = useMutation({
    mutationFn: ({ ids, statut }) => unwrapResult(catalogItemsService.decideProposals(ids, statut)),
    onSuccess: invalidate,
  });
  const propose = useMutation({
    mutationFn: () => unwrapResult(catalogItemsService.propose(orgId)),
    onSuccess: invalidate,
  });

  return {
    updateItem: (itemId, updates) => update.mutateAsync({ itemId, updates }),
    merge: (survivorId, absorbedId) => merge.mutateAsync({ survivorId, absorbedId }),
    attach: (productId, itemId) => attach.mutateAsync({ productId, itemId }),
    detach: (productId) => detach.mutateAsync({ productId }),
    decide: (ids, statut) => decide.mutateAsync({ ids, statut }),
    propose: () => propose.mutateAsync(),
    isSaving: update.isPending,
    isMerging: merge.isPending || decide.isPending,
    isLinking: attach.isPending || detach.isPending,
    isProposing: propose.isPending,
  };
}
