// src/apps/solaire/components/AutoconsoOptimizationSection.jsx
// Section « Optimiser l'autoconsommation » greffée dans les Résultats (additif,
// n'altère pas buildEtudeModel). Rebranche le moteur horaire sur les données que
// le wizard a déjà : conso mensuelle (ancres) + prod (e_m réel × forme Gaillac).
import { useState, useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  Sankey, Layer, Rectangle,
} from 'recharts';
import { Sparkles, Waves, Snowflake, BatteryCharging, ChevronDown, ChevronUp, AlertTriangle, Droplets, Car } from 'lucide-react';
import { PV_COLORS } from '../lib/palette';
import { buildAutoconsoModel } from '../lib/autoconsoModel';
import { hourlyProdFromMonthly } from '../lib/autoconsoEngine';
import { pvgisExample } from '../data';

const CASCADE_LABELS = {
  constat: 'Constat', pilotage_ecs: 'Pilotage ECS',
  ve_weekend: 'VE week-end', pool: 'Piscine', clim: 'Clim', battery: 'Batterie',
};
const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const NODE_COLORS = {
  Solaire: PV_COLORS.production, Réseau: PV_COLORS.surplus,
  Batterie: PV_COLORS.autoconso, Maison: PV_COLORS.conso, Surplus: PV_COLORS.surplus,
};

function SankeyNode({ x, y, width, height, payload }) {
  const name = payload.name;
  const leftSide = name === 'Solaire' || name === 'Réseau';
  const above = name === 'Batterie';
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={NODE_COLORS[name] || '#94a3b8'} fillOpacity={0.9} radius={2} />
      {above ? (
        <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={10} fill="#475569">{name}</text>
      ) : (
        <text
          x={leftSide ? x + width + 5 : x - 5} y={y + height / 2}
          textAnchor={leftSide ? 'start' : 'end'} dominantBaseline="middle"
          fontSize={10} fill="#475569" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}
        >
          {name} {Math.round(payload.value)}
        </text>
      )}
    </Layer>
  );
}

function buildSankey(rawNodes, rawLinks) {
  const links = rawLinks.filter((l) => l.value > 0.5);
  const used = new Set();
  links.forEach((l) => { used.add(l.source); used.add(l.target); });
  const idxMap = {};
  const nodes = [];
  rawNodes.forEach((n, i) => { if (used.has(i)) { idxMap[i] = nodes.length; nodes.push(n); } });
  return { nodes, links: links.map((l) => ({ source: idxMap[l.source], target: idxMap[l.target], value: l.value })) };
}

function Slider({ label, value, min, max, step = 1, onChange, suffix }) {
  return (
    <label className="block">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-secondary-700">{label}</span>
        <span className="font-medium text-secondary-900">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary-600" />
    </label>
  );
}

