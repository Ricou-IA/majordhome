// src/apps/solaire/pages/AutoconsoSimulateur.jsx
// Simulateur INTERACTIF d'autoconsommation — outil de conversation client.
// Curseurs + toggles → recalcul live de la cascade « Cible » (moteur pur, ~ms,
// 100% navigateur sur fixtures réelles Enedis + PVGIS). Aucune écriture, aucun serveur.
import { useState, useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, LineChart,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, Sankey, Layer, Rectangle,
} from 'recharts';
import { Sun, Car, Waves, Snowflake, BatteryCharging, Info } from 'lucide-react';
import { PV_COLORS } from '../lib/palette';
import { buildAutoconsoModel, buildDevices } from '../lib/autoconsoModel';
import { devicesMonthlyKwh, monthlyFromHourly } from '../lib/autoconsoEngine';
import { enedisProfile, pvgisExample } from '../data';

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

// Construit les données Sankey en retirant les liens nuls et les nœuds orphelins (Recharts plante sinon).
function buildSankey(rawNodes, rawLinks) {
  const links = rawLinks.filter((l) => l.value > 0.5);
  const used = new Set();
  links.forEach((l) => { used.add(l.source); used.add(l.target); });
  const idxMap = {};
  const nodes = [];
  rawNodes.forEach((n, i) => { if (used.has(i)) { idxMap[i] = nodes.length; nodes.push(n); } });
  return { nodes, links: links.map((l) => ({ source: idxMap[l.source], target: idxMap[l.target], value: l.value })) };
}

// Répartition mensuelle par défaut (profil résidentiel RES1 mesuré, % de l'année).
const MONTHLY_SHAPE = [11.3, 9.7, 9.5, 8.0, 7.3, 6.8, 7.0, 7.0, 6.8, 7.2, 9.0, 10.3];
const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const CASCADE_LABELS = {
  constat: 'Constat', behavior: 'Comportement', piloted_ecs: 'Piloté ECS',
  ve_weekend: 'VE week-end', pool: 'Piscine', clim: 'Clim', battery: 'Batterie',
};

