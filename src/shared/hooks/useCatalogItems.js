/**
 * useCatalogItems.js — Articles Majord'home (base du devis) et harmonisation
 * ============================================================================
 * Contrat unique des mutations : `mutateAsync` résout avec la donnée et REJETTE sur refus (unwrapResult) —
 * l'appelant fait try/catch + toast. Toute mutation invalide la famille `catalogItemKeys.all(orgId)` ET la
 * famille fournisseurs (`supplierKeys.all(orgId)`) : une fusion ou un rattachement change les lignes fournisseur.
 * ============================================================================
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { catalogItemsService } from '@services/catalogItems.service';
import { suppliersService } from '@services/suppliers.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { catalogItemKeys, supplierKeys } from '@hooks/cacheKeys';

export { catalogItemKeys } from '@hooks/cacheKeys';

/** Liste paginée d'articles. `filtres` : { search, categories, natures, brand, gamme, sansCategorie, sansOffreFraiche, proposable, page, pageSize }. */
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

/** Article actuel (nom, nombre de lignes) de lignes candidates au rattachement, indexé par id. */
export function useCatalogItemsResume(orgId, ids = []) {
  const idsKey = [...new Set(ids.filter(Boolean))].sort().join(',');
  const { data, error } = useQuery({
    queryKey: catalogItemKeys.resume(orgId, idsKey),
    queryFn: async () => {
      const { data: rows, error: err } = await catalogItemsService.getItemsResume(orgId, idsKey.split(','));
      if (err) throw err;
      return rows;
    },
    enabled: !!orgId && !!idsKey,
    staleTime: 30_000,
  });
  const articles = useMemo(() => new Map((data || []).map((a) => [a.id, a])), [data]);
  return { articles, error };
}

/** Articles (prix, unité, catégorie, specs) des lignes d'un devis, indexés par id : alimente l'éditeur et le réalignement. */
export function useCatalogItemsSpecs(orgId, ids = []) {
  const idsKey = [...new Set(ids.filter(Boolean))].sort().join(',');
  const { data, error, isLoading } = useQuery({
    queryKey: catalogItemKeys.specs(orgId, idsKey),
    queryFn: async () => {
      const { data: rows, error: err } = await catalogItemsService.getItemsSpecs(orgId, idsKey.split(','));
      if (err) throw err;
      return rows;
    },
    enabled: !!orgId && !!idsKey,
    staleTime: 30_000,
  });
  const articles = useMemo(() => new Map((data || []).map((a) => [a.id, a])), [data]);
  return { articles, isLoading, error };
}

/** Documents d'un article (posés sur l'article + ceux de ses lignes fournisseur, sans doublon) et leurs mutations. */
export function useCatalogItemDocuments(orgId, itemId, productIds = []) {
  const queryClient = useQueryClient();
  const idsKey = [...productIds].sort().join(',');
  const key = catalogItemKeys.documents(orgId, itemId, idsKey);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await catalogItemsService.getItemDocuments(orgId, itemId, idsKey ? idsKey.split(',') : []);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!itemId,
    staleTime: 30_000,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [...catalogItemKeys.all(orgId), 'documents', itemId] });
  const upload = useMutation({
    mutationFn: (payload) => unwrapResult(catalogItemsService.uploadItemDocument({ orgId, itemId, ...payload })),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (doc) => unwrapResult(catalogItemsService.deleteItemDocument(orgId, doc)),
    onSuccess: invalidate,
  });
  return {
    documents: query.data || [], isLoading: query.isLoading,
    upload: upload.mutateAsync, remove: remove.mutateAsync, isUploading: upload.isPending, isRemoving: remove.isPending,
  };
}

/** Marques distinctes des articles de l'org, pour des catégories (vide = toutes). */
export function useCatalogBrands(orgId, categories = []) {
  const key = (categories || []).join(',');
  const { data, isLoading } = useQuery({
    queryKey: [...catalogItemKeys.brands(orgId), key],
    queryFn: async () => {
      const { data, error } = await catalogItemsService.getDistinctBrands(orgId, key ? key.split(',') : []);
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
  const create = useMutation({
    mutationFn: (payload) => unwrapResult(catalogItemsService.createItem(orgId, payload)),
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
  const createForProduct = useMutation({
    mutationFn: ({ productId }) => unwrapResult(catalogItemsService.createForProduct(productId)),
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
  const uploadImage = useMutation({
    mutationFn: ({ itemId, file }) => unwrapResult(catalogItemsService.uploadItemImage({ orgId, itemId, file })),
    onSuccess: invalidate,
  });
  // Clés modèle par l'IA sur toutes les lignes de l'org sans clé (edge catalog-normalize, supplier_id absent)
  const normalize = useMutation({
    mutationFn: (limit) => unwrapResult(suppliersService.normalizeCatalog(orgId, null, limit)),
    onSuccess: invalidate,
  });

  // Enrichissement web : la proposition n'écrit rien (pas d'invalidation) ; l'application écrit photo, document, specs
  const proposeEnrichment = useMutation({
    mutationFn: ({ itemId, champs }) => unwrapResult(catalogItemsService.proposeEnrichment(orgId, itemId, champs)),
  });
  const applyEnrichment = useMutation({
    mutationFn: ({ itemId, selection }) => unwrapResult(catalogItemsService.applyEnrichment(orgId, itemId, selection)),
    onSuccess: invalidate,
  });

  return {
    proposeEnrichment: (itemId, champs) => proposeEnrichment.mutateAsync({ itemId, champs }),
    isProposingEnrichment: proposeEnrichment.isPending,
    applyEnrichment: (itemId, selection) => applyEnrichment.mutateAsync({ itemId, selection }),
    isApplyingEnrichment: applyEnrichment.isPending,
    normalize: (limit = 100) => normalize.mutateAsync(limit),
    isNormalizing: normalize.isPending,
    updateItem: (itemId, updates) => update.mutateAsync({ itemId, updates }),
    createItem: (payload) => create.mutateAsync(payload),
    isCreating: create.isPending,
    uploadImage: (itemId, file) => uploadImage.mutateAsync({ itemId, file }),
    merge: (survivorId, absorbedId) => merge.mutateAsync({ survivorId, absorbedId }),
    attach: (productId, itemId) => attach.mutateAsync({ productId, itemId }),
    detach: (productId) => detach.mutateAsync({ productId }),
    createForProduct: (productId) => createForProduct.mutateAsync({ productId }),
    decide: (ids, statut) => decide.mutateAsync({ ids, statut }),
    propose: () => propose.mutateAsync(),
    isSaving: update.isPending,
    isMerging: merge.isPending || decide.isPending,
    isLinking: attach.isPending || detach.isPending || createForProduct.isPending,
    isProposing: propose.isPending,
  };
}
