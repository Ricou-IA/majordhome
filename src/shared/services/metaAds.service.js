/**
 * metaAds.service.js - Majord'home Artisan
 * ============================================================================
 * Service lecture stats Meta Ads (V1 dashboard read-only).
 *
 * Sources :
 * - public.majordhome_meta_ads_daily_stats (snapshots quotidiens alimentés par cron N8N)
 * - public.majordhome_meta_ads_leads_attribution (leads Meta agrégés par jour × campagne)
 *
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

// ============================================================================
// CONSTANTES
// ============================================================================

export const CAMPAIGN_STATUS_CONFIG = {
  ACTIVE: { label: 'Active', color: 'bg-emerald-100 text-emerald-700 ring-emerald-200' },
  PAUSED: { label: 'Pause', color: 'bg-amber-100 text-amber-700 ring-amber-200' },
  DELETED: { label: 'Supprimée', color: 'bg-red-100 text-red-700 ring-red-200' },
  ARCHIVED: { label: 'Archivée', color: 'bg-gray-100 text-gray-700 ring-gray-200' },
  DEFAULT: { label: '—', color: 'bg-gray-100 text-gray-700 ring-gray-200' },
};

export function getStatusConfig(status) {
  if (!status) return CAMPAIGN_STATUS_CONFIG.DEFAULT;
  return CAMPAIGN_STATUS_CONFIG[status.toUpperCase()] || CAMPAIGN_STATUS_CONFIG.DEFAULT;
}

// ============================================================================
// SERVICE
// ============================================================================

export const metaAdsService = {
  // --------------------------------------------------------------------------
  // Stats quotidiennes brutes
  // --------------------------------------------------------------------------

  /**
   * Retourne les snapshots quotidiens d'une période, filtrés par niveau.
   *
   * @param {Object} params
   * @param {string} params.orgId - core.organizations.id
   * @param {string} params.startDate - YYYY-MM-DD inclus
   * @param {string} params.endDate - YYYY-MM-DD inclus
   * @param {string} [params.entityLevel='campaign'] - campaign | adset | ad
   * @param {string} [params.adAccountId] - filtre optionnel ad_account
   * @returns {{ data, error }}
   */
  async getDailyStats({ orgId, startDate, endDate, entityLevel = 'campaign', adAccountId = null }) {
    return withErrorHandling(async () => {
      let q = supabase
        .from('majordhome_meta_ads_daily_stats')
        .select('*')
        .eq('org_id', orgId)
        .eq('entity_level', entityLevel)
        .gte('date_start', startDate)
        .lte('date_start', endDate)
        .order('date_start', { ascending: true });

      if (adAccountId) {
        q = q.eq('ad_account_id', adAccountId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }, 'metaAds.getDailyStats');
  },

  // --------------------------------------------------------------------------
  // Attribution leads pipeline Supabase
  // --------------------------------------------------------------------------

  /**
   * Retourne les compteurs leads Meta par jour × campagne × adset (pipeline Supabase).
   * Permet de calculer CPL brut, contacté+, gagné côté frontend.
   */
  async getLeadsAttribution({ orgId, startDate, endDate, commercialId = null }) {
    return withErrorHandling(async () => {
      let q = supabase
        .from('majordhome_meta_ads_leads_attribution')
        .select('*')
        .eq('org_id', orgId)
        .gte('date_start', startDate)
        .lte('date_start', endDate);

      if (commercialId) {
        q = q.eq('commercial_id', commercialId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }, 'metaAds.getLeadsAttribution');
  },

  /**
   * Liste les commerciaux actifs (pour le sélecteur de filtre)
   */
  async getCommercials({ orgId }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_commercials')
        .select('id, full_name, is_active')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('full_name');
      if (error) throw error;
      return data || [];
    }, 'metaAds.getCommercials');
  },

  // --------------------------------------------------------------------------
  // Liste des comptes publicitaires présents dans les stats
  // --------------------------------------------------------------------------

  /**
   * Retourne la liste distincte des ad accounts présents dans la table stats.
   * Utilisé pour les tabs "par compte" du dashboard.
   */
  async getAdAccounts({ orgId }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_meta_ads_daily_stats')
        .select('ad_account_id, ad_account_name')
        .eq('org_id', orgId);

      if (error) throw error;

      const map = new Map();
      for (const row of data || []) {
        if (!map.has(row.ad_account_id)) {
          map.set(row.ad_account_id, {
            ad_account_id: row.ad_account_id,
            ad_account_name: row.ad_account_name || row.ad_account_id,
          });
        }
      }
      return [...map.values()].sort((a, b) =>
        (a.ad_account_name || '').localeCompare(b.ad_account_name || ''),
      );
    }, 'metaAds.getAdAccounts');
  },
};

// ============================================================================
// HELPERS D'AGRÉGATION (utilisés par les hooks / composants)
// ============================================================================

/**
 * Agrège les rows stats quotidiennes par entité (campaign ou adset).
 * Les métriques ratio (ctr, cpm, cpc, frequency) sont recalculées depuis les totaux.
 *
 * @param {Array} rows - Rows de majordhome_meta_ads_daily_stats
 * @returns {Array} - Une ligne par entity_id agrégée
 */
