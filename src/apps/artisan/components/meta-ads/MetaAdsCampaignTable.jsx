import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatEuro } from '@lib/utils';
import { getStatusConfig, rollupByEntity, attributionByCampaign, attributionByAdset } from '@services/metaAds.service';

const fmtInt = (n) => (n == null ? '—' : new Intl.NumberFormat('fr-FR').format(n));
const fmtPct = (n) => (n == null ? '—' : `${(n * 100).toFixed(2)}%`);
const fmtCpl = (cents) => (cents == null ? '—' : formatEuro(cents / 100));

const EMPTY_LEADS = {
  leads_total: 0,
  leads_planified: 0,
  leads_quoted: 0,
  leads_won: 0,
};

function computeCpls(totals, leads) {
  const cpl = (count) => (count > 0 ? Math.round(totals.spend_cents / count) : null);
  return {
    cpl_meta: cpl(totals.leads_meta),
    cpl_planified: cpl(leads.leads_planified),
    cpl_quoted: cpl(leads.leads_quoted),
    cpl_won: cpl(leads.leads_won),
  };
}

function StatusBadge({ status }) {
  const cfg = getStatusConfig(status);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

/**
 * Une ligne du tableau (campagne OU adset). Partage la même structure,
 * variante visuelle via `isAdset` (padding, fond, font-size).
 */
function MetricsRow({ entity, leads, isAdset = false, leftCell }) {
  const cpls = computeCpls(entity, leads);
  const trClass = isAdset ? 'bg-secondary-50/40' : 'bg-white hover:bg-secondary-50 transition-colors';
  const padY = isAdset ? 'py-2' : 'py-3';
  const textClass = isAdset ? 'text-sm' : '';
  const wonColor = isAdset ? 'text-emerald-700' : 'text-emerald-700 font-medium';

  const cells = [
    { key: 'spend', value: formatEuro(entity.spend_cents / 100) },
    { key: 'imp', value: fmtInt(entity.impressions), extra: 'text-secondary-700' },
    { key: 'ctr', value: fmtPct(entity.ctr), extra: 'text-secondary-700' },
    { key: 'leadsMeta', value: fmtInt(entity.leads_meta) },
    { key: 'planified', value: fmtInt(leads.leads_planified) },
    { key: 'quoted', value: fmtInt(leads.leads_quoted) },
    { key: 'won', value: fmtInt(leads.leads_won), extra: wonColor },
    { key: 'cplMeta', value: fmtCpl(cpls.cpl_meta) },
    { key: 'cplPlanified', value: fmtCpl(cpls.cpl_planified) },
    { key: 'cplQuoted', value: fmtCpl(cpls.cpl_quoted) },
    { key: 'cplWon', value: fmtCpl(cpls.cpl_won) },
  ];

  return (
    <tr className={trClass}>
      {leftCell}
      <td className={`px-3 ${padY}`}>
        <StatusBadge status={entity.entity_status} />
      </td>
      {cells.map((c) => (
        <td
          key={c.key}
          className={`px-3 ${padY} text-right tabular-nums ${textClass} ${c.extra || ''}`}
        >
          {c.value}
        </td>
      ))}
    </tr>
  );
}

function CampaignRow({ campaign, adsets, leadsByCampaign, leadsByAdset, expanded, onToggle }) {
  const leads = leadsByCampaign.get(campaign.entity_id) || EMPTY_LEADS;
  const hasAdsets = adsets.length > 0;

  const leftCell = (
    <>
      <td className="px-3 py-3">
        {hasAdsets ? (
          <button
            type="button"
            onClick={onToggle}
            className="text-secondary-400 hover:text-secondary-700"
            aria-label={expanded ? 'Réduire' : 'Développer'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <span className="inline-block w-4" />
        )}
      </td>
      <td className="px-3 py-3">
        <div className="font-medium text-secondary-900">{campaign.entity_name || campaign.entity_id}</div>
        <div className="text-xs text-secondary-500">{campaign.ad_account_name}</div>
      </td>
    </>
  );

  return (
    <>
      <MetricsRow entity={campaign} leads={leads} leftCell={leftCell} />
      {expanded && adsets.map((adset) => {
        const aLeads = leadsByAdset.get(adset.entity_id) || EMPTY_LEADS;
        const adsetLeftCell = (
          <>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2 pl-8">
              <div className="text-sm text-secondary-700">↳ {adset.entity_name || adset.entity_id}</div>
            </td>
          </>
        );
        return (
          <MetricsRow key={adset.entity_id} entity={adset} leads={aLeads} isAdset leftCell={adsetLeftCell} />
        );
      })}
    </>
  );
}

export function MetaAdsCampaignTable({ campaignStatsRows, adsetStatsRows, attribRows }) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const campaignsRollup = useMemo(() => rollupByEntity(campaignStatsRows), [campaignStatsRows]);
  const adsetsRollup = useMemo(() => rollupByEntity(adsetStatsRows), [adsetStatsRows]);

  const adsetsByCampaign = useMemo(() => {
    const map = new Map();
    for (const adset of adsetsRollup) {
      const key = adset.parent_campaign_id;
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(adset);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (b.spend_cents || 0) - (a.spend_cents || 0));
    }
    return map;
  }, [adsetsRollup]);

  const leadsByCampaign = useMemo(() => attributionByCampaign(attribRows), [attribRows]);
  const leadsByAdset = useMemo(() => attributionByAdset(attribRows), [attribRows]);

  const sortedCampaigns = useMemo(
    () => [...campaignsRollup].sort((a, b) => (b.spend_cents || 0) - (a.spend_cents || 0)),
    [campaignsRollup],
  );

  const toggle = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (sortedCampaigns.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-secondary-200 p-8 text-center text-secondary-500">
        Aucune donnée pour cette période.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-secondary-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-secondary-200 text-sm">
          <thead className="bg-secondary-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-secondary-600">
              <th className="px-3 py-2 w-6"></th>
              <th className="px-3 py-2">Campagne</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2 text-right">Dépense</th>
              <th className="px-3 py-2 text-right">Imp.</th>
              <th className="px-3 py-2 text-right">CTR</th>
              <th className="px-3 py-2 text-right">Leads Meta</th>
              <th className="px-3 py-2 text-right">Planifiés</th>
              <th className="px-3 py-2 text-right">Devis</th>
              <th className="px-3 py-2 text-right">Gagnés</th>
              <th className="px-3 py-2 text-right">CPL Meta</th>
              <th className="px-3 py-2 text-right">CPL Planifié</th>
              <th className="px-3 py-2 text-right">CPL Devis</th>
              <th className="px-3 py-2 text-right">CPL Gagné</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {sortedCampaigns.map((campaign) => (
              <CampaignRow
                key={campaign.entity_id}
                campaign={campaign}
                adsets={adsetsByCampaign.get(campaign.entity_id) || []}
                leadsByCampaign={leadsByCampaign}
                leadsByAdset={leadsByAdset}
                expanded={expandedIds.has(campaign.entity_id)}
                onToggle={() => toggle(campaign.entity_id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
