/**
 * usePaginatedList.js — Hook générique de liste paginée
 * ============================================================================
 * Abstraction de la logique de pagination commune à useClients, useProspects,
 * useLeads, useContracts. Utilise React Query pour la première page et
 * gère le loadMore manuellement.
 * ============================================================================
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

const DEFAULT_LIMIT = 25;

/**
 * Hook générique pour listes paginées avec filtres
 *
 * @param {Object} options
 * @param {Function} options.queryKeyFn - (filters) => queryKey array
 * @param {Function} options.fetchFn - (filters, limit, offset) => Promise<{ data, count, error }>
 * @param {boolean} options.enabled - Active la query (ex: !!orgId)
 * @param {Object} [options.defaultFilters={}] - Filtres initiaux
 * @param {number} [options.limit=25] - Éléments par page
 * @param {number} [options.staleTime=30000] - Durée cache React Query
 *
 * @returns {Object} items, totalCount, isLoading, loadingMore, hasMore, filters, setFilters, setSearch, loadMore, refresh, reset
 */
export function usePaginatedList({
  queryKeyFn,
  fetchFn,
  enabled = true,
  defaultFilters = {},
  limit = DEFAULT_LIMIT,
  staleTime = 30_000,
} = {}) {
  const [filters, setFiltersState] = useState(defaultFilters);
  const [allItems, setAllItems] = useState([]);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Query première page
  const {
    data: queryData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeyFn(filters),
    queryFn: () => fetchFn(filters, limit, 0),
    enabled,
    staleTime,
    select: (result) => result,
  });

  // Sync première page
  useEffect(() => {
    if (queryData?.data) {
      setAllItems(queryData.data);
      setTotalCount(queryData.count || 0);
      setOffset(limit);
    }
  }, [queryData, limit]);

  const hasMore = useMemo(() => allItems.length < totalCount, [allItems.length, totalCount]);

  // Charger plus
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !enabled) return;
    setLoadingMore(true);
    try {
      const { data } = await fetchFn(filters, limit, offset);
      if (data) {
        setAllItems((prev) => [...prev, ...data]);
        setOffset((prev) => prev + limit);
      }
    } catch (err) {
      console.error('[usePaginatedList] loadMore:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [filters, limit, offset, loadingMore, hasMore, enabled, fetchFn]);

  // Modifier filtres (reset pagination)
  const setFilters = useCallback((newFilters) => {
    setFiltersState((prev) => {
      const updated = typeof newFilters === 'function' ? newFilters(prev) : { ...prev, ...newFilters };
      return updated;
    });
    setOffset(0);
    setAllItems([]);
  }, []);

  // Raccourci recherche
  const setSearch = useCallback(
    (search) => setFilters((prev) => ({ ...prev, search })),
    [setFilters]
  );

  // Reset complet
  const reset = useCallback(() => {
    setFiltersState(defaultFilters);
    setOffset(0);
    setAllItems([]);
    setTotalCount(0);
  }, [defaultFilters]);

  return {
    items: allItems,
    totalCount,
    isLoading,
    loadingMore,
    error: queryData?.error || error,
    hasMore,
    filters,
    setFilters,
    setSearch,
    loadMore,
    refresh: refetch,
    reset,
  };
}