export function rollupByEntity(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const key = row.entity_id;
    if (!map.has(key)) {
      map.set(key, {
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        entity_level: row.entity_level,
        entity_status: row.entity_status,
        ad_account_id: row.ad_account_id,
        ad_account_name: row.ad_account_name,
        parent_campaign_id: row.parent_campaign_id,
        parent_campaign_name: row.parent_campaign_name,
        parent_adset_id: row.parent_adset_id,
        parent_adset_name: row.parent_adset_name,
        campaign_objective: row.campaign_objective,
        spend_cents: 0,
        impressions: 0,
        clicks: 0,
        leads_meta: 0,
        reach_max: 0, // reach non-additif : on prend le max comme approximation
      });
    }
    const agg = map.get(key);
    agg.spend_cents += row.spend_cents || 0;
    agg.impressions += row.impressions || 0;
    agg.clicks += row.clicks || 0;
    agg.leads_meta += row.leads_meta || 0;
    agg.reach_max = Math.max(agg.reach_max, row.reach || 0);
    // Dernier statut connu (le plus récent écrase)
    if (row.entity_status) agg.entity_status = row.entity_status;
  }

  // Calcule ratios dérivés
  return [...map.values()].map((agg) => ({
    ...agg,
    ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) : 0,
    cpm_cents: agg.impressions > 0 ? Math.round((agg.spend_cents / agg.impressions) * 1000) : 0,
    cpc_cents: agg.clicks > 0 ? Math.round(agg.spend_cents / agg.clicks) : 0,
    cpl_meta_cents: agg.leads_meta > 0 ? Math.round(agg.spend_cents / agg.leads_meta) : null,
  }));
}

/**
 * Agrège l'attribution leads par campagne (ignore l'adset).
 *
 * @param {Array} rows - Rows de majordhome_meta_ads_leads_attribution
 * @returns {Map<campaign_id, { leads_total, leads_contacted, leads_won, leads_lost }>}
 */
const emptyAttribution = () => ({
  leads_total: 0,
  leads_contacted: 0,
  leads_planified: 0,
  leads_quoted: 0,
  leads_won: 0,
  leads_lost: 0,
});

function accumulate(agg, row) {
  agg.leads_total += row.leads_total || 0;
  agg.leads_contacted += row.leads_contacted || 0;
  agg.leads_planified += row.leads_planified || 0;
  agg.leads_quoted += row.leads_quoted || 0;
  agg.leads_won += row.leads_won || 0;
  agg.leads_lost += row.leads_lost || 0;
}

export function attributionByCampaign(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = row.campaign_id;
    if (!map.has(key)) map.set(key, emptyAttribution());
    accumulate(map.get(key), row);
  }
  return map;
}

/**
 * Agrège l'attribution leads par adset.
 */
export function attributionByAdset(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row.adset_id) continue;
    const key = row.adset_id;
    if (!map.has(key)) map.set(key, emptyAttribution());
    accumulate(map.get(key), row);
  }
  return map;
}

/**
 * Construit une série quotidienne (spend + leads Meta + leads pipeline) sur la période.
 * Remplit les jours manquants avec 0 pour un graphe continu.
 *
 * @param {Array} statsRows - Stats rows (niveau campagne uniquement)
 * @param {Array} attribRows - Attribution rows
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array<{date, spend, spend_cents, impressions, leads_meta, leads_total, leads_won}>}
 */
export function buildDailySeries(statsRows, attribRows, startDate, endDate) {
  const byDate = new Map();

  const addDay = (dateStr) => {
    if (!byDate.has(dateStr)) {
      byDate.set(dateStr, {
        date: dateStr,
        spend_cents: 0,
        impressions: 0,
        clicks: 0,
        leads_meta: 0,
        leads_total: 0,
        leads_planified: 0,
        leads_quoted: 0,
        leads_won: 0,
        _budgetSumCents: 0,
        _budgetCount: 0,
      });
    }
    return byDate.get(dateStr);
  };

  // Remplit la plage complète pour éviter les trous
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    addDay(d.toISOString().slice(0, 10));
  }

  for (const row of statsRows || []) {
    const bucket = addDay(row.date_start);
    bucket.spend_cents += row.spend_cents || 0;
    bucket.impressions += row.impressions || 0;
    bucket.clicks += row.clicks || 0;
    bucket.leads_meta += row.leads_meta || 0;
    if (row.daily_budget_cents != null) {
      bucket._budgetSumCents += row.daily_budget_cents;
      bucket._budgetCount += 1;
    }
  }

  for (const row of attribRows || []) {
    const bucket = addDay(row.date_start);
    bucket.leads_total += row.leads_total || 0;
    bucket.leads_planified += row.leads_planified || 0;
    bucket.leads_quoted += row.leads_quoted || 0;
    bucket.leads_won += row.leads_won || 0;
  }

  // Tri chronologique + expose spend en € et budget réel (somme des budgets par jour)
  const sorted = [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(({ _budgetSumCents, _budgetCount, ...d }) => ({
      ...d,
      spend: d.spend_cents / 100,
      daily_budget_real: _budgetCount > 0 ? _budgetSumCents / 100 : null,
    }));

  // Budget plafond estimé : max glissant sur 7 jours (fallback pour l'historique sans budget réel).
  const WINDOW = 7;
  for (let i = 0; i < sorted.length; i++) {
    let maxSpend = 0;
    for (let j = Math.max(0, i - WINDOW + 1); j <= i; j++) {
      if (sorted[j].spend_cents > maxSpend) maxSpend = sorted[j].spend_cents;
    }
    sorted[i].budget_estimated = maxSpend / 100;
  }

  // Budget affiché : propage le dernier budget réel connu vers l'avant, sinon estimation.
  let carryBudget = null;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].daily_budget_real != null) carryBudget = sorted[i].daily_budget_real;
    sorted[i].budget_display = carryBudget != null ? carryBudget : sorted[i].budget_estimated;
  }

  return sorted;
}

