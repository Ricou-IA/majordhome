// src/shared/services/googleSolar.service.js
// Lecture du quota Google Solar du mois calendaire en cours (bornes UTC) depuis la vue cache.
// Compte les fetchs Google réels (cache misses) par SKU : Building Insights vs Data Layers.
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const CACHE_VIEW = 'majordhome_google_solar_cache';

export const googleSolarService = {
  async getMonthlyUsage(orgId) {
    return withErrorHandling(async () => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
      const [bi, dl] = await Promise.all([
        supabase.from(CACHE_VIEW).select('id', { count: 'exact', head: true })
          .eq('org_id', orgId).gte('fetched_at', monthStart),
        supabase.from(CACHE_VIEW).select('id', { count: 'exact', head: true })
          .eq('org_id', orgId).gte('flux_fetched_at', monthStart),
      ]);
      if (bi.error) throw bi.error;
      if (dl.error) throw dl.error;
      return {
        buildingInsightsUsed: bi.count ?? 0,
        dataLayersUsed: dl.count ?? 0,
        monthStart,
      };
    }, 'googleSolar.getMonthlyUsage');
  },
};
