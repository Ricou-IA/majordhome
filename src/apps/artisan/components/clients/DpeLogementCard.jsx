/**
 * DpeLogementCard.jsx — La carte du logement tirée d'un DPE (seule carte, partagée)
 * ============================================================================
 * Rend un « record » au format `mapDpeRecord` (API publique ADEME, recherche de voisinage) ou
 * `mapCorpusDossier` (corpus MonsieurDPE, bloc Logement de la fiche) : chauffage, eau chaude, froid,
 * ventilation, consommation, isolation, où part la chaleur, coût annuel, équipements à recenser.
 * Le haut (`entete`) et le pied (`actions`) sont fournis par l'appelant. Rien n'est calculé ici :
 * tout passe par les fonctions pures de src/lib/dpeApi.js.
 * ============================================================================
 */
import { Flame, Droplets, Snowflake, Wind, Ruler, CalendarClock, Plus } from 'lucide-react';
import { isDpeExpired, buildHeatLossBreakdown, buildCostBreakdown, buildEquipmentDrafts } from '@/lib/dpeApi';
import { formatDateShortFR, formatEuro } from '@/lib/utils';

/**
 * Échelle bleu → ambre, jamais rouge/vert (convention deutan du projet). La lettre reste affichée :
 * la couleur ne porte jamais l'information seule.
 */
const DPE_TONE = {
  A: 'bg-blue-100 text-blue-800 border-blue-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-sky-100 text-sky-800 border-sky-200',
  D: 'bg-secondary-100 text-secondary-700 border-secondary-200',
  E: 'bg-amber-100 text-amber-800 border-amber-200',
  F: 'bg-amber-200 text-amber-900 border-amber-300',
  G: 'bg-amber-300 text-amber-950 border-amber-400',
};

