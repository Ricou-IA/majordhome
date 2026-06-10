// src/apps/solaire/components/TableauAnnuel.jsx
// LE livrable commercial (spec §8.7) : 3 indicateurs + tableau annuel
// (économie / annuité / effort net / cumul) + graphique de cumul.
// Deutan : effort/gain portés par icône + texte, jamais la couleur seule.
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceDot, CartesianGrid,
} from 'recharts';
import { CalendarCheck, PiggyBank, Scale } from 'lucide-react';
import { formatEuro } from '@lib/utils';
import { PV_COLORS } from '../lib/palette';
import { EffortBadge } from './ScenarioCards';

export default function TableauAnnuel({ table, loanYears, horizonYears }) {
  const { rows, indicators } = table;
  const neutralityRow = indicators.neutralityYear
    ? rows[indicators.neutralityYear - 1]
    : null;

  return (
    <div className="space-y-4">
      {/* 3 indicateurs de tête */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card">
          <p className="text-xs text-secondary-500 flex items-center gap-1.5 mb-1">
            <Scale className="w-3.5 h-3.5" /> Effort mensuel moyen pendant le crédit
          </p>
          <EffortBadge monthlyValue={indicators.avgMonthlyEffortDuringLoan} className="text-lg" />
        </div>
        <div className="card">
          <p className="text-xs text-secondary-500 flex items-center gap-1.5 mb-1">
            <CalendarCheck className="w-3.5 h-3.5" /> Année de neutralité
          </p>
          <p className="text-lg font-bold text-secondary-900">
            {indicators.neutralityYear ? `Année ${indicators.neutralityYear}` : `Au-delà de ${horizonYears} ans`}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-secondary-500 flex items-center gap-1.5 mb-1">
            <PiggyBank className="w-3.5 h-3.5" /> Gain total sur {horizonYears} ans
          </p>
          <p className={`text-lg font-bold ${indicators.totalGainAtHorizon >= 0 ? 'text-[#1565C0]' : 'text-secondary-900'}`}>
            {formatEuro(Math.round(indicators.totalGainAtHorizon))}
          </p>
        </div>
      </div>

      {/* Graphique cumul */}
      <div className="card">
        <h3 className="font-semibold text-secondary-900 mb-3">Cumul (économies − annuités)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart
            data={rows.map((r) => ({ year: r.year, cumul: Math.round(r.cumul) }))}
            margin={{ top: 4, right: 8, left: -10, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(value) => [formatEuro(value), 'Cumul']} labelFormatter={(y) => `Année ${y}`} />
            <ReferenceLine y={0} stroke={PV_COLORS.surplus} strokeWidth={1.5} />
            <Area type="monotone" dataKey="cumul" stroke={PV_COLORS.blueMid} fill={PV_COLORS.autoconso} fillOpacity={0.25} strokeWidth={2} />
            {neutralityRow && (
              <ReferenceDot
                x={neutralityRow.year}
                y={Math.round(neutralityRow.cumul)}
                r={5}
                fill={PV_COLORS.production}
                stroke={PV_COLORS.blueMid}
                strokeWidth={2}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
        {neutralityRow && (
          <p className="text-xs text-secondary-500 mt-1">
            ● Point de bascule : année {neutralityRow.year} — l'opération devient gagnante.
          </p>
        )}
      </div>

      {/* Tableau annuel */}
      <div className="card overflow-x-auto">
        <h3 className="font-semibold text-secondary-900 mb-3">Tableau annuel</h3>
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-left text-xs text-secondary-500 border-b border-secondary-200">
              <th className="py-2 pr-2 font-medium">Année</th>
              <th className="py-2 pr-2 font-medium text-right">Économie élec</th>
              <th className="py-2 pr-2 font-medium text-right">Annuité crédit</th>
              <th className="py-2 pr-2 font-medium text-right">Effort net</th>
              <th className="py-2 font-medium text-right">Cumul</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isNeutrality = r.year === indicators.neutralityYear;
              const isLoanEnd = r.year === loanYears;
              return (
                <tr
                  key={r.year}
                  className={`border-b border-secondary-100 ${
                    isLoanEnd ? 'border-b-2 border-secondary-300' : ''
                  } ${isNeutrality ? 'bg-blue-50/60' : ''}`}
                >
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <span className="font-medium text-secondary-800">{r.year}</span>
                    {isNeutrality && (
                      <span className="ml-1.5 text-[10px] font-semibold text-[#1565C0] bg-blue-100 px-1.5 py-0.5 rounded-full">
                        Neutralité
                      </span>
                    )}
                    {isLoanEnd && (
                      <span className="ml-1.5 text-[10px] font-semibold text-secondary-600 bg-secondary-100 px-1.5 py-0.5 rounded-full">
                        Fin du crédit
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-secondary-800">{formatEuro(Math.round(r.economy))}</td>
                  <td className="py-1.5 pr-2 text-right text-secondary-800">
                    {r.annuity > 0 ? formatEuro(Math.round(r.annuity)) : <span className="text-secondary-400">0 €</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                    <EffortBadge monthlyValue={r.effortNet === 0 ? 0 : r.effortNet / 12} className="text-xs" />
                  </td>
                  <td className={`py-1.5 text-right font-medium ${r.cumul >= 0 ? 'text-[#1565C0]' : 'text-secondary-800'}`}>
                    {formatEuro(Math.round(r.cumul))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
