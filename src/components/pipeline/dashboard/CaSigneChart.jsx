/**
 * CaSigneChart.jsx — CA signé HT sur 12 mois (une seule série : pas d'échelles mélangées).
 * Les mois de la période choisie sont en couleur pleine, les autres en neutre.
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Panneau } from './Tableau';
import { entier, euros, libelleMois, libelleMoisCourt } from './format';

const COULEUR_PERIODE = '#0284c7'; // primary-600
const COULEUR_AUTRES = '#cbd5e1'; // secondary-300

const enMilliers = (v) => (v >= 1000 ? `${Math.round(v / 1000)} k€` : `${v} €`);

function Infobulle({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-secondary-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium capitalize text-secondary-900">{libelleMois(p.mois)}</p>
      <p className="mt-0.5 tabular-nums text-secondary-700">{euros(p.ca)} HT signés</p>
      <p className="tabular-nums text-secondary-500">
        {entier(p.ventes)} vente{p.ventes > 1 ? 's' : ''} · {entier(p.leads)} lead{p.leads > 1 ? 's' : ''} reçu{p.leads > 1 ? 's' : ''}
      </p>
    </div>
  );
}

export function CaSigneChart({ tendance, periode }) {
  const choisis = new Set(periode);
  return (
    <Panneau titre="CA signé HT" precision="12 mois, au mois de signature.">
      <div className="px-2 pb-2 pt-4">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={tendance} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="mois"
              tickFormatter={libelleMoisCourt}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
              interval={0}
            />
            <YAxis
              tickFormatter={enMilliers}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip content={<Infobulle />} cursor={{ fill: '#f1f5f9' }} />
            <Bar dataKey="ca" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {tendance.map((t) => (
                <Cell key={t.mois} fill={choisis.has(t.mois) ? COULEUR_PERIODE : COULEUR_AUTRES} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panneau>
  );
}
