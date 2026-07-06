// src/shared/hooks/useGoogleSolar.js
import { useQuery } from '@tanstack/react-query';
import { googleSolarService } from '@services/googleSolar.service';
import { googleSolarKeys } from './cacheKeys';

export { googleSolarKeys } from './cacheKeys';

// Paliers gratuits Google (spec §5.1/§5.2).
const BI_LIMIT = 10000;
const DL_LIMIT = 1000;

/** Consommation Google Solar du mois UTC en cours (informative). */
export function useGoogleSolarQuota(orgId) {
  return useQuery({
    queryKey: googleSolarKeys.quota(orgId),
    queryFn: async () => {
      const { data, error } = await googleSolarService.getMonthlyUsage(orgId);
      if (error) throw error;
      const bi = data?.buildingInsightsUsed || 0;
      const dl = data?.dataLayersUsed || 0;
      return {
        buildingInsightsUsed: bi,
        dataLayersUsed: dl,
        buildingInsightsLimit: BI_LIMIT,
        dataLayersLimit: DL_LIMIT,
        biPercentUsed: Math.round((bi / BI_LIMIT) * 100),
        dlPercentUsed: Math.round((dl / DL_LIMIT) * 100),
        monthStart: data?.monthStart,
      };
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}
