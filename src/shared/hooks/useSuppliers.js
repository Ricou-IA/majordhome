/**
 * useSuppliers.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour la gestion des fournisseurs et catalogue produits.
 * ============================================================================
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suppliersService } from '@services/suppliers.service';
import { supplierKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { supplierKeys } from '@hooks/cacheKeys';

// ============================================================================
// FOURNISSEURS
// ============================================================================

/**
 * Liste des fournisseurs actifs
 */
export function useSuppliers(orgId) {
  const {
    data: suppliers,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: supplierKeys.list(orgId),
    queryFn: async () => {
      const { data, error } = await suppliersService.getSuppliers(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  return { suppliers: suppliers || [], isLoading, error, refetch };
}

/**
 * Détail d'un fournisseur
 */
export function useSupplierDetail(supplierId) {
  return useQuery({
    queryKey: supplierKeys.detail(supplierId),
    queryFn: async () => {
      const { data, error } = await suppliersService.getSupplierById(supplierId);
      if (error) throw error;
      return data;
    },
    enabled: !!supplierId,
    staleTime: 60_000,
  });
}

/**
 * Mutations CRUD fournisseurs
 */
export function useSupplierMutations(orgId) {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data) => suppliersService.createSupplier({ orgId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.list(orgId) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ supplierId, updates }) => suppliersService.updateSupplier(supplierId, updates),
    onSuccess: (_, { supplierId }) => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.list(orgId) });
      queryClient.invalidateQueries({ queryKey: supplierKeys.detail(supplierId) });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (supplierId) => suppliersService.deactivateSupplier(supplierId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.list(orgId) });
    },
  });

  const createSupplier = useCallback(async (data) => createMutation.mutateAsync(data), [createMutation]);
  const updateSupplier = useCallback(async (supplierId, updates) => updateMutation.mutateAsync({ supplierId, updates }), [updateMutation]);
  const deactivateSupplier = useCallback(async (supplierId) => deactivateMutation.mutateAsync(supplierId), [deactivateMutation]);

  return {
    createSupplier,
    updateSupplier,
    deactivateSupplier,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeactivating: deactivateMutation.isPending,
  };
}

// ============================================================================
// PRODUITS
// ============================================================================

/**
 * Produits d'un fournisseur (paginé côté serveur)
 * kind : 'main' | 'accessory' | 'consumable' (null = tous)
 */
export function useSupplierProducts(supplierId, { search = '', kind = null, page = 0, pageSize = 50 } = {}) {
  const offset = page * pageSize;

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [...supplierKeys.products(supplierId), search, kind, page, pageSize],
    queryFn: async () => {
      const result = await suppliersService.getProducts(supplierId, { search, kind, limit: pageSize, offset });
      if (result.error) throw result.error;
      return { products: result.data, count: result.count };
    },
    enabled: !!supplierId,
    staleTime: 30_000,
    keepPreviousData: true,
  });

  return {
    products: data?.products || [],
    totalCount: data?.count || 0,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Accessoires compatibles avec un produit donné
 */
export function useAccessoriesForProduct(productId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...supplierKeys.all, 'accessories-for', productId],
    queryFn: async () => {
      const { data, error } = await suppliersService.getAccessoriesForProduct(productId);
      if (error) throw error;
      return data;
    },
    enabled: !!productId,
    staleTime: 30_000,
  });
  return { accessories: data || [], isLoading, error, refetch };
}

/**
 * Tous les produits de l'org (pour le picker dans le devis)
 */
