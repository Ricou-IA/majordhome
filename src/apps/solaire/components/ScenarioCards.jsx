// src/apps/solaire/components/ScenarioCards.jsx
// Bandeau 3 scénarios (Sobre / Recommandé / Confort) — spec §9.
// Deutan : sélection = ring + badge texte, jamais la couleur seule.
import { Star, Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { formatEuro } from '@lib/utils';

/** Effort net mensuel : ▲ « effort » / ▼ « gain » / « — » si coût inconnu. */
export function EffortBadge({ monthlyValue, className = '' }) {
  if (monthlyValue === null || monthlyValue === undefined || Number.isNaN(monthlyValue)) {
    return <span className={`text-secondary-400 ${className}`}>—</span>;
  }
  const isGain = monthlyValue <= 0;
  const Icon = isGain ? TrendingDown : TrendingUp;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${isGain ? 'text-[#1565C0]' : 'text-secondary-800'} ${className}`}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      {isGain ? '▼ gain' : '▲ effort'} {formatEuro(Math.abs(Math.round(monthlyValue)))}/mois
    </span>
  );
}

export default function ScenarioCards({ scenarios, activeKwc, onSelect }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {scenarios.map((s) => {
        const isActive = s.kwc === activeKwc;
        const isRecommended = s.key === 'recommande';
        return (
          <button
            key={s.key}
            onClick={() => onSelect(s.kwc)}
            className={`text-left rounded-xl border p-4 space-y-2 transition-all ${
              isActive
                ? 'border-[#1565C0] ring-2 ring-[#1565C0] bg-blue-50/50'
                : 'border-secondary-200 bg-white hover:border-secondary-400'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-secondary-600 flex items-center gap-1">
                {isRecommended && <Star className="w-3.5 h-3.5 text-[#F5C542] fill-[#F5C542]" />}
                {s.label}
              </span>
              {isActive && (
                <span className="text-[11px] font-semibold text-[#1565C0] bg-blue-100 px-2 py-0.5 rounded-full">
                  Sélectionné
                </span>
              )}
            </div>

            <div className="text-xl font-bold text-secondary-900">
              {s.kwc} kWc
              <span className="text-sm font-normal text-secondary-500"> · {s.panels} panneaux</span>
            </div>

            <dl className="space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-secondary-500">Autoconsommation</dt>
                <dd className="font-semibold text-secondary-900">{Math.round(s.tauxAutoconso * 100)} %</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-secondary-500 flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5 text-secondary-400" /> Surplus perdu
                </dt>
                <dd className={`font-semibold ${s.surplusPct > 0.25 ? 'text-secondary-900' : 'text-secondary-700'}`}>
                  {Math.round(s.surplusPct * 100)} %
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-secondary-500">Économie an 1</dt>
                <dd className="font-semibold text-secondary-900">{formatEuro(Math.round(s.economyYear1))}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-secondary-500">Effort moyen</dt>
                <dd><EffortBadge monthlyValue={s.avgMonthlyEffort} className="text-xs" /></dd>
              </div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}
