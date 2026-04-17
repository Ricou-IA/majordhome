/**
 * useMetaAds.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour le dashboard Meta Ads (V1 read-only).
 * ============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { metaAdsService } from '@services/metaAds.service';
import { metaAdsKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { metaAdsKeys } from '@hooks/cacheKeys';

// ============================================================================
// useMetaAdsStats — snapshots quotidiens pour une période
// ============================================================================

/**
 * @param {Object} params
 * @param {string} params.orgId
 * @param {string} params.startDate - YYYY-MM-DD
 * @param {string} params.endDate - YYYY-MM-DD
 * @param {string} [params.entityLevel='campaign']
 * @param {string} [params.adAccountId]
 */
export function useMetaAdsStats({ orgId, startDate, endDate, entityLevel = 'campaign', adAccountId = null }) {
  return useQuery({
    queryKey: metaAdsKeys.stats(orgId, `${startDate}_${endDate}_${adAccountId || 'all'}`, entityLevel),
    queryFn: async () => {
      const { data, error } = await metaAdsService.getDailyStats({
        orgId, startDate, endDate, entityLevel, adAccountId,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!startDate && !!endDate,
    staleTime: 60_000,
  });
}

// ============================================================================
// useMetaAdsLeadsAttribution — leads pipeline Supabase agrégés
// ============================================================================

export function useMetaAdsLeadsAttribution({ orgId, startDate, endDate, commercialId = null }) {
  return useQuery({
    queryKey: metaAdsKeys.attribution(orgId, `${startDate}_${endDate}`, commercialId),
    queryFn: async () => {
      const { data, error } = await metaAdsService.getLeadsAttribution({
        orgId, startDate, endDate, commercialId,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!startDate && !!endDate,
    staleTime: 60_000,
  });
}

// ============================================================================
// useMetaAdsAccounts — liste des comptes présents dans les stats
// ============================================================================

export function useMetaAdsAccounts(orgId) {
  return useQuery({
    queryKey: metaAdsKeys.accounts(orgId),
    queryFn: async () => {
      const { data, error } = await metaAdsService.getAdAccounts({ orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
}

// ============================================================================
// useMetaAdsCommercials — liste des commerciaux actifs (sélecteur filtre)
// ============================================================================

export function useMetaAdsCommercials(orgId) {
  return useQuery({
    queryKey: metaAdsKeys.commercials(orgId),
    queryFn: async () => {
      const { data, error } = await metaAdsService.getCommercials({ orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 10 * 60_000,
  });
}
