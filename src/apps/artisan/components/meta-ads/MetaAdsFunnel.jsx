import { ChevronRight, AlertTriangle } from 'lucide-react';
import { FUNNEL_BENCHMARKS, STEP_COLORS, computeRate, rateColor } from './funnelUtils';

function StepCard({ label, value, color = 'blue' }) {
  return (
    <div className={`flex-1 min-w-[90px] rounded-lg border px-3 py-2 ${STEP_COLORS[color] || STEP_COLORS.blue}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function Transition({ rate, benchmark }) {
  const display = rate == null ? '—' : `${rate.toFixed(0)}%`;
  return (
    <div className="flex flex-col items-center px-1 min-w-[70px]" title={benchmark.hint}>
      <ChevronRight className="w-5 h-5 text-secondary-300" />
      <div className={`text-sm font-semibold tabular-nums ${rateColor(rate, benchmark)}`}>{display}</div>
      <div className="text-[10px] text-secondary-500 mt-0.5 text-center leading-tight">
        bench. {benchmark.avg}-{benchmark.good}%
      </div>
    </div>
  );
}

export function MetaAdsFunnel({ kpis }) {
  const {
    leads_meta = 0,
    leads_total = 0,
    leads_planified = 0,
    leads_quoted = 0,
    leads_won = 0,
  } = kpis || {};

  const rates = {
    pipelineToPlanified: computeRate(leads_planified, leads_total),
    planifiedToQuoted: computeRate(leads_quoted, leads_planified),
    quotedToWon: computeRate(leads_won, leads_quoted),
  };

  const ingestionRate = computeRate(leads_total, leads_meta);
  const ingestionOk = ingestionRate == null || ingestionRate >= 90;

  return (
    <div className="bg-white rounded-lg border border-secondary-200 p-4">
      <div className="text-sm font-semibold text-secondary-900 mb-3">
        Funnel de conversion
      </div>

      {/* Info discrète : leads Meta + taux d'ingestion technique */}
      <div className="flex items-center justify-between text-xs mb-3 px-2">
        <div className="flex items-center gap-3 text-secondary-600">
          <span>
            Leads Meta sur la période :{' '}
            <strong className="text-secondary-900 tabular-nums">{leads_meta}</strong>
          </span>
          {ingestionRate != null && (
            <span className={ingestionOk ? 'text-secondary-500' : 'text-amber-700 font-medium'}>
              {ingestionOk ? (
                <>ingérés au pipeline : {ingestionRate.toFixed(0)}%</>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Ingestion pipeline à {ingestionRate.toFixed(0)}% — polling peut-être dégradé
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        <StepCard label="Pipeline" value={leads_total} color="indigo" />
        <Transition rate={rates.pipelineToPlanified} benchmark={FUNNEL_BENCHMARKS.pipelineToPlanified} />
        <StepCard label="Planifié" value={leads_planified} color="violet" />
        <Transition rate={rates.planifiedToQuoted} benchmark={FUNNEL_BENCHMARKS.planifiedToQuoted} />
        <StepCard label="Devis" value={leads_quoted} color="rose" />
        <Transition rate={rates.quotedToWon} benchmark={FUNNEL_BENCHMARKS.quotedToWon} />
        <StepCard label="Gagné" value={leads_won} color="emerald" />
      </div>
    </div>
  );
}