export function DpeBadge({ letter }) {
  if (!letter) return null;
  const tone = DPE_TONE[letter.toUpperCase()] || 'bg-secondary-100 text-secondary-700 border-secondary-200';
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md border text-sm font-bold ${tone}`}>
      {letter.toUpperCase()}
    </span>
  );
}

function Line({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-secondary-400" />
      <span className="text-secondary-500 shrink-0">{label}</span>
      <span className="text-secondary-800 font-medium">{value}</span>
    </div>
  );
}

function Pastilles({ titre, items }) {
  const visibles = items.filter(([, v]) => v);
  if (visibles.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1" aria-label={titre}>
      {visibles.map(([label, value]) => (
        <span key={label} className="px-2 py-0.5 text-xs rounded-md bg-secondary-50 border border-secondary-200 text-secondary-600">
          {label} · <span className="font-medium text-secondary-800">{value}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Répartition des déperditions. Barres en ambre (palette deutan), pourcentage TOUJOURS écrit : la largeur ne
 * porte jamais l'information seule.
 */
function HeatLossBars({ record }) {
  const posts = buildHeatLossBreakdown(record);
  if (posts.length === 0) return null;
  return (
    <div className="pt-2.5 border-t border-secondary-100">
      <p className="text-xs font-medium text-secondary-500 mb-2">
        Où part la chaleur
        {record.ubat && <span className="font-normal text-secondary-400"> · Ubat {String(record.ubat).replace('.', ',')} W/m²·K</span>}
      </p>
      <div className="space-y-1">
        {posts.map((p) => (
          <div key={p.key} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-xs text-secondary-600">{p.label}</span>
            <div className="flex-1 h-2 bg-secondary-100 rounded-full overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${p.share}%` }} />
            </div>
            <span className="w-9 shrink-0 text-right text-xs font-medium text-secondary-800">{Math.round(p.share)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostBreakdown({ record }) {
  const items = buildCostBreakdown(record);
  if (items.length === 0) return null;
  return (
    <div className="pt-2.5 border-t border-secondary-100">
      <p className="text-xs font-medium text-secondary-500 mb-1.5">
        Coût annuel
        {record.costs?.total && <span className="text-secondary-800"> · {formatEuro(record.costs.total)}</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <span key={i.key} className="px-2 py-0.5 text-xs rounded-md bg-secondary-50 border border-secondary-200 text-secondary-600">
            {i.label} · <span className="font-medium text-secondary-800">{formatEuro(i.euros)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Équipements que le DPE permet de recenser. Le clic ouvre la modale d'ajout pré-remplie — rien n'est créé sans
 * validation, la donnée peut dater de plusieurs années.
 */
function EquipmentDrafts({ record, onCreate }) {
  const drafts = buildEquipmentDrafts(record);
  if (drafts.length === 0 || !onCreate) return null;
  return (
    <div className="pt-2.5 border-t border-secondary-100">
      <p className="text-xs font-medium text-secondary-500 mb-1.5">Équipements identifiés — à recenser dans la fiche</p>
      <div className="flex flex-wrap gap-1.5">
        {drafts.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => onCreate(d)}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
            title={`${d.source} — ouvre la modale d’ajout pré-remplie`}
          >
            <Plus className="w-3 h-3" />
            {d.label}
            {d.installationYear ? ` · ${d.installationYear}` : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

const TYPE_LISIBLE = { maison: 'maison', appartement: 'appartement', immeuble: 'immeuble' };

export function DpeLogementCard({ record, entete = null, actions = null, onCreateEquipment }) {
  if (!record) return null;
  const expired = isDpeExpired(record);
  return (
    <div className="rounded-xl border border-secondary-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <DpeBadge letter={record.dpeLabel} />
          <span className="text-sm font-semibold text-secondary-900">
            {record.surface ? `${String(record.surface).replace('.', ',')} m²` : 'Surface inconnue'}
          </span>
          {record.buildingType && <span className="text-xs text-secondary-500">{TYPE_LISIBLE[record.buildingType] || record.buildingType}</span>}
          {record.year && <span className="text-xs text-secondary-500">· construit en {record.year}</span>}
          {!record.year && record.periodeConstruction && (
            <span className="text-xs text-secondary-500">· construit en {record.periodeConstruction}</span>
          )}
        </div>
        {record.distanceM > 0 && <span className="text-xs text-secondary-400 shrink-0">à {record.distanceM} m</span>}
      </div>

      {entete}

      <div className="space-y-1.5">
        <Line
          icon={Flame}
          label="Chauffage"
          value={record.heatingGenerator
            ? `${record.heatingGenerator}${record.heatingEnergy ? ` — ${record.heatingEnergy}` : ''}`
            : record.heatingEnergy}
        />
        <Line icon={Droplets} label="Eau chaude" value={record.ecsGenerator || record.ecsInstallation} />
        <Line icon={Snowflake} label="Froid" value={record.coolingPeriod} />
        <Line icon={Wind} label="Ventilation" value={record.ventilation} />
        <Line icon={Ruler} label="Conso" value={record.consoPerM2 ? `${Math.round(record.consoPerM2)} kWh/m²/an` : null} />
      </div>

      <EquipmentDrafts record={record} onCreate={onCreateEquipment} />
      <Pastilles
        titre="Isolation"
        items={[
          ['Murs', record.insulationWalls],
          ['Menuiseries', record.insulationWindows],
          ['Toiture', record.insulationRoof],
          ['Planchers', record.insulationFloor],
          ['Enveloppe', record.insulationEnvelope],
        ]}
      />
      <HeatLossBars record={record} />
      <CostBreakdown record={record} />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-secondary-100">
        {record.dpeDate ? (
          <span className="flex items-center gap-1.5 text-xs text-secondary-400">
            <CalendarClock className="w-3 h-3 shrink-0" />
            DPE du {formatDateShortFR(record.dpeDate)}
            {expired === true && <span className="text-amber-700 font-medium">· périmé</span>}
          </span>
        ) : <span />}
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}