function Toggle({ label, icon: Icon, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
        active ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium'
          : 'border-secondary-200 bg-white text-secondary-600 hover:bg-secondary-50'
      }`}>
      <Icon size={16} />{label}
    </button>
  );
}

export default function AutoconsoOptimizationSection({ consoMonthly, eM, activeKwc, ev, baseShape }) {
  const [open, setOpen] = useState(false);
  const [persons, setPersons] = useState(3);
  const [veBattery, setVeBattery] = useState(60);
  // Optimisations PROPOSÉES (toggles) — le constat s'affiche sans, on les active
  // avec le client. La batterie est une catégorie à part (stockage, pas confort).
  const [pilotageEcs, setPilotageEcs] = useState(false);
  const [veWeekend, setVeWeekend] = useState(false);
  const [pool, setPool] = useState(false);
  const [clim, setClim] = useState(false);
  const [batteryOn, setBatteryOn] = useState(false);

  const veActive = ev.enabled && veWeekend;
  const prodHourly = useMemo(() => hourlyProdFromMonthly(eM, activeKwc, pvgisExample.hourly), [eM, activeKwc]);
  const model = useMemo(() => buildAutoconsoModel({
    household: {
      persons,
      veKmPerYear: ev.enabled ? (Number(ev.kmPerYear) || 0) : 0,
      veBatteryKwh: veBattery,
    },
    monthlyConsoTotals: consoMonthly,
    baseShape,
    prodHourly,
    levers: { pilotageEcs, veWeekend: veActive, pool, clim, battery: batteryOn },
  }), [persons, veBattery, pilotageEcs, veActive, pool, clim, batteryOn, ev, consoMonthly, prodHourly, baseShape]);

  const cascade = model.cascade;
  const final = cascade[cascade.length - 1];
  const cascadeData = cascade.map((r) => ({
    label: CASCADE_LABELS[r.key] || r.key,
    autoconso: +(r.autoconsoRate * 100).toFixed(1),
    couverture: +(r.autoproductionRate * 100).toFixed(1),
  }));

  // Graphe mensuel « qui bouge » avec les toggles (démo client) : production /
  // autoconsommée / surplus de l'état optimisé courant.
  const monthlyData = model.monthly.prod.map((p, i) => ({
    label: MONTH_LABELS[i],
    production: Math.round(p),
    autoconso: Math.round(model.monthly.selfConsumed[i]),
    surplus: Math.round(model.monthly.surplus[i]),
  }));
  // Courbe de charge journée-type (24 h) : production + conso actuelle vs optimisée.
  const dayData = model.dayCurves.prod.map((p, h) => ({
    h: `${h}h`,
    production: +p.toFixed(2),
    actuelle: +model.dayCurves.consoBaseline[h].toFixed(2),
    optimisee: +model.dayCurves.conso[h].toFixed(2),
  }));
  // Sankey. Batterie : nœud tampon ÉQUILIBRÉ (entrée = sortie = énergie restituée) ;
  // les pertes (rendement η + reliquat SOC) sont fondues dans le puits « Surplus ».
  const flux = batteryOn ? model.batteryFlux : model.flux;
  const sankeyData = buildSankey(
    batteryOn
      ? [{ name: 'Solaire' }, { name: 'Réseau' }, { name: 'Batterie' }, { name: 'Maison' }, { name: 'Surplus' }]
      : [{ name: 'Solaire' }, { name: 'Réseau' }, { name: 'Maison' }, { name: 'Surplus' }],
    batteryOn
      ? [
        { source: 0, target: 3, value: Math.round(flux.directKwh) },
        { source: 0, target: 2, value: Math.round(flux.fromBatteryKwh) },
        { source: 2, target: 3, value: Math.round(flux.fromBatteryKwh) },
        { source: 0, target: 4, value: Math.round(flux.exportedKwh + (flux.chargedKwh - flux.fromBatteryKwh)) },
        { source: 1, target: 3, value: Math.round(flux.importedKwh) },
      ]
      : [
        { source: 0, target: 2, value: Math.round(flux.directKwh) },
        { source: 0, target: 3, value: Math.round(flux.exportedKwh) },
        { source: 1, target: 2, value: Math.round(flux.importedKwh) },
      ],
  );

  return (
    <div className="card">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold text-secondary-900">
          <Sparkles className="w-5 h-5 text-primary-600" /> Optimiser l'autoconsommation
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-secondary-400" /> : <ChevronDown className="w-4 h-4 text-secondary-400" />}
      </button>

      {open && (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
          {/* Réglages + optimisations proposées (toggles) */}
          <div className="space-y-4">
            <Slider label="Personnes" value={persons} min={1} max={6} onChange={setPersons} />

            <div>
              <div className="text-sm font-medium text-secondary-800 mb-2">Optimisations à proposer</div>
              <div className="flex flex-wrap gap-2">
                <Toggle label="Pilotage ECS" icon={Droplets} active={pilotageEcs} onClick={() => setPilotageEcs(!pilotageEcs)} />
                {ev.enabled && (
                  <Toggle label="Recharge VE week-end" icon={Car} active={veWeekend} onClick={() => setVeWeekend(!veWeekend)} />
                )}
              </div>
              {ev.enabled && veWeekend && (
                <div className="mt-3">
                  <Slider label="Batterie voiture" value={veBattery} min={20} max={100} step={5} onChange={setVeBattery} suffix=" kWh" />
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium text-secondary-800 mb-2">Confort <span className="text-xs text-secondary-500">(le surplus le finance)</span></div>
              <div className="flex flex-wrap gap-2">
                <Toggle label="Piscine" icon={Waves} active={pool} onClick={() => setPool(!pool)} />
                <Toggle label="Clim été" icon={Snowflake} active={clim} onClick={() => setClim(!clim)} />
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-secondary-800 mb-2">Stockage</div>
              <div className="flex flex-wrap gap-2">
                <Toggle label="Batterie" icon={BatteryCharging} active={batteryOn} onClick={() => setBatteryOn(!batteryOn)} />
              </div>
            </div>
            {model.warnings.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                Les usages déclarés dépassent la consommation de certains mois — ajustez les usages ou la conso.
              </p>
            )}
          </div>

          {/* Résultats */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-secondary-50 p-3">
                <div className="text-xs text-secondary-600">Autoconsommation</div>
                <div className="text-2xl font-semibold" style={{ color: PV_COLORS.blueMid }}>{(final.autoconsoRate * 100).toFixed(0)} %</div>
              </div>
              <div className="rounded-lg bg-secondary-50 p-3">
                <div className="text-xs text-secondary-600">Couverture des besoins</div>
                <div className="text-2xl font-semibold" style={{ color: PV_COLORS.production }}>{(final.autoproductionRate * 100).toFixed(0)} %</div>
              </div>
            </div>

            {/* Graphe mensuel qui BOUGE avec les toggles (démo directe client) */}
            <div>
              <div className="text-sm font-medium text-secondary-800 mb-1">
                Production vs autoconsommation <span className="text-xs font-normal text-secondary-500">(bouge avec les optimisations)</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={monthlyData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, n) => [`${v} kWh`, n]} />
                  <Bar dataKey="production" name="Production" fill={PV_COLORS.production} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="autoconso" name="Autoconsommée" fill={PV_COLORS.autoconso} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="surplus" name="Surplus" fill={PV_COLORS.surplus} radius={[2, 2, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Courbe de charge journée-type : la conso glisse sous la cloche solaire */}
            <div>
              <div className="text-sm font-medium text-secondary-800 mb-1">
                Journée-type <span className="text-xs font-normal text-secondary-500">(la conso se cale sous le soleil)</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={dayData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="h" tick={{ fontSize: 9 }} interval={2} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, n) => [`${v} kWh`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area dataKey="production" name="Production solaire" fill={PV_COLORS.production} stroke={PV_COLORS.production} fillOpacity={0.35} />
                  <Line dataKey="actuelle" name="Conso actuelle" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                  <Line dataKey="optimisee" name="Conso optimisée" stroke={PV_COLORS.blueMid} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div>
              <div className="text-sm font-medium text-secondary-800 mb-1">Cascade « Cible »</div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={cascadeData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v, n) => [`${v} %`, n === 'autoconso' ? 'Autoconso' : 'Couverture']} />
                  <Bar dataKey="autoconso" name="Autoconso" fill={PV_COLORS.production} radius={[3, 3, 0, 0]} />
                  <Line dataKey="couverture" name="Couverture" type="monotone" stroke={PV_COLORS.blueMid} strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div>
              <div className="text-sm font-medium text-secondary-800 mb-1">Où va votre électricité</div>
              <ResponsiveContainer width="100%" height={210}>
                <Sankey data={sankeyData} node={<SankeyNode />} nodePadding={24} nodeWidth={10}
                  link={{ stroke: '#cbd5e1', strokeOpacity: 0.5 }} margin={{ left: 60, right: 70, top: 10, bottom: 10 }}>
                  <Tooltip formatter={(v) => [`${v} kWh`, '']} />
                </Sankey>
              </ResponsiveContainer>
            </div>

            <p className="text-xs text-secondary-500">
              Calcul horaire réel (talon Enedis + production du lieu). Le surplus n'est jamais valorisé en euros :
              il finance de l'autoconsommation ou du confort (piscine, clim).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
