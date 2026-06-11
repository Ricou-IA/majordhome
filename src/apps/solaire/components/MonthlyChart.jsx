// src/apps/solaire/components/MonthlyChart.jsx
// Graphique barres mensuel : production (jaune) / conso (bleu foncé) /
// autoconsommée (bleu clair) / surplus perdu (gris hachuré). Spec §10.1.
// Légende = chips cliquables avec total annuel : un clic masque/affiche la
// série pour mettre en valeur les autres (état porté par opacité + barré,
// jamais par la couleur seule — deutan).
import { useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { PV_COLORS } from '../lib/palette';

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const SERIES = [
  { key: 'production', label: 'Production', color: PV_COLORS.production },
  { key: 'conso', label: 'Consommation', color: PV_COLORS.conso },
  { key: 'autoconso', label: 'Autoconsommée', color: PV_COLORS.autoconso },
  { key: 'surplus', label: 'Surplus perdu', color: PV_COLORS.surplus, hatched: true },
];

const fmtKwh = (v) => `${Math.round(v).toLocaleString('fr-FR')} kWh`;

export default function MonthlyChart({ monthly, consoMonthly }) {
  const [hidden, setHidden] = useState(() => new Set());

  const toggle = (key) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const data = MONTH_LABELS.map((label, i) => ({
    label,
    production: Math.round(monthly.prod[i]),
    conso: Math.round(consoMonthly[i]),
    autoconso: Math.round(monthly.autoconso[i]),
    surplus: Math.round(monthly.surplus[i]),
  }));

  const annualTotals = {
    production: monthly.totals.prod,
    conso: monthly.totals.conso,
    autoconso: monthly.totals.autoconso,
    surplus: monthly.totals.surplus,
  };

  return (
    <div className="card">
      <h3 className="font-semibold text-secondary-900 mb-3">Production vs consommation (kWh/mois)</h3>

      {/* Chips cliquables : couleur + libellé + total annuel */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {SERIES.map((s) => {
          const isHidden = hidden.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              aria-pressed={!isHidden}
              title={isHidden ? 'Afficher la série' : 'Masquer la série'}
              className={`rounded-lg border px-2.5 py-2 text-left transition-all ${
                isHidden
                  ? 'border-secondary-200 bg-secondary-50 opacity-40'
                  : 'border-secondary-200 bg-white hover:border-secondary-400'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0 border border-black/10"
                  style={
                    s.hatched
                      ? { background: 'repeating-linear-gradient(45deg, #E5E7EB, #E5E7EB 2px, #9CA3AF 2px, #9CA3AF 3px)' }
                      : { backgroundColor: s.color }
                  }
                />
                <span className={`text-xs text-secondary-600 truncate ${isHidden ? 'line-through' : ''}`}>
                  {s.label}
                </span>
              </span>
              <span className={`block text-sm font-semibold text-secondary-900 mt-0.5 ${isHidden ? 'line-through' : ''}`}>
                {fmtKwh(annualTotals[s.key])}
                <span className="text-[10px] font-normal text-secondary-500"> /an</span>
              </span>
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <defs>
            <pattern id="pvHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#E5E7EB" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={PV_COLORS.surplus} strokeWidth="2" />
            </pattern>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value, name) => [`${value} kWh`, name]} />
          <Bar dataKey="production" name="Production" fill={PV_COLORS.production} hide={hidden.has('production')} />
          <Bar dataKey="conso" name="Consommation" fill={PV_COLORS.conso} hide={hidden.has('conso')} />
          <Bar dataKey="autoconso" name="Autoconsommée" fill={PV_COLORS.autoconso} hide={hidden.has('autoconso')} />
          <Bar
            dataKey="surplus"
            name="Surplus perdu"
            fill="url(#pvHatch)"
            stroke={PV_COLORS.surplus}
            strokeWidth={0.5}
            hide={hidden.has('surplus')}
          />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-secondary-500 mt-1">
        Astuce : cliquer sur une vignette masque/affiche la série pour mettre les autres en valeur.
      </p>
    </div>
  );
}
