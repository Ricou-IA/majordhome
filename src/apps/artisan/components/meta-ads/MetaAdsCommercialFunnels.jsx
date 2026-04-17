import { ChevronRight, User } from 'lucide-react';
import { FUNNEL_BENCHMARKS, STEP_COLORS, computeRate, rateColor } from './funnelUtils';

function MiniStep({ label, value, color = 'indigo' }) {
  return (
    <div className={`flex-1 min-w-[70px] rounded-md border px-2 py-1.5 ${STEP_COLORS[color] || STEP_COLORS.indigo}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function MiniTransition({ rate, benchmark }) {
  const display = rate == null ? '—' : `${rate.toFixed(0)}%`;
  return (
    <div className="flex flex-col items-center px-0.5 min-w-[42px]" title={benchmark.hint}>
      <ChevronRight className="w-4 h-4 text-secondary-300" />
      <div className={`text-xs font-semibold tabular-nums ${rateColor(rate, benchmark)}`}>{display}</div>
    </div>
  );
}

function CommercialFunnelCard({ commercial, stats }) {
  const rates = {
    pipelineToPlanified: computeRate(stats.leads_planified, stats.leads_total),
    planifiedToQuoted: computeRate(stats.leads_quoted, stats.leads_planified),
    quotedToWon: computeRate(stats.leads_won, stats.leads_quoted),
  };

  return (
    <div className="rounded-lg border border-secondary-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-full bg-secondary-100 flex items-center justify-center">
          <User className="w-4 h-4 text-secondary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-secondary-900 truncate">{commercial?.full_name || 'Commercial'}</div>
          <div className="text-xs text-secondary-500">{stats.leads_total} leads attribués</div>
        </div>
      </div>

      <div className="flex items-stretch gap-0.5 overflow-x-auto">
        <MiniStep label="Pipeline" value={stats.leads_total} color="indigo" />
        <MiniTransition rate={rates.pipelineToPlanified} benchmark={FUNNEL_BENCHMARKS.pipelineToPlanified} />
        <MiniStep label="Planifié" value={stats.leads_planified} color="violet" />
        <MiniTransition rate={rates.planifiedToQuoted} benchmark={FUNNEL_BENCHMARKS.planifiedToQuoted} />
        <MiniStep label="Devis" value={stats.leads_quoted} color="rose" />
        <MiniTransition rate={rates.quotedToWon} benchmark={FUNNEL_BENCHMARKS.quotedToWon} />
        <MiniStep label="Gagné" value={stats.leads_won} color="emerald" />
      </div>
    </div>
  );
}

/**
 * Affiche N funnels côte à côte, un par commercial.
 * Démarre à "Pipeline" (les leads attribués) car la dépense Meta est globale compte,
 * pas par commercial — le CPL n'a pas de sens à ce niveau, le taux de conversion si.
 */
export function MetaAdsCommercialFunnels({ attribRows, commercials }) {
  // Agréger les stats pipeline par commercial
  const byCommercial = new Map();
  for (const row of attribRows || []) {
    const key = row.commercial_id;
    if (!key) continue;
    if (!byCommercial.has(key)) {
      byCommercial.set(key, {
        leads_total: 0,
        leads_planified: 0,
        leads_quoted: 0,
        leads_won: 0,
      });
    }
    const agg = byCommercial.get(key);
    agg.leads_total += row.leads_total || 0;
    agg.leads_planified += row.leads_planified || 0;
    agg.leads_quoted += row.leads_quoted || 0;
    agg.leads_won += row.leads_won || 0;
  }

  const commercialById = new Map((commercials || []).map((c) => [c.id, c]));
  const rows = [...byCommercial.entries()]
    .map(([id, stats]) => ({ id, commercial: commercialById.get(id), stats }))
    .sort((a, b) => (b.stats.leads_total || 0) - (a.stats.leads_total || 0));

  if (rows.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-secondary-200 p-4">
      <div className="text-sm font-semibold text-secondary-900 mb-3">
        Performance par commercial
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((r) => (
          <CommercialFunnelCard key={r.id} commercial={r.commercial} stats={r.stats} />
        ))}
      </div>
    </div>
  );
}
