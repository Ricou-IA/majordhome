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

  // ============================================================
  // Listes de keywords (réutilisables pour les benchmarks)
  // ============================================================

  async getKeywordLists(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_geogrid_keyword_lists')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }, 'geogrid.getKeywordLists');
  },

  async createKeywordList(orgId, { name, description, keywords }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_geogrid_keyword_lists_write')
        .insert({ org_id: orgId, name, description, keywords })
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'geogrid.createKeywordList');
  },

  async updateKeywordList(listId, { name, description, keywords, is_active }) {
    return withErrorHandling(async () => {
      const payload = { updated_at: new Date().toISOString() };
      if (name !== undefined) payload.name = name;
      if (description !== undefined) payload.description = description;
      if (keywords !== undefined) payload.keywords = keywords;
      if (is_active !== undefined) payload.is_active = is_active;

      const { data, error } = await supabase
        .from('majordhome_geogrid_keyword_lists_write')
        .update(payload)
        .eq('id', listId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'geogrid.updateKeywordList');
  },

  async deleteKeywordList(listId) {
    return withErrorHandling(async () => {
      const { error } = await supabase
        .from('majordhome_geogrid_keyword_lists_write')
        .delete()
        .eq('id', listId);
      if (error) throw error;
      return true;
    }, 'geogrid.deleteKeywordList');
  },

  // ============================================================
  // Benchmarks (= run d'une liste = N scans liés)
  // ============================================================

  async getBenchmarks(orgId, { limit = 30 } = {}) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_geogrid_benchmarks')
        .select('*')
        .eq('org_id', orgId)
        .order('started_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    }, 'geogrid.getBenchmarks');
  },

  async createBenchmark(orgId, params) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_geogrid_benchmarks_write')
        .insert({
          org_id: orgId,
          list_id: params.list_id,
          scan_mode: params.scan_mode,
          business_name: params.business_name,
          place_id: params.place_id || null,
          center_lat: params.center_lat,
          center_lng: params.center_lng,
          radius_km: params.radius_km || null,
          grid_size: params.grid_size || null,
          search_radius_m: params.search_radius_m || 1000,
          city_min_population: params.city_min_population || null,
          total_keywords: params.total_keywords,
          status: 'running',
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'geogrid.createBenchmark');
  },

  async updateBenchmarkProgress(benchmarkId, { completed_keywords, status, error_message, completed_at }) {
    return withErrorHandling(async () => {
      const payload = {};
      if (completed_keywords !== undefined) payload.completed_keywords = completed_keywords;
      if (status !== undefined) payload.status = status;
      if (error_message !== undefined) payload.error_message = error_message;
      if (completed_at !== undefined) payload.completed_at = completed_at;

      const { data, error } = await supabase
        .from('majordhome_geogrid_benchmarks_write')
        .update(payload)
        .eq('id', benchmarkId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'geogrid.updateBenchmarkProgress');
  },

  async getBenchmarkScans(benchmarkId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_geogrid_scans')
        .select('*')
        .eq('benchmark_id', benchmarkId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    }, 'geogrid.getBenchmarkScans');
  },

  async deleteBenchmark(benchmarkId) {
    return withErrorHandling(async () => {
      const { error } = await supabase
        .from('majordhome_geogrid_benchmarks_write')
        .delete()
        .eq('id', benchmarkId);
      if (error) throw error;
      return true;
    }, 'geogrid.deleteBenchmark');
  },
};

export default geogridService;