function Slider({ label, value, min, max, step = 1, onChange, suffix }) {
  return (
    <label className="block">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-secondary-700">{label}</span>
        <span className="font-medium text-secondary-900">{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary-600"
      />
    </label>
  );
}

function Toggle({ label, icon: Icon, active, onClick }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
        active
          ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium'
          : 'border-secondary-200 bg-white text-secondary-600 hover:bg-secondary-50'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function Kpi({ label, value, accent }) {
  return (
    <div className="rounded-xl bg-secondary-50 p-4">
      <div className="text-sm text-secondary-600 mb-1">{label}</div>
      <div className="text-3xl font-medium" style={{ color: accent }}>{value}</div>
    </div>
  );
}

export default function AutoconsoSimulateur() {
  const [persons, setPersons] = useState(4);
  const [pvKwc, setPvKwc] = useState(6);
  const [baseKwh, setBaseKwh] = useState(2500);
  const [pacKwh, setPacKwh] = useState(4000);
  const [veOn, setVeOn] = useState(true);
  const [veKm, setVeKm] = useState(15000);
  const [veBattery, setVeBattery] = useState(60);
  const [pool, setPool] = useState(false);
  const [clim, setClim] = useState(false);
  const [batteryOn, setBatteryOn] = useState(true);

  const talon = enedisProfile.hourly;
  const prodHourly = useMemo(() => pvgisExample.hourly.map((x) => x * pvKwc), [pvKwc]);

  const household = useMemo(() => ({
    persons,
    veKmPerYear: veOn ? veKm : 0,
    veBatteryKwh: veBattery,
    pool: pool ? {} : undefined,
    clim,
    pacAnnualKwh: pacKwh,
  }), [persons, veOn, veKm, veBattery, pool, clim, pacKwh]);

  // Conso totale COHÉRENTE = base foyer + usages (évite un total qui contredit les usages).
  const deviceMonthly = useMemo(() => devicesMonthlyKwh(buildDevices(household)), [household]);
  const monthlyConsoTotals = useMemo(
    () => MONTHLY_SHAPE.map((p, m) => (baseKwh * p) / 100 + deviceMonthly[m]),
    [baseKwh, deviceMonthly],
  );
  const totalConso = Math.round(monthlyConsoTotals.reduce((a, b) => a + b, 0));

  const model = useMemo(
    () => buildAutoconsoModel({ household, monthlyConsoTotals, baseShape: talon, prodHourly }),
    [household, monthlyConsoTotals, talon, prodHourly],
  );

  const cascade = batteryOn ? model.cascade : model.cascade.filter((r) => r.key !== 'battery');
  const final = cascade[cascade.length - 1];
  const prodAnnual = Math.round(prodHourly.reduce((a, b) => a + b, 0));
  const prodMonthly = monthlyFromHourly(prodHourly);
  const flux = batteryOn ? model.batteryFlux : model.flux;
  const sankeyData = buildSankey(
    batteryOn
      ? [{ name: 'Solaire' }, { name: 'Réseau' }, { name: 'Batterie' }, { name: 'Maison' }, { name: 'Surplus' }]
      : [{ name: 'Solaire' }, { name: 'Réseau' }, { name: 'Maison' }, { name: 'Surplus' }],
    batteryOn
      ? [
        { source: 0, target: 3, value: Math.round(flux.directKwh) },
        { source: 0, target: 2, value: Math.round(flux.chargedKwh) },
        { source: 2, target: 3, value: Math.round(flux.fromBatteryKwh) },
        { source: 0, target: 4, value: Math.round(flux.exportedKwh) },
        { source: 1, target: 3, value: Math.round(flux.importedKwh) },
      ]
      : [
        { source: 0, target: 2, value: Math.round(flux.directKwh) },
        { source: 0, target: 3, value: Math.round(flux.exportedKwh) },
        { source: 1, target: 2, value: Math.round(flux.importedKwh) },
      ],
  );

  const cascadeData = cascade.map((r) => ({
    label: CASCADE_LABELS[r.key] || r.key,
    autoconso: +(r.autoconsoRate * 100).toFixed(1),
    couverture: +(r.autoproductionRate * 100).toFixed(1),
  }));
  const monthlyData = model.annualByMonth.map((v, i) => ({ label: MONTHS[i], conso: Math.round(v), production: Math.round(prodMonthly[i]) }));
  const dayData = model.dayTypeWinter.map((w, i) => ({
    h: `${i}h`, hiver: +w.toFixed(2), ete: +model.dayTypeSummer[i].toFixed(2),
  }));

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-secondary-900 flex items-center gap-2">
          <Sun className="text-yellow-500" size={22} /> Simulateur d'autoconsommation
        </h1>
        <p className="text-sm text-secondary-600 mt-1">
          Ajustez les usages du foyer et construisez l'optimal avec le client. Recalcul instantané —
          données réelles (talon Enedis RES1 + production PVGIS Gaillac).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        {/* Contrôles */}
        <div className="card p-4 space-y-4 h-fit">
          <h2 className="text-sm font-medium text-secondary-800">Le foyer</h2>
          <Slider label="Personnes" value={persons} min={1} max={6} onChange={setPersons} />
          <Slider label="Conso de base (hors gros usages)" value={baseKwh} min={1000} max={6000} step={250} onChange={setBaseKwh} suffix=" kWh/an" />
          <div className="text-xs text-secondary-500 -mt-1">Conso totale ≈ <span className="font-medium text-secondary-700">{totalConso.toLocaleString('fr-FR')}</span> kWh/an (base + usages)</div>
          <Slider label="Puissance PV" value={pvKwc} min={3} max={9} step={0.5} onChange={setPvKwc} suffix=" kWc" />
          <Slider label="Chauffage PAC" value={pacKwh} min={0} max={8000} step={250} onChange={setPacKwh} suffix=" kWh/an" />

          <div className="border-t border-secondary-100 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-secondary-800">Véhicule électrique</span>
              <Toggle label={veOn ? 'Oui' : 'Non'} icon={Car} active={veOn} onClick={() => setVeOn(!veOn)} />
            </div>
            {veOn && (
              <>
                <Slider label="Kilométrage" value={veKm} min={5000} max={30000} step={1000} onChange={setVeKm} suffix=" km/an" />
                <Slider label="Batterie voiture" value={veBattery} min={20} max={100} step={5} onChange={setVeBattery} suffix=" kWh" />
              </>
            )}
          </div>

          <div className="border-t border-secondary-100 pt-3">
            <div className="text-sm font-medium text-secondary-800 mb-2 flex items-center gap-1">
              Confort <span className="text-xs text-secondary-500">(le surplus le finance)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle label="Piscine" icon={Waves} active={pool} onClick={() => setPool(!pool)} />
              <Toggle label="Clim été" icon={Snowflake} active={clim} onClick={() => setClim(!clim)} />
              <Toggle label="Batterie" icon={BatteryCharging} active={batteryOn} onClick={() => setBatteryOn(!batteryOn)} />
            </div>
          </div>
        </div>

        {/* Résultats */}
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Kpi label="Autoconsommation" value={`${(final.autoconsoRate * 100).toFixed(0)} %`} accent={PV_COLORS.blueMid} />
            <Kpi label="Couverture des besoins" value={`${(final.autoproductionRate * 100).toFixed(0)} %`} accent={PV_COLORS.production} />
          </div>

          <div className="card p-4">
            <h2 className="text-sm font-medium text-secondary-800 mb-1">Cascade « Cible »</h2>
            <p className="text-xs text-secondary-500 mb-3">Chaque levier fait grimper la part de solaire consommée sur place.</p>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={cascadeData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v, n) => [`${v} %`, n === 'autoconso' ? 'Autoconso' : 'Couverture']} />
                <Bar dataKey="autoconso" name="Autoconso" fill={PV_COLORS.production} radius={[3, 3, 0, 0]} />
                <Line dataKey="couverture" name="Couverture" type="monotone" stroke={PV_COLORS.blueMid} strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-4">
            <h2 className="text-sm font-medium text-secondary-800 mb-1">Où va votre électricité</h2>
            <p className="text-xs text-secondary-500 mb-2">
              Flux annuel (kWh){batteryOn ? ' — avec batterie tampon' : ''}. Le surplus part au réseau sans être valorisé.
            </p>
            <ResponsiveContainer width="100%" height={230}>
              <Sankey
                data={sankeyData} node={<SankeyNode />} nodePadding={26} nodeWidth={10}
                link={{ stroke: '#cbd5e1', strokeOpacity: 0.5 }}
                margin={{ left: 62, right: 72, top: 12, bottom: 12 }}
              >
                <Tooltip formatter={(v) => [`${v} kWh`, '']} />
              </Sankey>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="card p-4">
              <h2 className="text-sm font-medium text-secondary-800 mb-3">Conso &amp; production par mois (kWh)</h2>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={monthlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, n) => [`${v} kWh`, n === 'conso' ? 'Conso' : 'Production']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="conso" name="Conso" fill={PV_COLORS.conso} radius={[2, 2, 0, 0]} />
                  <Line dataKey="production" name="Production PV" type="monotone" stroke={PV_COLORS.production} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-medium text-secondary-800 mb-3">Journée-type (kW moyen)</h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={dayData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="h" tick={{ fontSize: 10 }} interval={3} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line dataKey="hiver" name="Hiver" type="monotone" stroke={PV_COLORS.blueMid} strokeWidth={2} dot={false} />
                  <Line dataKey="ete" name="Été" type="monotone" stroke={PV_COLORS.production} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-secondary-500">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              Production {prodAnnual} kWh/an ({pvKwc} kWc). Les leviers confort (piscine, clim) puisent dans le
              même surplus — activez-les pour voir l'arbitrage. Le surplus n'est jamais valorisé en euros :
              il finance de l'autoconsommation ou du confort.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
