/**
 * MetaAds.jsx - Dashboard Meta Ads (V1 read-only)
 * ============================================================================
 * Accessible org_admin uniquement (via RouteGuard resource="meta_ads").
 *
 * Source : table majordhome.meta_ads_daily_stats (snapshots quotidiens
 * alimentés par le workflow N8N "Mayer - Meta Ads Insights (Daily)").
 *
 * Vue : campagnes + drill-down adsets, KPIs globaux, graphique quotidien,
 * filtres par période et par compte.
 *
 * @version 1.0.0 - V1 dashboard (2026-04-17)
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { Megaphone, RefreshCw, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import {
  useMetaAdsStats,
  useMetaAdsLeadsAttribution,
  useMetaAdsAccounts,
  useMetaAdsCommercials,
} from '@hooks/useMetaAds';
import { computeGlobalKpis, buildDailySeries, detectCampaignEvents } from '@services/metaAds.service';
import { MetaAdsKpiCards } from '@apps/artisan/components/meta-ads/MetaAdsKpiCards';
import { MetaAdsPeriodSelector, computeRange } from '@apps/artisan/components/meta-ads/MetaAdsPeriodSelector';
import { MetaAdsAccountTabs } from '@apps/artisan/components/meta-ads/MetaAdsAccountTabs';
import { MetaAdsCampaignTable } from '@apps/artisan/components/meta-ads/MetaAdsCampaignTable';
import { MetaAdsDailyChart } from '@apps/artisan/components/meta-ads/MetaAdsDailyChart';
import { MetaAdsFunnel } from '@apps/artisan/components/meta-ads/MetaAdsFunnel';
import { MetaAdsCommercialFunnels } from '@apps/artisan/components/meta-ads/MetaAdsCommercialFunnels';

export default function MetaAds() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  // --- Filtres période ---
  const [presetKey, setPresetKey] = useState('30d');
  const [customRange, setCustomRange] = useState(() => computeRange('30d'));
  const range = useMemo(() => {
    if (presetKey === 'custom') return customRange;
    return computeRange(presetKey);
  }, [presetKey, customRange]);

  // --- Filtre compte ---
  const [activeAccount, setActiveAccount] = useState(null);

  const queryParams = {
    orgId,
    startDate: range.startDate,
    endDate: range.endDate,
    adAccountId: activeAccount,
  };

  const { data: campaignStats = [], isLoading: loadingCampaign, error: errorCampaign, refetch: refetchCampaign } =
    useMetaAdsStats({ ...queryParams, entityLevel: 'campaign' });
  const { data: adsetStats = [], isLoading: loadingAdset } =
    useMetaAdsStats({ ...queryParams, entityLevel: 'adset' });
  const { data: attribRows = [], isLoading: loadingAttrib, refetch: refetchAttrib } =
    useMetaAdsLeadsAttribution({
      orgId,
      startDate: range.startDate,
      endDate: range.endDate,
    });
  const { data: accounts = [], isLoading: loadingAccounts } = useMetaAdsAccounts(orgId);
  const { data: commercials = [] } = useMetaAdsCommercials(orgId);

  const isLoading = loadingCampaign || loadingAdset || loadingAttrib || loadingAccounts;
  const hasNoData = !isLoading && campaignStats.length === 0;

  // --- Filtrage attribution par compte ---
  // La vue d'attribution ne porte pas ad_account_id, on filtre via les campaign_id du compte actif.
  const filteredAttrib = useMemo(() => {
    if (!activeAccount) return attribRows;
    const activeCampaignIds = new Set(
      campaignStats.filter((s) => s.ad_account_id === activeAccount).map((s) => s.entity_id),
    );
    return attribRows.filter((r) => activeCampaignIds.has(r.campaign_id));
  }, [attribRows, activeAccount, campaignStats]);

  // --- Filtrage par compte actif ---
  const filteredCampaignStats = useMemo(
    () => campaignStats.filter((s) => !activeAccount || s.ad_account_id === activeAccount),
    [campaignStats, activeAccount],
  );

  const filteredAdsetStats = useMemo(
    () => adsetStats.filter((s) => !activeAccount || s.ad_account_id === activeAccount),
    [adsetStats, activeAccount],
  );

  // --- Agrégations mémo ---
  const kpis = useMemo(
    () => computeGlobalKpis(filteredCampaignStats, filteredAttrib),
    [filteredCampaignStats, filteredAttrib],
  );

  const dailySeries = useMemo(
    () => buildDailySeries(filteredCampaignStats, filteredAttrib, range.startDate, range.endDate),
    [filteredCampaignStats, filteredAttrib, range.startDate, range.endDate],
  );

  const campaignEvents = useMemo(
    () => detectCampaignEvents(filteredCampaignStats),
    [filteredCampaignStats],
  );

  const handleRefresh = () => {
    refetchCampaign();
    refetchAttrib();
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-secondary-900 flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-primary-600" />
          Meta Ads
        </h1>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-md border border-secondary-200 bg-white px-3 py-1.5 text-sm font-medium text-secondary-700 shadow-sm hover:bg-secondary-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Rafraîchir
        </button>
      </div>

      {/* Sélecteur période */}
      <MetaAdsPeriodSelector
        presetKey={presetKey}
        onPresetChange={setPresetKey}
        startDate={range.startDate}
        endDate={range.endDate}
        onCustomChange={setCustomRange}
      />

      {/* Onglets comptes */}
      {accounts.length > 0 && (
        <MetaAdsAccountTabs
          accounts={accounts}
          activeAccount={activeAccount}
          onChange={setActiveAccount}
        />
      )}

      {/* Erreur */}
      {errorCampaign && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
          <div>
            <div className="font-medium text-red-900">Erreur de chargement</div>
            <div className="text-sm text-red-700 mt-0.5">{errorCampaign.message}</div>
          </div>
        </div>
      )}

      {/* Loading initial */}
      {isLoading && campaignStats.length === 0 && (
        <div className="flex items-center justify-center py-20 text-secondary-500">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      )}

      {/* État vide (cron pas encore run) */}
      {hasNoData && !errorCampaign && (
        <EmptyState range={range} />
      )}

      {/* Dashboard */}
      {!hasNoData && !errorCampaign && (
        <>
          <MetaAdsKpiCards kpis={kpis} />
          <MetaAdsFunnel kpis={kpis} />
          <MetaAdsCommercialFunnels attribRows={filteredAttrib} commercials={commercials} />
          <MetaAdsDailyChart dailySeries={dailySeries} events={campaignEvents} />
          <MetaAdsCampaignTable
            campaignStatsRows={filteredCampaignStats}
            adsetStatsRows={filteredAdsetStats}
            attribRows={filteredAttrib}
          />
        </>
      )}
    </div>
  );
}

// ============================================================================
// État vide — aucune donnée dans la table stats (cron pas encore exécuté)
// ============================================================================

function EmptyState({ range }) {
  return (
    <div className="rounded-lg border border-dashed border-secondary-300 bg-white p-10 text-center">
      <Megaphone className="w-10 h-10 text-secondary-400 mx-auto" />
      <h2 className="mt-4 text-lg font-semibold text-secondary-900">
        Aucune donnée Meta Ads pour la période
      </h2>
      <p className="mt-2 text-sm text-secondary-600 max-w-md mx-auto">
        La table <code className="bg-secondary-100 px-1 rounded">meta_ads_daily_stats</code> est vide pour{' '}
        <span className="font-medium">{range.startDate} → {range.endDate}</span>.
      </p>
      <p className="mt-3 text-sm text-secondary-600 max-w-md mx-auto">
        Vérifie que le workflow N8N <strong>« Mayer - Meta Ads Insights (Daily) »</strong> est activé
        et a fait au moins un run, ou lance un backfill manuel.
      </p>
      <a
        href="https://business.facebook.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
      >
        Consulter Business Manager <ExternalLink className="w-4 h-4" />
      </a>
    </div>
  );
}
