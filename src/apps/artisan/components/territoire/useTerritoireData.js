/**
 * useTerritoireData.js
 * Hooks données territoire — même pattern que useClients/useClientStats
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { territoireService } from '@services/territoire.service';

// ============================================================================
// Hook principal — points CRM géocodés
// ============================================================================

export function useTerritoireData() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const [clients, setClients] = useState([]);
  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!orgId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Clients = critique, Leads = optionnel (erreur non-bloquante)
      const [clientsResult, leadsResult] = await Promise.allSettled([
        territoireService.getGeocodedClients(orgId),
        territoireService.getGeocodedLeads(orgId),
      ]);

      // Clients
      const cResult = clientsResult.status === 'fulfilled' ? clientsResult.value : null;
      if (cResult?.error) throw cResult.error;
      setClients(cResult?.data || []);

      // Leads (non-bloquant)
      const lResult = leadsResult.status === 'fulfilled' ? leadsResult.value : null;
      if (lResult?.error) {
        console.warn('[useTerritoireData] Leads non chargés:', lResult.error);
      }
      setLeads(lResult?.data || []);
    } catch (err) {
      console.error('[useTerritoireData] Error:', err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) fetchData();
  }, [orgId, fetchData]);

  return {
    points: [...clients, ...leads],
    clients,
    leads,
    isLoading,
    error,
    refetch: fetchData,
  };
}

// ============================================================================
// Hook stats — même pattern que useClientStats
// ============================================================================

export function useTerritoireStats() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    if (!orgId) {
      setStats(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await territoireService.getTerritoireStats(orgId);
      if (fetchError) throw fetchError;
      setStats(data);
    } catch (err) {
      console.error('[useTerritoireStats] Error:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) fetchStats();
  }, [orgId, fetchStats]);

  return { data: stats, loading, error, refresh: fetchStats };
}

export default useTerritoireData;
