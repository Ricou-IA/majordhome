import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

export const geogridService = {
  /**
   * Lance un scan via l'Edge Function geogrid-scan.
   * L'EF calcule la grille, appelle Google Places, et stocke en DB.
   */
  async launchScan({ orgId, keyword, businessName, placeId, centerLat, centerLng, radiusKm, gridSize, searchRadiusM }) {
    return withErrorHandling(async () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const { data: { session } } = await supabase.auth.getSession();

      const resp = await fetch(`${supabaseUrl}/functions/v1/geogrid-scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || anonKey}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({ orgId, keyword, businessName, placeId, centerLat, centerLng, radiusKm, gridSize, searchRadiusM }),
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
};

export default geogridService;
