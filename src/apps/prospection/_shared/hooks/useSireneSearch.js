/**
 * useSireneSearch.js — Hook pour la recherche API Sirene avec debounce
 *
 * L'API filtre `departement` par ÉTABLISSEMENT (pas par siège social).
 * Quand q est vide + département sélectionné, les grosses boîtes nationales
 * (siège Paris) dominent les résultats car elles ont des agences partout.
 *
 * Solution : en mode "siège local", on fetch plusieurs pages API en parallèle
 * et on filtre côté client par siege.departement pour ne garder que les
 * entreprises réellement basées dans le département cible.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchSirene, mapResultToProspect } from '../lib/sireneApi';

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;

// Combien de pages API on scanne par page virtuelle pour le filtre siège
const SCAN_BATCH = 6; // 6 pages × 25 = 150 résultats scannés → ~15-30 résultats locaux

/**
 * Fetch parallèle de plusieurs pages API, filtre par SIÈGE (pas établissement).
 * L'API `departement` et `commune` filtrent par établissement → on re-filtre côté client
 * pour ne garder que les entreprises dont le SIÈGE est dans la zone cible.
 */
async function fetchWithSiegeFilter({ query, codeNaf, departement, communeCode, virtualPage, signal }) {
  const startApiPage = (virtualPage - 1) * SCAN_BATCH + 1;

  const promises = Array.from({ length: SCAN_BATCH }, (_, i) =>
    searchSirene({
      query,
      codeNaf,
      departement,
      commune: communeCode,
      page: startApiPage + i,
      perPage: 25,
      signal,
    }).catch(() => null)
  );

  const batches = (await Promise.all(promises)).filter(Boolean);
  if (batches.length === 0) {
    return { results: [], total_results: 0, total_pages: 0, page: virtualPage };
  }

  const apiTotalPages = batches[0].total_pages || 0;
  const allItems = batches.flatMap((b) => b.results);

  // Filtrer par siège : commune (plus précis) ou département
  const siegeFiltered = allItems.filter((r) => {
    if (communeCode) {
      return r.siege?.commune === communeCode;
    }
    return r.siege?.departement === departement;
  });

  return {
    results: siegeFiltered,
    total_results: siegeFiltered.length,
    total_pages: Math.ceil(apiTotalPages / SCAN_BATCH),
    page: virtualPage,
  };
}

/**
 * Hook de recherche dans l'API Recherche Entreprises.
 * Debounce 300ms, pagination intégrée.
 */
export function useSireneSearch({
  module,
  defaultNafCodes = [],
  defaultDepartements = [],
} = {}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [nafCodes, setNafCodesRaw] = useState(defaultNafCodes);
  const [departement, setDepartementRaw] = useState(
    defaultDepartements.length === 1 ? defaultDepartements[0] : ''
  );
  const [communeCode, setCommuneCodeRaw] = useState(''); // Code INSEE commune
  const abortRef = useRef(null);

  // Wrappers pour reset page à chaque changement de filtre
  const setNafCodes = useCallback((codes) => {
    setNafCodesRaw(codes);
    setPage(1);
  }, []);

  const setDepartement = useCallback((dep) => {
    setDepartementRaw(dep);
    setPage(1);
  }, []);

  const setCommuneCode = useCallback((code) => {
    setCommuneCodeRaw(code);
    setPage(1);
  }, []);

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Mode filtre siège : dès qu'un département OU une commune est sélectionné,
  // l'API filtre par établissement (pas siège) → on scanne + filtre côté client
  // pour ne garder que les entreprises dont le SIÈGE est dans la zone.
  const needsSiegeFilter = !!departement || !!communeCode;

  // Query Sirene API
  const {
    data: searchData,
    isLoading: isSearching,
    error,
  } = useQuery({
    queryKey: ['sirene-search', debouncedQuery, nafCodes, departement, communeCode, page, needsSiegeFilter],
    queryFn: async ({ signal }) => {
      if (needsSiegeFilter) {
        // Scan parallèle + filtre par siège (avec ou sans texte)
        return fetchWithSiegeFilter({
          query: debouncedQuery || undefined,
          codeNaf: nafCodes.length > 0 ? nafCodes : undefined,
          departement: departement || undefined,
          communeCode: communeCode || undefined,
          virtualPage: page,
          signal,
        });
      }

      // Mode standard : ni département ni commune
      return searchSirene({
        query: debouncedQuery,
        codeNaf: nafCodes.length > 0 ? nafCodes : undefined,
        page,
        perPage: PAGE_SIZE,
        signal,
      });
    },
    enabled: debouncedQuery.length >= 2 || nafCodes.length > 0,
    staleTime: 60_000,
    keepPreviousData: true,
  });

  // Mapper les résultats en shape prospect
  const results = useMemo(
    () =>
      (searchData?.results || []).map((r) => ({
        ...mapResultToProspect(r, module),
        _raw: r,
      })),
    [searchData?.results, module]
  );

  const totalResults = searchData?.total_results || 0;
  const totalPages = searchData?.total_pages || 0;

  const nextPage = useCallback(() => {
    setPage((p) => Math.min(p + 1, totalPages));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setPage((p) => Math.max(1, p - 1));
  }, []);

  const resetSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setPage(1);
  }, []);

  return {
    // Search state
    query,
    setQuery,
    results,
    totalResults,
    isSearching,
    error,

    // Pagination
    page,
    setPage,
    totalPages,
    nextPage,
    prevPage,

    // Filters
    nafCodes,
    setNafCodes,
    departement,
    setDepartement,
    communeCode,
    setCommuneCode,

    // Actions
    resetSearch,
  };
}
