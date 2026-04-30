import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

/**
 * gsc.service.js
 * ============================================================================
 * Service Google Search Console.
 * - connectGsc : appelle l'edge function gsc-oauth-init pour obtenir l'URL Google
 *   d'autorisation. Le frontend redirige ensuite l'utilisateur dessus.
 * - triggerSync : appelle l'edge function gsc-sync pour pousser les data GSC
 *   dans majordhome.gsc_keyword_metrics (UPSERT idempotent).
 * - getMetrics : query DB sur la vue publique majordhome_gsc_keyword_metrics.
 * - getStatus : lit core.organizations.settings pour savoir si GSC connecte.
 * - disconnect : retire les champs gsc_* du settings (oblige a refaire OAuth).
 * ============================================================================
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callEdgeFunction(name, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

export const gscService = {
  /**
   * Demande au backend de construire l'URL OAuth Google. Le frontend redirige
   * ensuite l'utilisateur via window.location.
   */
  async getAuthUrl(orgId, returnTo) {
    return withErrorHandling(async () => {
      const json = await callEdgeFunction('gsc-oauth-init', { orgId, returnTo });
      if (!json.url) throw new Error('URL OAuth manquante dans la reponse');
      return json.url;
    }, 'gsc.getAuthUrl');
  },

  /**
   * Lance une synchronisation GSC pour l'org. monthsBack borne en [1, 16].
   */
  async triggerSync(orgId, monthsBack = 1) {
    return withErrorHandling(async () => {
      const json = await callEdgeFunction('gsc-sync', { orgId, monthsBack });
      return json;
    }, 'gsc.triggerSync');
  },

  /**
   * Lit le statut GSC depuis core.organizations.settings.
   * Retourne { connected, siteUrl, lastSyncAt, lastSyncRows, connectedAt }.
   */
  async getStatus(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, settings')
        .eq('id', orgId)
        .maybeSingle();
      if (error) throw error;
      const s = data?.settings ?? {};
      return {
        connected: Boolean(s.gsc_refresh_token),
        siteUrl: s.gsc_site_url ?? null,
        connectedAt: s.gsc_connected_at ?? null,
        lastSyncAt: s.gsc_last_sync_at ?? null,
        lastSyncRows: s.gsc_last_sync_rows ?? 0,
        permissionLevel: s.gsc_permission_level ?? null,
      };
    }, 'gsc.getStatus');
  },

  /**
   * Lit les metrics GSC depuis la vue publique. Aggregation cote client si
   * dimension demandee est 'query' (sum sur dates et pages pour chaque query).
   *
   * @param {string} orgId
   * @param {{ dateFrom: string, dateTo: string, queries?: string[] }} opts
   * @returns {{ data, error }} liste de lignes brutes
   */
  async getMetrics(orgId, { dateFrom, dateTo, queries } = {}) {
    return withErrorHandling(async () => {
      let q = supabase
        .from('majordhome_gsc_keyword_metrics')
        .select('*')
        .eq('org_id', orgId);

      if (dateFrom) q = q.gte('date', dateFrom);
      if (dateTo) q = q.lte('date', dateTo);
      if (queries && queries.length > 0) q = q.in('query', queries);

      q = q.order('date', { ascending: false }).limit(50000);

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }, 'gsc.getMetrics');
  },

  /**
   * Retire les champs GSC du settings de l'org. Force un nouveau OAuth.
   */
  async disconnect(orgId) {
    return withErrorHandling(async () => {
      const { data: row, error: readErr } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .maybeSingle();
      if (readErr) throw readErr;

      const current = row?.settings ?? {};
      // Nettoie tous les champs gsc_*
      const cleaned = Object.fromEntries(
        Object.entries(current).filter(([k]) => !k.startsWith('gsc_')),
      );

      const { error: updErr } = await supabase
        .from('organizations')
        .update({ settings: cleaned })
        .eq('id', orgId);
      if (updErr) throw updErr;
      return true;
    }, 'gsc.disconnect');
  },
};

export default gscService;
