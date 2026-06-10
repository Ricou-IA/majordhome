// src/apps/solaire/components/MonthlyChart.jsx
// Graphique barres mensuel : production (jaune) / conso (bleu foncé) /
// autoconsommée (bleu clair) / surplus perdu (gris hachuré). Spec §10.1.
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { PV_COLORS } from '../lib/palette';

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export default function MonthlyChart({ monthly, consoMonthly }) {
  const data = MONTH_LABELS.map((label, i) => ({
    label,
    production: Math.round(monthly.prod[i]),
    conso: Math.round(consoMonthly[i]),
    autoconso: Math.round(monthly.autoconso[i]),
    surplus: Math.round(monthly.surplus[i]),
  }));

  return (
    <div className="card">
      <h3 className="font-semibold text-secondary-900 mb-3">Production vs consommation (kWh/mois)</h3>
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
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="production" name="Production" fill={PV_COLORS.production} />
          <Bar dataKey="conso" name="Consommation" fill={PV_COLORS.conso} />
          <Bar dataKey="autoconso" name="Autoconsommée" fill={PV_COLORS.autoconso} />
          <Bar dataKey="surplus" name="Surplus perdu" fill="url(#pvHatch)" stroke={PV_COLORS.surplus} strokeWidth={0.5} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
