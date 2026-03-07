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
      const [clientsResult, leadsResult] = await Promise.all([
        territoireService.getGeocodedClients(orgId),
        territoireService.getGeocodedLeads(orgId),
      ]);

      if (clientsResult.error) throw clientsResult.error;
      if (leadsResult.error) throw leadsResult.error;

      setClients(clientsResult.data || []);
      setLeads(leadsResult.data || []);
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
