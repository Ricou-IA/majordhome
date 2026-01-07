/**
 * useClients.js - Majord'home Artisan
 * ============================================================================
 * Hook React pour la gestion des clients.
 * Gère l'état, la pagination, les filtres et le cache.
 * 
 * @example
 * const { 
 *   clients, 
 *   loading, 
 *   error,
 *   filters,
 *   setFilters,
 *   loadMore,
 *   refresh 
 * } = useClients({ orgId: 'xxx' });
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { clientsService } from '@/shared/services/clients.service';

// ============================================================================
// CONSTANTES
// ============================================================================

const DEFAULT_LIMIT = 25;

const DEFAULT_FILTERS = {
  search: '',
  status: null,
  postalCode: null,
  hasContract: null,
  orderBy: 'name',
  ascending: true,
};

// ============================================================================
// HOOK PRINCIPAL - useClients
// ============================================================================

/**
 * Hook pour la liste des clients avec pagination et filtres
 * 
 * @param {Object} options - Options du hook
 * @param {string} options.orgId - ID de l'organisation (requis)
 * @param {number} [options.limit=25] - Nombre d'éléments par page
 * @param {boolean} [options.autoLoad=true] - Charger automatiquement au montage
 * @returns {Object} État et méthodes
 * 
 * @example
 * const {
 *   clients,           // Liste des clients
 *   loading,           // Chargement en cours
 *   loadingMore,       // Chargement pagination
 *   error,             // Erreur éventuelle
 *   totalCount,        // Nombre total de clients
 *   hasMore,           // Plus de résultats disponibles
 *   filters,           // Filtres actuels
 *   setFilters,        // Modifier les filtres
 *   setSearch,         // Raccourci pour la recherche
 *   loadMore,          // Charger plus de résultats
 *   refresh,           // Rafraîchir la liste
 *   reset,             // Réinitialiser filtres et liste
 * } = useClients({ orgId: 'xxx' });
 */
export function useClients({ orgId, limit = DEFAULT_LIMIT, autoLoad = true } = {}) {
  // État principal
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);

  // Filtres
  const [filters, setFiltersState] = useState(DEFAULT_FILTERS);

  // Calculer si plus de résultats disponibles
  const hasMore = useMemo(() => {
    return clients.length < totalCount;
  }, [clients.length, totalCount]);

  // ==========================================================================
  // CHARGEMENT DES DONNÉES
  // ==========================================================================

  /**
   * Charge les clients (première page ou avec nouveaux filtres)
   */
  const fetchClients = useCallback(async (resetOffset = true) => {
    if (!orgId) {
      setError(new Error('orgId est requis'));
      return;
    }

    const currentOffset = resetOffset ? 0 : offset;
    
    if (resetOffset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    
    setError(null);

    try {
      const { data, count, error: fetchError } = await clientsService.getClients({
        orgId,
        search: filters.search,
        status: filters.status,
        postalCode: filters.postalCode,
        hasContract: filters.hasContract,
        orderBy: filters.orderBy,
        ascending: filters.ascending,
        limit,
        offset: currentOffset,
      });

      if (fetchError) throw fetchError;

      if (resetOffset) {
        setClients(data || []);
        setOffset(limit);
      } else {
        setClients(prev => [...prev, ...(data || [])]);
        setOffset(prev => prev + limit);
      }

      setTotalCount(count || 0);
    } catch (err) {
      console.error('useClients.fetchClients error:', err);
      setError(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [orgId, filters, limit, offset]);

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  /**
   * Modifie les filtres (déclenche un rechargement)
   */
  const setFilters = useCallback((newFilters) => {
    setFiltersState(prev => {
      // Si c'est une fonction, l'appeler avec l'état précédent
      const updated = typeof newFilters === 'function' 
        ? newFilters(prev) 
        : { ...prev, ...newFilters };
      return updated;
    });
    setOffset(0);
  }, []);

  /**
   * Raccourci pour modifier uniquement la recherche
   */
  const setSearch = useCallback((search) => {
    setFilters({ search });
  }, [setFilters]);

  /**
   * Charge plus de résultats (pagination)
   */
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      fetchClients(false);
    }
  }, [fetchClients, loadingMore, hasMore]);

  /**
   * Rafraîchit la liste (recharge depuis le début)
   */
  const refresh = useCallback(() => {
    fetchClients(true);
  }, [fetchClients]);

  /**
   * Réinitialise les filtres et la liste
   */
  const reset = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
    setOffset(0);
    setClients([]);
    setTotalCount(0);
  }, []);

  // ==========================================================================
  // EFFETS
  // ==========================================================================

  // Charger au montage et quand les filtres changent
  useEffect(() => {
    if (autoLoad && orgId) {
      fetchClients(true);
    }
  }, [orgId, filters, autoLoad]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==========================================================================
  // RETOUR
  // ==========================================================================

  return {
    // Données
    clients,
    loading,
    loadingMore,
    error,
    totalCount,
    hasMore,
    
    // Filtres
    filters,
    setFilters,
    setSearch,
    
    // Actions
    loadMore,
    refresh,
    reset,
  };
}