/**
 * Détecte automatiquement les événements de cycle de vie des campagnes
 * à partir des snapshots quotidiens.
 *
 * - launch : premier jour de dépense pour une campagne
 * - pause  : dépense > 0 suivi d'au moins N jours consécutifs à 0
 * - resume : reprise de dépense après une pause détectée
 *
 * @param {Array} statsRows - rows majordhome_meta_ads_daily_stats
 * @param {number} [pauseThresholdDays=2] - nb de jours min pour qualifier une pause
 * @returns {Array<{date, type, campaign_id, campaign_name, ad_account_name, gap_days?}>}
 */
export function detectCampaignEvents(statsRows, pauseThresholdDays = 2) {
  const byCampaign = new Map();
  for (const row of statsRows || []) {
    if (row.entity_level !== 'campaign') continue;
    const list = byCampaign.get(row.entity_id) || [];
    list.push(row);
    byCampaign.set(row.entity_id, list);
  }

  const events = [];

  for (const [campaignId, rows] of byCampaign) {
    rows.sort((a, b) => (a.date_start < b.date_start ? -1 : 1));

    const firstActive = rows.find((r) => (r.spend_cents || 0) > 0);
    if (firstActive) {
      events.push({
        date: firstActive.date_start,
        type: 'launch',
        campaign_id: campaignId,
        campaign_name: firstActive.entity_name,
        ad_account_name: firstActive.ad_account_name,
      });
    }

    let i = 0;
    while (i < rows.length) {
      if ((rows[i].spend_cents || 0) > 0) {
        let j = i + 1;
        while (j < rows.length && (rows[j].spend_cents || 0) === 0) j++;
        const gap = j - i - 1;
        if (gap >= pauseThresholdDays) {
          const pauseDate = rows[i + 1]?.date_start;
          if (pauseDate) {
            events.push({
              date: pauseDate,
              type: 'pause',
              campaign_id: campaignId,
              campaign_name: rows[i].entity_name,
              ad_account_name: rows[i].ad_account_name,
              gap_days: gap,
            });
          }
          if (j < rows.length && (rows[j].spend_cents || 0) > 0) {
            events.push({
              date: rows[j].date_start,
              type: 'resume',
              campaign_id: campaignId,
              campaign_name: rows[j].entity_name,
              ad_account_name: rows[j].ad_account_name,
            });
          }
        }
        i = j;
      } else {
        i++;
      }
    }
  }

  return events.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * KPIs globaux sur la période (toutes campagnes / comptes confondus).
 */
export function computeGlobalKpis(statsRows, attribRows) {
  const totals = {
    spend_cents: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leads_meta: 0,
    leads_total: 0,
    leads_contacted: 0,
    leads_planified: 0,
    leads_quoted: 0,
    leads_won: 0,
  };

  for (const row of statsRows || []) {
    totals.spend_cents += row.spend_cents || 0;
    totals.impressions += row.impressions || 0;
    totals.reach = Math.max(totals.reach, row.reach || 0);
    totals.clicks += row.clicks || 0;
    totals.leads_meta += row.leads_meta || 0;
  }

  for (const row of attribRows || []) {
    totals.leads_total += row.leads_total || 0;
    totals.leads_contacted += row.leads_contacted || 0;
    totals.leads_planified += row.leads_planified || 0;
    totals.leads_quoted += row.leads_quoted || 0;
    totals.leads_won += row.leads_won || 0;
  }

  const cpl = (count) => (count > 0 ? Math.round(totals.spend_cents / count) : null);

  return {
    ...totals,
    spend_eur: totals.spend_cents / 100,
    ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
    cpl_meta_cents: cpl(totals.leads_meta),
    cpl_total_cents: cpl(totals.leads_total),
    cpl_contacted_cents: cpl(totals.leads_contacted),
    cpl_planified_cents: cpl(totals.leads_planified),
    cpl_quoted_cents: cpl(totals.leads_quoted),
    cpl_won_cents: cpl(totals.leads_won),
    conversion_rate_won: totals.leads_total > 0 ? totals.leads_won / totals.leads_total : 0,
  };
}
