import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

export const geogridService = {
  /**
   * Lance un scan via l'Edge Function geogrid-scan.
   * Mode 'grid' : centre + radius + gridSize → grille N×N régulière.
   * Mode 'cities' : liste de points custom (commune par commune).
   */
  async launchScan({ orgId, keyword, businessName, placeId, centerLat, centerLng, radiusKm, gridSize, searchRadiusM, mode = 'grid', points }) {
    return withErrorHandling(async () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const { data: { session } } = await supabase.auth.getSession();

      const payload = { orgId, keyword, businessName, placeId, centerLat, centerLng, searchRadiusM, mode };
      if (mode === 'cities') {
        payload.points = points;
      } else {
        payload.radiusKm = radiusKm;
        payload.gridSize = gridSize;
      }

      const resp = await fetch(`${supabaseUrl}/functions/v1/geogrid-scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || anonKey}`,
          'apikey': anonKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      return data;
    }, 'geogrid.launchScan');
  },

  /** Récupère la liste des scans pour une org. */
  async getScans(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_geogrid_scans')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    }, 'geogrid.getScans');
  },

  /** Récupère les résultats d'un scan spécifique. */
  async getScanResults(scanId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_geogrid_results')
        .select('*')
        .eq('scan_id', scanId)
        .order('row_idx')
        .order('col_idx');
      if (error) throw error;
      return data;
    }, 'geogrid.getScanResults');
  },

  /** Supprime un scan et ses résultats (cascade). */
  async deleteScan(scanId) {
    return withErrorHandling(async () => {
      const { error } = await supabase
        .from('majordhome_geogrid_scans_write')
        .delete()
        .eq('id', scanId);
      if (error) throw error;
      return true;
    }, 'geogrid.deleteScan');
  },

  /**
   * Consommation Google Places API du mois calendaire en cours (UTC).
   * Google reset le free tier au 1er du mois à 00:00 UTC.
   * Retour : { requestsUsed, scansCount, monthStart }
   */
  async getMonthlyUsage(orgId) {
    return withErrorHandling(async () => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

      const { data, error } = await supabase
        .from('majordhome_geogrid_scans')
        .select('total_points')
        .eq('org_id', orgId)
        .gte('created_at', monthStart.toISOString());

      if (error) throw error;

      const requestsUsed = (data || []).reduce((sum, row) => sum + (row.total_points || 0), 0);
      return {
        requestsUsed,
        scansCount: data?.length || 0,
        monthStart: monthStart.toISOString(),
      };
    }, 'geogrid.getMonthlyUsage');
  },
};

export default geogridService;