export function useAllProducts(orgId) {
  const {
    data: products,
    isLoading,
    error,
  } = useQuery({
    queryKey: supplierKeys.allProducts(orgId),
    queryFn: async () => {
      const { data, error } = await suppliersService.getProductsByOrg(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  return { products: products || [], isLoading, error };
}

/**
 * Recherche produits (debounced côté composant)
 */
export function useProductSearch(orgId, query) {
  const {
    data: results,
    isLoading,
  } = useQuery({
    queryKey: supplierKeys.searchProducts(orgId, query),
    queryFn: async () => {
      const { data, error } = await suppliersService.searchProducts(orgId, query);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!query && query.length >= 2,
    staleTime: 10_000,
  });

  return { results: results || [], isLoading };
}

/**
 * Mutations CRUD produits
 */
export function useProductMutations(orgId, supplierId) {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    if (supplierId) queryClient.invalidateQueries({ queryKey: supplierKeys.products(supplierId) });
    queryClient.invalidateQueries({ queryKey: supplierKeys.allProducts(orgId) });
  };

  const createMutation = useMutation({
    mutationFn: (data) => suppliersService.createProduct({ supplierId, orgId, ...data }),
    onSuccess: invalidateAll,
  });

  const updateMutation = useMutation({
    mutationFn: ({ productId, updates }) => suppliersService.updateProduct(productId, updates),
    onSuccess: invalidateAll,
  });

  const deactivateMutation = useMutation({
    mutationFn: (productId) => suppliersService.deactivateProduct(productId),
    onSuccess: invalidateAll,
  });

  const createProduct = useCallback(async (data) => createMutation.mutateAsync(data), [createMutation]);
  const updateProduct = useCallback(async (productId, updates) => updateMutation.mutateAsync({ productId, updates }), [updateMutation]);
  const deactivateProduct = useCallback(async (productId) => deactivateMutation.mutateAsync(productId), [deactivateMutation]);

  return {
    createProduct,
    updateProduct,
    deactivateProduct,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}

// =============================================================================
// DÉTAIL PRODUIT + VARIANTES
// =============================================================================

/**
 * Détail d'un produit (pour la fiche produit enrichie)
 */
export function useProductDetail(productId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: supplierKeys.productDetail(productId),
    queryFn: async () => {
      const { data, error } = await suppliersService.getProductById(productId);
      if (error) throw error;
      return data;
    },
    enabled: !!productId,
    staleTime: 30_000,
  });

  return { product: data, isLoading, error, refetch };
}

/**
 * Variantes d'un produit parent (G1 acier → G1 pierre ollaire, G1 pierre blanche)
 */
export function useProductVariants(parentId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: supplierKeys.productVariants(parentId),
    queryFn: async () => {
      const { data, error } = await suppliersService.getProductVariants(parentId);
      if (error) throw error;
      return data;
    },
    enabled: !!parentId,
    staleTime: 30_000,
  });

  return { variants: data || [], isLoading, error, refetch };
}

/**
 * Mutations image produit (upload depuis file, set depuis URL externe, clear)
 */
export function useProductImageMutations(orgId, productId, supplierId) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: supplierKeys.productDetail(productId) });
    if (supplierId) queryClient.invalidateQueries({ queryKey: supplierKeys.products(supplierId) });
    queryClient.invalidateQueries({ queryKey: supplierKeys.allProducts(orgId) });
  };

  const uploadMutation = useMutation({
    mutationFn: ({ file }) => suppliersService.uploadProductImage({ orgId, productId, file }),
    onSuccess: invalidate,
  });

  const setFromUrlMutation = useMutation({
    mutationFn: ({ imageUrl, sourceUrl }) =>
      suppliersService.setProductImageFromUrl(productId, imageUrl, sourceUrl),
    onSuccess: invalidate,
  });

  const clearMutation = useMutation({
    mutationFn: () => suppliersService.clearProductImage(productId),
    onSuccess: invalidate,
  });

  return {
    uploadImage: useCallback((file) => uploadMutation.mutateAsync({ file }), [uploadMutation]),
    setImageFromUrl: useCallback(
      (imageUrl, sourceUrl) => setFromUrlMutation.mutateAsync({ imageUrl, sourceUrl }),
      [setFromUrlMutation]
    ),
    clearImage: useCallback(() => clearMutation.mutateAsync(), [clearMutation]),
    isUploading: uploadMutation.isPending,
    isClearing: clearMutation.isPending,
  };
}

// =============================================================================
// DOCUMENTS PRODUITS
// =============================================================================

export function useProductDocuments(productId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: supplierKeys.productDocuments(productId),
    queryFn: async () => {
      const { data, error } = await suppliersService.getProductDocuments(productId);
      if (error) throw error;
      return data;
    },
    enabled: !!productId,
    staleTime: 2 * 60 * 1000,
  });

  return { documents: data || [], isLoading, error, refetch };
}

export function useProductDocumentsByProductIds(productIds) {
  const { data, isLoading, error } = useQuery({
    queryKey: supplierKeys.productDocumentsByIds(productIds),
    queryFn: async () => {
      const { data, error } = await suppliersService.getDocumentsByProductIds(productIds);
      if (error) throw error;
      return data;
    },
    enabled: !!productIds?.length,
    staleTime: 2 * 60 * 1000,
  });

  return { documents: data || [], isLoading, error };
}

export function useProductDocumentMutations(orgId, productId) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: supplierKeys.productDocuments(productId) });
  };

  const uploadMutation = useMutation({
    mutationFn: ({ file, documentType, userId }) =>
      suppliersService.uploadProductDocument({ orgId, productId, file, documentType, userId }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ documentId, storagePath }) =>
      suppliersService.deleteProductDocument(documentId, storagePath),
    onSuccess: invalidate,
  });

  return {
    uploadDocument: uploadMutation.mutateAsync,
    deleteDocument: deleteMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
