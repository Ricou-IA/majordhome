/**
 * ClientInvestigationPanel.jsx — Donnée bâtiment publique d'un client
 * ============================================================================
 * Panneau latéral ouvert par le bouton « Investiguer » de la fiche client.
 * Affiche les DPE trouvés à l'adresse (chauffage et son ancienneté, ECS, clim,
 * isolation, étiquette). Lecture seule, rien n'est écrit en base.
 *
 * Une adresse peut porter PLUSIEURS logements (immeuble) : on les liste tous,
 * on n'en élit aucun.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  X, Loader2, Flame, Droplets, Snowflake, Wind, Home, AlertCircle,
  RefreshCw, MapPin, Ruler, CalendarClock, ClipboardCheck, FileDown, Radius,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useClientInvestigation } from '@hooks/useClientInvestigation';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { logger } from '@/lib/logger';
import { telechargerSyntheseDpe } from './dpeSyntheseExport';
import { DpeNeighbourhoodMap } from './DpeNeighbourhoodMap';
import {
  isDpeExpired, toClientPatch, buildHeatLossBreakdown, buildCostBreakdown, assessMatch,
  NEARBY_RADII_M,
} from '@/lib/dpeApi';
import { formatDateShortFR, formatEuro } from '@/lib/utils';

/**
 * Échelle bleu → ambre, jamais rouge/vert (convention deutan du projet, cf.
 * Thermique R12 / Solaire). La lettre reste affichée : la couleur ne porte
 * jamais l'information seule.
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

function DpeBadge({ letter }) {
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

function InsulationRow({ record }) {
  const items = [
    ['Murs', record.insulationWalls],
    ['Menuiseries', record.insulationWindows],
    ['Toiture', record.insulationRoof],
    ['Enveloppe', record.insulationEnvelope],
  ].filter(([, v]) => v);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {items.map(([label, value]) => (
        <span
          key={label}
          className="px-2 py-0.5 text-xs rounded-md bg-secondary-50 border border-secondary-200 text-secondary-600"
        >
          {label} · <span className="font-medium text-secondary-800">{value}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Répartition des déperditions. Barres en ambre (palette deutan du projet), et
 * le pourcentage est TOUJOURS écrit : la largeur ne porte jamais l'information
 * seule. Largeur = part réelle, pas normalisée sur le poste le plus lourd,
 * pour qu'un 62 % se lise bien comme 62 % de la piste.
 */