// ============================================================================
// HOOK - useClient (détail d'un client)
// ============================================================================

/**
 * Hook pour charger les détails d'un client
 * 
 * @param {string} clientId - ID du client
 * @param {Object} options - Options
 * @param {boolean} [options.autoLoad=true] - Charger automatiquement
 * @returns {Object} État et méthodes
 * 
 * @example
 * const { client, loading, error, refresh } = useClient('xxx');
 */
export function useClient(clientId, { autoLoad = true } = {}) {
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Charge les détails du client
   */
  const fetchClient = useCallback(async () => {
    if (!clientId) {
      setClient(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await clientsService.getClientById(clientId);

      if (fetchError) throw fetchError;

      setClient(data);
    } catch (err) {
      console.error('useClient.fetchClient error:', err);
      setError(err);
      setClient(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  /**
   * Met à jour le client
   */
  const updateClient = useCallback(async (updates) => {
    if (!clientId) return { data: null, error: new Error('clientId requis') };

    setLoading(true);
    setError(null);

    try {
      const { data, error: updateError } = await clientsService.updateClient(clientId, updates);

      if (updateError) throw updateError;

      setClient(data);
      return { data, error: null };
    } catch (err) {
      console.error('useClient.updateClient error:', err);
      setError(err);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  /**
   * Rafraîchit les données du client
   */
  const refresh = useCallback(() => {
    fetchClient();
  }, [fetchClient]);

  // Charger au montage
  useEffect(() => {
    if (autoLoad && clientId) {
      fetchClient();
    }
  }, [clientId, autoLoad, fetchClient]);

  return {
    client,
    loading,
    error,
    updateClient,
    refresh,
  };
}

// ============================================================================
// HOOK - useClientEquipments
// ============================================================================

/**
 * Hook pour gérer les équipements d'un client
 * 
 * @param {string} clientId - ID du client
 * @returns {Object} État et méthodes
 * 
 * @example
 * const { equipments, loading, addEquipment, updateEquipment, deleteEquipment } = useClientEquipments('xxx');
 */
export function useClientEquipments(clientId) {
  const [equipments, setEquipments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Charge les équipements
   */
  const fetchEquipments = useCallback(async () => {
    if (!clientId) {
      setEquipments([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await clientsService.getClientEquipments(clientId);

      if (fetchError) throw fetchError;

      setEquipments(data || []);
    } catch (err) {
      console.error('useClientEquipments.fetchEquipments error:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  /**
   * Ajoute un équipement
   */
  const addEquipment = useCallback(async (equipmentData) => {
    if (!clientId) return { data: null, error: new Error('clientId requis') };

    try {
      const { data, error: addError } = await clientsService.addEquipment(clientId, equipmentData);

      if (addError) throw addError;

      // Ajouter au state local
      setEquipments(prev => [data, ...prev]);

      return { data, error: null };
    } catch (err) {
      console.error('useClientEquipments.addEquipment error:', err);
      return { data: null, error: err };
    }
  }, [clientId]);

  /**
   * Met à jour un équipement
   */
  const updateEquipment = useCallback(async (equipmentId, updates) => {
    try {
      const { data, error: updateError } = await clientsService.updateEquipment(equipmentId, updates);

      if (updateError) throw updateError;

      // Mettre à jour le state local
      setEquipments(prev => prev.map(eq => 
        eq.id === equipmentId ? data : eq
      ));

      return { data, error: null };
    } catch (err) {
      console.error('useClientEquipments.updateEquipment error:', err);
      return { data: null, error: err };
    }
  }, []);

  /**
   * Supprime un équipement
   */
  const deleteEquipment = useCallback(async (equipmentId) => {
    try {
      const { success, error: deleteError } = await clientsService.deleteEquipment(equipmentId);

      if (deleteError) throw deleteError;

      // Retirer du state local
      setEquipments(prev => prev.filter(eq => eq.id !== equipmentId));

      return { success, error: null };
    } catch (err) {
      console.error('useClientEquipments.deleteEquipment error:', err);
      return { success: false, error: err };
    }
  }, []);

  /**
   * Rafraîchit la liste
   */
  const refresh = useCallback(() => {
    fetchEquipments();
  }, [fetchEquipments]);

  // Charger au montage
  useEffect(() => {
    if (clientId) {
      fetchEquipments();
    }
  }, [clientId, fetchEquipments]);

  return {
    equipments,
    loading,
    error,
    addEquipment,
    updateEquipment,
    deleteEquipment,
    refresh,
  };
}

// ============================================================================
// HOOK - useClientStats
// ============================================================================

/**
 * Hook pour les statistiques clients
 * 
 * @param {string} orgId - ID de l'organisation
 * @returns {Object} État et méthodes
 * 
 * @example
 * const { stats, loading, refresh } = useClientStats('xxx');
 */
export function useClientStats(orgId) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Charge les statistiques
   */
  const fetchStats = useCallback(async () => {
    if (!orgId) {
      setStats(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await clientsService.getClientStats(orgId);

      if (fetchError) throw fetchError;

      setStats(data);
    } catch (err) {
      console.error('useClientStats.fetchStats error:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  /**
   * Rafraîchit les stats
   */
  const refresh = useCallback(() => {
    fetchStats();
  }, [fetchStats]);

  // Charger au montage
  useEffect(() => {
    if (orgId) {
      fetchStats();
    }
  }, [orgId, fetchStats]);

  return {
    stats,
    loading,
    error,
    refresh,
  };
}

// ============================================================================
// HOOK - useClientSearch (autocomplete)
// ============================================================================

/**
 * Hook pour la recherche rapide de clients (autocomplete)
 * 
 * @param {string} orgId - ID de l'organisation
 * @param {Object} options - Options
 * @param {number} [options.debounceMs=300] - Délai debounce
 * @param {number} [options.minChars=2] - Caractères minimum
 * @returns {Object} État et méthodes
 * 
 * @example
 * const { results, searching, search } = useClientSearch('xxx');
 * search('Dup'); // Déclenche la recherche
 */
export function useClientSearch(orgId, { debounceMs = 300, minChars = 2 } = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  /**
   * Effectue la recherche
   */
  const performSearch = useCallback(async (searchQuery) => {
    if (!orgId || !searchQuery || searchQuery.length < minChars) {
      setResults([]);
      return;
    }

    setSearching(true);

    try {
      const { data, error } = await clientsService.searchClients(orgId, searchQuery);

      if (error) throw error;

      setResults(data || []);
    } catch (err) {
      console.error('useClientSearch.performSearch error:', err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [orgId, minChars]);

  // Debounce de la recherche
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, debounceMs, performSearch]);

  /**
   * Déclenche une recherche
   */
  const search = useCallback((newQuery) => {
    setQuery(newQuery);
  }, []);

  /**
   * Efface les résultats
   */
  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
  }, []);

  return {
    query,
    results,
    searching,
    search,
    clear,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useClients;