function HeatLossBars({ record }) {
  const posts = buildHeatLossBreakdown(record);
  if (posts.length === 0) return null;

  return (
    <div className="pt-2.5 border-t border-secondary-100">
      <p className="text-xs font-medium text-secondary-500 mb-2">
        Où part la chaleur
        {record.ubat && (
          <span className="font-normal text-secondary-400"> · Ubat {record.ubat} W/m²·K</span>
        )}
      </p>
      <div className="space-y-1">
        {posts.map((p) => (
          <div key={p.key} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-xs text-secondary-600">{p.label}</span>
            <div className="flex-1 h-2 bg-secondary-100 rounded-full overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${p.share}%` }} />
            </div>
            <span className="w-9 shrink-0 text-right text-xs font-medium text-secondary-800">
              {Math.round(p.share)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ventilation du coût annuel par usage. */
function CostBreakdown({ record }) {
  const items = buildCostBreakdown(record);
  if (items.length === 0) return null;

  return (
    <div className="pt-2.5 border-t border-secondary-100">
      <p className="text-xs font-medium text-secondary-500 mb-1.5">
        Coût annuel
        {record.costs?.total && (
          <span className="text-secondary-800"> · {formatEuro(record.costs.total)}</span>
        )}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <span
            key={i.key}
            className="px-2 py-0.5 text-xs rounded-md bg-secondary-50 border border-secondary-200 text-secondary-600"
          >
            {i.label} · <span className="font-medium text-secondary-800">{formatEuro(i.euros)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Libellés des champs de la fiche que ce DPE peut renseigner. */
const PATCH_LABELS = { dpeNumber: 'n° DPE', surface: 'surface', housingType: 'type' };

function RecordCard({ record, onApply, onExport, exportingId, matchMode }) {
  const expired = isDpeExpired(record);
  const patch = toClientPatch(record);
  const fillable = Object.keys(patch);
  const isExporting = exportingId === record.id;
  const match = assessMatch(record, { matchMode });

  return (
    <div className="rounded-xl border border-secondary-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <DpeBadge letter={record.dpeLabel} />
          <span className="text-sm font-semibold text-secondary-900">
            {record.surface ? `${record.surface} m²` : 'Surface inconnue'}
          </span>
          {record.buildingType && (
            <span className="text-xs text-secondary-500">{record.buildingType}</span>
          )}
          {record.year && (
            <span className="text-xs text-secondary-500">· construit en {record.year}</span>
          )}
        </div>
        {record.distanceM > 0 && (
          <span className="text-xs text-secondary-400 shrink-0">à {record.distanceM} m</span>
        )}
      </div>

      {/* Adresse telle qu'écrite par le diagnostiqueur : c'est CE texte qu'il faut
          comparer à la fiche. L'ADEME rattache parfois « Impasse de Laborie » à
          « Impasse de la Borie » — deux rues différentes, même identifiant BAN. */}
      {record.rawAddress && (
        <p className="text-xs text-secondary-500 -mt-1">
          Adresse au diagnostic : <span className="text-secondary-700">{record.rawAddress}</span>
        </p>
      )}

      {match.level === 'a_verifier' && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Rattachement à vérifier — {match.reason}
          {Number.isFinite(record.banScore) && ` (indice ${record.banScore})`}.
          Comparez l’adresse ci-dessus à celle de la fiche avant d’exploiter ces données.
        </p>
      )}

      <div className="space-y-1.5">
        <Line
          icon={Flame}
          label="Chauffage"
          value={
            record.heatingGenerator
              ? `${record.heatingGenerator}${record.heatingEnergy ? ` — ${record.heatingEnergy}` : ''}`
              : record.heatingEnergy
          }
        />
        <Line icon={Droplets} label="Eau chaude" value={record.ecsGenerator || record.ecsInstallation} />
        <Line icon={Snowflake} label="Froid" value={record.coolingPeriod} />
        <Line icon={Wind} label="Ventilation" value={record.ventilation} />
        <Line
          icon={Ruler}
          label="Conso"
          value={record.consoPerM2 ? `${Math.round(record.consoPerM2)} kWh/m²/an` : null}
        />
      </div>

      <InsulationRow record={record} />
      <HeatLossBars record={record} />
      <CostBreakdown record={record} />

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-secondary-100">
        {record.dpeDate ? (
          <span className="flex items-center gap-1.5 text-xs text-secondary-400">
            <CalendarClock className="w-3 h-3 shrink-0" />
            DPE du {formatDateShortFR(record.dpeDate)}
            {expired === true && <span className="text-amber-700 font-medium">· périmé</span>}
          </span>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          {onExport && (
            <button
              onClick={() => onExport(record)}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-secondary-700 bg-secondary-100 hover:bg-secondary-200 rounded-lg transition-colors disabled:opacity-50"
              title="Générer le bilan énergétique à remettre au client (PDF brandé)"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5" />
              )}
              Synthèse client
            </button>
          )}
          {fillable.length > 0 && onApply && (
            <button
              onClick={() => onApply(patch)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
              title={`Renseigne ${fillable.map((k) => PATCH_LABELS[k]).join(', ')} dans la fiche`}
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              Renseigner la fiche
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="text-center py-10 px-4">
      <Icon className="w-8 h-8 mx-auto text-secondary-300" />
      <p className="mt-3 text-sm font-medium text-secondary-700">{title}</p>
      {/* <div> et non <p> : certains états y placent un bouton, et un <button>
          dans un <p> fait fermer le paragraphe par le navigateur. */}
      <div className="mt-1 text-sm text-secondary-500 max-w-sm mx-auto">{children}</div>
    </div>
  );
}

function Body({
  result, isLoading, hasAddress, onRetry, onApply, onExport, exportingId,
  onSearchNearby, nearbySearched, selectedId, onSelect, onStep,
  nearbyRadius, onRadiusChange,
}) {
  if (!hasAddress) {
    return (
      <EmptyState icon={MapPin} title="Pas d'adresse sur cette fiche">
        L'investigation part de l'adresse postale. Renseignez-la dans l'onglet
        Informations pour pouvoir interroger la donnée bâtiment.
      </EmptyState>
    );
  }

  if (isLoading && !result) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-secondary-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="mt-3 text-sm">Interrogation de la BAN puis du fichier DPE…</p>
      </div>
    );
  }

  if (!result) return null;

  if (result.status === 'error') {
    return (
      <EmptyState icon={AlertCircle} title="Service indisponible">
        Impossible d'interroger la donnée publique ({result.error}). Rien n'est
        cassé côté fiche client — réessayez dans un instant.
      </EmptyState>
    );
  }

  if (result.status === 'address_not_found') {
    return (
      <EmptyState icon={MapPin} title="Adresse non reconnue">
        La Base Adresse Nationale ne trouve pas cette adresse. Une orthographe
        approximative ou un lieu-dit suffit à la faire échouer.
      </EmptyState>
    );
  }

  if (result.status === 'no_dpe') {
    return (
      <EmptyState icon={Home} title="Aucun DPE à cette adresse">
        Ce n'est pas une erreur : un logement n'apparaît au fichier DPE que s'il
        en a fait établir un — vente, location ou audit. Environ un logement sur
        deux n'y figure pas.
        {onSearchNearby && !nearbySearched && (
          <>
            {/* Surtout PAS `onClick={onSearchNearby}` : React passerait
                l'événement en 1ᵉʳ argument, qui atterrissait dans le rayon —
                `geo_distance=lon,lat,[object Object]` → HTTP 400. */}
            <button
              onClick={() => onSearchNearby()}
              className="mt-4 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-secondary-700 bg-secondary-100 hover:bg-secondary-200 rounded-lg transition-colors"
            >
              <Radius className="w-4 h-4" />
              Chercher dans le voisinage
            </button>
            <span className="block mt-2 text-xs text-secondary-400">
              Les DPE trouvés seront ceux des logements alentour, pas celui de ce
              client. À n’utiliser que pour se faire une idée du bâti du secteur.
            </span>
          </>
        )}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      {result.matchMode === 'proximity' && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="font-semibold">Ce ne sont PAS les DPE de ce client.</span> Aucun
          diagnostic n’existe à son adresse ; voici ceux des logements alentour, pour se faire
          une idée du bâti du secteur. La carte de chaque fiche montre d’où vient le diagnostic.
        </p>
      )}
      {/* Voisinage : la carte porte la sélection. Plusieurs DPE peuvent exister
          dans le rayon — on ne devine pas lequel concerne le client, il le
          désigne sur la carte. En correspondance exacte, tous les logements
          sont à la même adresse : une carte n'apprendrait rien, on les liste. */}
      {result.matchMode === 'proximity' ? (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-secondary-500">Rayon de recherche</span>
            <div className="flex gap-1">
              {NEARBY_RADII_M.map((r) => (
                <button
                  key={r}
                  onClick={() => onRadiusChange(r)}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    r === nearbyRadius
                      ? 'bg-secondary-800 text-white'
                      : 'bg-secondary-100 text-secondary-600 hover:bg-secondary-200'
                  }`}
                >
                  {r} m
                </button>
              ))}
            </div>
          </div>

          <DpeNeighbourhoodMap
            records={result.records}
            clientPoint={result.ban}
            selectedId={selectedId}
            onSelect={onSelect}
          />

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-secondary-500">
              {result.total} diagnostic{result.total > 1 ? 's' : ''} dans {nearbyRadius} m
              {/* Troncature JAMAIS muette : sans ça, 12 sur 75 se lit « le secteur est vide ». */}
              {result.total > result.records.length && (
                <span className="text-amber-800">
                  {' '}— les {result.records.length} plus proches sont affichés
                </span>
              )}
            </p>

            {/* Navigation séquentielle : parcourir les diagnostics sans avoir à
                viser un repère sur la carte, qui elle ne bouge pas. */}
            {result.records.length > 1 && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onStep(-1)}
                  className="p-1 rounded-md text-secondary-500 hover:text-secondary-800 hover:bg-secondary-100 transition-colors"
                  title="Diagnostic précédent"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-secondary-600 tabular-nums">
                  repère{' '}
                  <span className="font-semibold text-secondary-800">
                    {result.records.findIndex((r) => r.id === selectedId) + 1}
                  </span>
                  {' / '}{result.records.length}
                </span>
                <button
                  onClick={() => onStep(1)}
                  className="p-1 rounded-md text-secondary-500 hover:text-secondary-800 hover:bg-secondary-100 transition-colors"
                  title="Diagnostic suivant"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          {result.records
            .filter((r) => r.id === selectedId)
            .map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                onApply={onApply}
                onExport={onExport}
                exportingId={exportingId}
                matchMode={result.matchMode}
              />
            ))}
        </>
      ) : (
        <>
          {result.records.length > 1 && (
            <p className="text-xs text-secondary-500">
              {result.records.length} logements à cette adresse
              {result.total > result.records.length && ` (sur ${result.total})`}.
            </p>
          )}
          {result.records.map((record, i) => (
            <RecordCard
              key={record.id || i}
              record={record}
              onApply={onApply}
              onExport={onExport}
              exportingId={exportingId}
              matchMode={result.matchMode}
            />
          ))}
        </>
      )}
      {/* Idem : `refetch` de React Query prend un objet d'options en 1ᵉʳ
          argument, on ne lui passe pas l'événement. */}
      <button
        onClick={() => onRetry()}
        className="inline-flex items-center gap-2 text-xs text-secondary-500 hover:text-secondary-700"
      >
        <RefreshCw className="w-3 h-3" />
        Rafraîchir
      </button>
    </div>
  );
}

export function ClientInvestigationPanel({ client, isOpen, onClose, onApply }) {
  const {
    result, isLoading, hasAddress, refetch, tally,
    includeNearby, searchNearby, nearbyRadius, setNearbyRadius,
  } = useClientInvestigation(client, { enabled: isOpen });
  const { settings } = useOrgSettings();
  const [exportingId, setExportingId] = useState(null);
  const [pickedId, setPickedId] = useState(null);

  // À défaut de choix explicite sur la carte, le plus proche fait foi.
  const records = result?.records ?? [];
  const selectedId = records.some((r) => r.id === pickedId) ? pickedId : records[0]?.id ?? null;

  // Navigation séquentielle, circulaire : arrivé au dernier, on repart au premier.
  const step = (delta) => {
    if (records.length === 0) return;
    const i = records.findIndex((r) => r.id === selectedId);
    const next = (i + delta + records.length) % records.length;
    setPickedId(records[next].id);
  };

  const handleExport = async (record) => {
    setExportingId(record.id);
    try {
      await telechargerSyntheseDpe({ record, client, settings });
    } catch (err) {
      logger.error('[investigation] génération de la synthèse impossible', err);
      toast.error('Impossible de générer la synthèse');
    } finally {
      setExportingId(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />

      <aside className="fixed right-0 top-0 bottom-0 z-[61] w-full max-w-lg bg-secondary-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <header className="px-5 py-4 bg-white border-b border-secondary-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-secondary-900">Investigation bâtiment</h2>
              <p className="mt-0.5 text-sm text-secondary-500 truncate">
                {result?.ban?.label || [client?.address, client?.postal_code, client?.city].filter(Boolean).join(' ') || '—'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100 transition-colors shrink-0"
              title="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {result?.lowConfidence && (
            <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              Adresse géocodée avec un faible niveau de confiance — le rattachement peut être faux.
            </p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Body
            result={result}
            isLoading={isLoading}
            hasAddress={hasAddress}
            onRetry={refetch}
            onApply={onApply}
            onExport={handleExport}
            exportingId={exportingId}
            onSearchNearby={searchNearby}
            nearbySearched={includeNearby}
            selectedId={selectedId}
            onSelect={setPickedId}
            onStep={step}
            nearbyRadius={nearbyRadius}
            onRadiusChange={setNearbyRadius}
          />
        </div>

        <footer className="px-5 py-3 bg-white border-t border-secondary-200 text-xs text-secondary-500 flex items-center justify-between gap-3">
          <span>Sources : BAN · fichier DPE ADEME</span>
          {tally.total > 0 && (
            <span title="Adresses investiguées depuis l'ouverture de l'onglet — sert à décider si on généralise">
              Taux de réponse{' '}
              <span className="font-semibold text-secondary-700">
                {tally.withData}/{tally.total}
              </span>
            </span>
          )}
        </footer>
      </aside>
    </>
  );
}
