import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Search,
  RefreshCw,
  ExternalLink,
  Unplug,
  Star,
  AlertCircle,
  Database,
  History,
  Loader2,
} from 'lucide-react';
import {
  useGscStatus,
  useGscMetrics,
  useGscConnect,
  useGscSync,
  useGscDisconnect,
} from '@hooks/useGsc';
import { useKeywordLists } from '@hooks/useGeoGrid';
import { formatDateTimeFR } from '@/lib/utils';

// ----------------------------------------------------------------------------
// Familles (recopie depuis BenchmarkResultTable pour rester consistent)
// ----------------------------------------------------------------------------
const FAMILY_BADGE = {
  'Poêle': 'bg-amber-100 text-amber-800 border-amber-200',
  'Ramonage': 'bg-purple-100 text-purple-800 border-purple-200',
  'Climatisation': 'bg-blue-100 text-blue-800 border-blue-200',
  'PAC': 'bg-green-100 text-green-800 border-green-200',
  'Chauffage': 'bg-red-100 text-red-800 border-red-200',
  'Entretien': 'bg-pink-100 text-pink-800 border-pink-200',
  'Autre': 'bg-secondary-100 text-secondary-700 border-secondary-200',
};

const FAMILY_DOT = {
  'Poêle': 'bg-amber-500',
  'Ramonage': 'bg-purple-500',
  'Climatisation': 'bg-blue-500',
  'PAC': 'bg-green-500',
  'Chauffage': 'bg-red-500',
  'Entretien': 'bg-pink-500',
  'Autre': 'bg-secondary-400',
};

const FAMILIES = ['Poêle', 'Ramonage', 'Climatisation', 'PAC', 'Chauffage', 'Entretien', 'Autre'];

function detectFamily(keyword) {
  const k = (keyword || '').toLowerCase();
  if (/ramon/.test(k)) return 'Ramonage';
  if (/poele|poêle|pellet|insert|granul|cheminée|cheminee/.test(k)) return 'Poêle';
  if (/entretien|maintenance|nettoyage/.test(k)) return 'Entretien';
  if (/clim/.test(k)) return 'Climatisation';
  if (/\bpac\b|pompe.{0,8}chaleur/.test(k)) return 'PAC';
  if (/chauf|chaud|plomb/.test(k)) return 'Chauffage';
  return 'Autre';
}

// ----------------------------------------------------------------------------
// Periodes
// ----------------------------------------------------------------------------
const PERIODS = [
  { id: '7d', label: '7 jours', days: 7 },
  { id: '30d', label: '30 jours', days: 30 },
  { id: '90d', label: '3 mois', days: 90 },
  { id: '365d', label: '12 mois', days: 365 },
];

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function rangeForPeriod(periodId) {
  const period = PERIODS.find((p) => p.id === periodId) ?? PERIODS[1];
  const today = new Date();
  const dateTo = isoDate(today);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - period.days);
  return { dateFrom: isoDate(start), dateTo };
}

const fmtInt = (n) =>
  Number.isFinite(n) ? new Intl.NumberFormat('fr-FR').format(Math.round(n)) : '—';
const fmtPct = (n) =>
  Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : '—';
const fmtPos = (n) => (Number.isFinite(n) ? n.toFixed(1) : '—');

// ----------------------------------------------------------------------------
// Etat non-connecte
// ----------------------------------------------------------------------------
function NotConnectedView({ orgId, onConnect, isConnecting }) {
  return (
    <div className="bg-white border border-secondary-200 rounded-lg p-8 text-center max-w-2xl mx-auto">
      <div className="inline-flex p-3 bg-primary-50 rounded-full mb-4">
        <Search className="w-8 h-8 text-primary-600" />
      </div>
      <h2 className="text-lg font-semibold text-secondary-900 mb-2">
        Connecte ton compte Google Search Console
      </h2>
      <p className="text-sm text-secondary-600 mb-6 max-w-md mx-auto">
        Recupere automatiquement les positions, impressions et clics de
        <span className="font-medium"> mayer-energie.fr</span> dans Google Search.
        Complementaire au scan GeoGrid (positions Maps).
      </p>

      <ul className="text-left text-sm text-secondary-600 space-y-2 mb-6 max-w-md mx-auto">
        <li className="flex gap-2">
          <span className="text-primary-600">•</span>
          <span>Authentification OAuth Google securisee</span>
        </li>
        <li className="flex gap-2">
          <span className="text-primary-600">•</span>
          <span>16 mois d&apos;historique synchronises a la premiere connexion</span>
        </li>
        <li className="flex gap-2">
          <span className="text-primary-600">•</span>
          <span>Croisement avec ta liste Mayer SEO 2026 pour suivi cible</span>
        </li>
      </ul>

      <button
        type="button"
        disabled={!orgId || isConnecting}
        onClick={() => onConnect({ orgId, returnTo: window.location.origin })}
        className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
      >
        {isConnecting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ExternalLink className="w-4 h-4" />
        )}
        Se connecter a Google Search Console
      </button>

      <p className="text-xs text-secondary-400 mt-4">
        Tu seras redirige vers Google pour autoriser l&apos;acces en lecture
        seule. Aucun acces en ecriture sur ton site.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Etat connecte — vue principale
// ----------------------------------------------------------------------------
function ConnectedView({ orgId, status }) {
  const [periodId, setPeriodId] = useState('30d');
  const [familyFilter, setFamilyFilter] = useState(null);
  const [showOnlyMayerList, setShowOnlyMayerList] = useState(false);

  const range = useMemo(() => rangeForPeriod(periodId), [periodId]);

  const { data: metrics = [], isLoading: metricsLoading } = useGscMetrics(orgId, range);
  const { data: keywordLists = [] } = useKeywordLists(orgId);

  const mayerList = useMemo(
    () => keywordLists.find((l) => l.name === 'Mayer SEO 2026'),
    [keywordLists],
  );
  const mayerKeywords = useMemo(
    () => (mayerList?.keywords ?? []).map((k) => (k || '').toLowerCase().trim()),
    [mayerList],
  );
  const mayerSet = useMemo(() => new Set(mayerKeywords), [mayerKeywords]);

  // Aggregation par query
  const aggregated = useMemo(() => {
    const map = new Map();
    for (const r of metrics) {
      const key = (r.query || '').toLowerCase().trim();
      if (!key) continue;
      const cur = map.get(key) || {
        query: r.query,
        impressions: 0,
        clicks: 0,
        positionWeighted: 0,
      };
      cur.impressions += r.impressions || 0;
      cur.clicks += r.clicks || 0;
      cur.positionWeighted += (r.avg_position || 0) * (r.impressions || 0);
      map.set(key, cur);
    }
    const rows = [...map.entries()].map(([key, r]) => ({
      key,
      query: r.query,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.impressions ? r.clicks / r.impressions : 0,
      avgPosition: r.impressions ? r.positionWeighted / r.impressions : 0,
      family: detectFamily(r.query),
      inMayerList: mayerSet.has(key),
    }));
    return rows;
  }, [metrics, mayerSet]);

  // KPIs globaux (calcules sur les data brutes pour eviter double agregation)
  const kpis = useMemo(() => {
    let imps = 0;
    let clicks = 0;
    let posWeighted = 0;
    for (const r of metrics) {
      imps += r.impressions || 0;
      clicks += r.clicks || 0;
      posWeighted += (r.avg_position || 0) * (r.impressions || 0);
    }
    return {
      impressions: imps,
      clicks,
      ctr: imps ? clicks / imps : 0,
      avgPosition: imps ? posWeighted / imps : 0,
      uniqueQueries: aggregated.length,
    };
  }, [metrics, aggregated.length]);

  // Lignes affichees apres filtres + tri
  const displayRows = useMemo(() => {
    let rows = aggregated.slice();
    if (familyFilter) rows = rows.filter((r) => r.family === familyFilter);
    if (showOnlyMayerList) rows = rows.filter((r) => r.inMayerList);
    rows.sort((a, b) => b.impressions - a.impressions);

    // Si toggle "Mayer uniquement" actif, on ajoute en bas les keywords de la
    // liste qui n'ont pas encore d'impressions
    if (showOnlyMayerList) {
      const present = new Set(rows.map((r) => r.key));
      const missing = mayerKeywords
        .filter((k) => !present.has(k))
        .map((k) => ({
          key: k,
          query: k,
          impressions: 0,
          clicks: 0,
          ctr: 0,
          avgPosition: 0,
          family: detectFamily(k),
          inMayerList: true,
          empty: true,
        }));
      rows = rows.concat(missing);
    }
    return rows;
  }, [aggregated, familyFilter, showOnlyMayerList, mayerKeywords]);

  return (
    <div className="space-y-4">
      <Header orgId={orgId} status={status} />
      <PeriodAndFilters
        periodId={periodId}
        setPeriodId={setPeriodId}
        familyFilter={familyFilter}
        setFamilyFilter={setFamilyFilter}
        showOnlyMayerList={showOnlyMayerList}
        setShowOnlyMayerList={setShowOnlyMayerList}
        mayerListKwCount={mayerKeywords.length}
      />
      <KpiCards kpis={kpis} />
      <MetricsTable
        rows={displayRows}
        loading={metricsLoading}
        totalRows={metrics.length}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Header
// ----------------------------------------------------------------------------
function Header({ orgId, status }) {
  const syncMutation = useGscSync();
  const disconnectMutation = useGscDisconnect();

  const lastSyncLabel = status?.lastSyncAt
    ? formatDateTimeFR(status.lastSyncAt)
    : 'jamais';

  return (
    <div className="bg-white border border-secondary-200 rounded-lg p-4 flex items-start justify-between gap-4 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Search className="w-4 h-4 text-primary-600" />
          <span className="text-sm font-semibold text-secondary-900">
            {status?.siteUrl ?? 'Site GSC inconnu'}
          </span>
          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
            Connecte
          </span>
        </div>
        <div className="text-xs text-secondary-500 flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <History className="w-3 h-3" />
            Derniere sync : {lastSyncLabel}
          </span>
          {status?.lastSyncRows > 0 && (
            <span className="inline-flex items-center gap-1">
              <Database className="w-3 h-3" />
              {fmtInt(status.lastSyncRows)} lignes
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => syncMutation.mutate({ orgId, monthsBack: 1 })}
          disabled={syncMutation.isPending}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm"
        >
          {syncMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Synchroniser
        </button>
        <button
          type="button"
          onClick={() => syncMutation.mutate({ orgId, monthsBack: 16 })}
          disabled={syncMutation.isPending}
          title="Re-importer 16 mois d'historique"
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-secondary-300 text-secondary-700 rounded-lg hover:bg-secondary-50 disabled:opacity-50 text-sm"
        >
          <History className="w-4 h-4" />
          Sync 16 mois
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm('Deconnecter Google Search Console ? Il faudra refaire le OAuth pour resynchroniser.')) {
              disconnectMutation.mutate(orgId);
            }
          }}
          disabled={disconnectMutation.isPending}
          title="Deconnecter GSC"
          className="inline-flex items-center gap-2 px-2 py-1.5 text-secondary-500 hover:text-red-600 disabled:opacity-50 text-sm"
        >
          <Unplug className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Selecteur de periode + filtres famille + toggle Mayer list
// ----------------------------------------------------------------------------
function PeriodAndFilters({
  periodId,
  setPeriodId,
  familyFilter,
  setFamilyFilter,
  showOnlyMayerList,
  setShowOnlyMayerList,
  mayerListKwCount,
}) {
  return (
    <div className="bg-white border border-secondary-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
      {/* Periode */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-secondary-500 mr-1">Periode :</span>
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriodId(p.id)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              periodId === p.id
                ? 'bg-primary-600 text-white'
                : 'bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-secondary-200" />

      {/* Familles */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-secondary-500 mr-1">Famille :</span>
        <button
          type="button"
          onClick={() => setFamilyFilter(null)}
          className={`px-2 py-1 rounded text-xs font-medium ${
            !familyFilter ? 'bg-secondary-800 text-white' : 'bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
          }`}
        >
          Toutes
        </button>
        {FAMILIES.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFamilyFilter(familyFilter === f ? null : f)}
            className={`px-2 py-1 rounded text-xs font-medium border ${
              familyFilter === f ? FAMILY_BADGE[f] : 'bg-white border-secondary-200 text-secondary-700 hover:bg-secondary-50'
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${FAMILY_DOT[f]}`} />
            {f}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-secondary-200" />

      {/* Toggle Mayer list */}
      <label className="inline-flex items-center gap-2 text-xs text-secondary-700 cursor-pointer">
        <input
          type="checkbox"
          checked={showOnlyMayerList}
          onChange={(e) => setShowOnlyMayerList(e.target.checked)}
          className="rounded border-secondary-300"
        />
        <Star className="w-3.5 h-3.5 text-amber-500" />
        Liste Mayer SEO 2026 uniquement
        <span className="text-secondary-400">({mayerListKwCount} kw)</span>
      </label>
    </div>
  );
}

// ----------------------------------------------------------------------------
// KPIs
// ----------------------------------------------------------------------------
function KpiCards({ kpis }) {
  const items = [
    { label: 'Impressions', value: fmtInt(kpis.impressions), color: 'text-blue-600' },
    { label: 'Clics', value: fmtInt(kpis.clicks), color: 'text-green-600' },
    { label: 'CTR moyen', value: fmtPct(kpis.ctr), color: 'text-purple-600' },
    { label: 'Position moy.', value: fmtPos(kpis.avgPosition), color: 'text-amber-600' },
    { label: 'Requetes uniques', value: fmtInt(kpis.uniqueQueries), color: 'text-secondary-700' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((it) => (
        <div key={it.label} className="bg-white border border-secondary-200 rounded-lg p-3">
          <div className="text-xs text-secondary-500 mb-1">{it.label}</div>
          <div className={`text-xl font-semibold tabular-nums ${it.color}`}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tableau metrics
// ----------------------------------------------------------------------------
function MetricsTable({ rows, loading, totalRows }) {
  if (loading) {
    return (
      <div className="bg-white border border-secondary-200 rounded-lg p-8 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary-600 mx-auto" />
        <p className="text-sm text-secondary-500 mt-2">Chargement des metrics GSC...</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-secondary-200 rounded-lg p-8 text-center">
        <AlertCircle className="w-6 h-6 text-secondary-400 mx-auto" />
        <p className="text-sm text-secondary-500 mt-2">
          Aucune donnee GSC pour cette periode. Lance une synchronisation si tu viens de te connecter.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-secondary-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-secondary-200 flex items-center justify-between text-xs text-secondary-500">
        <span>
          {rows.length} requete{rows.length > 1 ? 's' : ''} affichee{rows.length > 1 ? 's' : ''} ·{' '}
          {fmtInt(totalRows)} ligne{totalRows > 1 ? 's' : ''} brute{totalRows > 1 ? 's' : ''} en DB
        </span>
        <span>Tri : impressions decroissantes</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary-50 text-xs text-secondary-600 uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Requete</th>
              <th className="text-left px-2 py-2 font-medium">Famille</th>
              <th className="text-right px-2 py-2 font-medium">Impressions</th>
              <th className="text-right px-2 py-2 font-medium">Clics</th>
              <th className="text-right px-2 py-2 font-medium">CTR</th>
              <th className="text-right px-2 py-2 font-medium">Position moy.</th>
              <th className="text-center px-2 py-2 font-medium">Mayer SEO</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {rows.map((r) => (
              <tr
                key={r.key}
                className={`hover:bg-secondary-50 ${r.empty ? 'opacity-50 italic' : ''}`}
              >
                <td className="px-4 py-2 font-medium text-secondary-900">
                  {r.query}
                </td>
                <td className="px-2 py-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${FAMILY_BADGE[r.family]}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${FAMILY_DOT[r.family]}`} />
                    {r.family}
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.empty ? <span className="text-secondary-400">—</span> : fmtInt(r.impressions)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.empty ? <span className="text-secondary-400">—</span> : fmtInt(r.clicks)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.empty ? <span className="text-secondary-400">—</span> : fmtPct(r.ctr)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.empty ? <span className="text-secondary-400">—</span> : fmtPos(r.avgPosition)}
                </td>
                <td className="px-2 py-2 text-center">
                  {r.inMayerList ? (
                    <Star className="w-4 h-4 text-amber-500 fill-amber-400 inline" />
                  ) : (
                    <span className="text-secondary-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Composant principal
// ----------------------------------------------------------------------------
export default function GscPanel({ orgId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: status, isLoading: statusLoading } = useGscStatus(orgId);
  const connectMutation = useGscConnect();
  const syncMutation = useGscSync();
  const [pendingAutoSync, setPendingAutoSync] = useState(false);

  // 1) Detection retour OAuth ?gsc=connected : nettoie l'URL et leve le flag
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('gsc') === 'connected') {
      params.delete('gsc');
      const newSearch = params.toString();
      navigate({ pathname: location.pathname, search: newSearch }, { replace: true });
      toast.success('Search Console connecte. Synchronisation initiale 16 mois en cours...');
      setPendingAutoSync(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // 2) Quand le flag est leve ET orgId disponible, declenche la sync 16 mois.
  //    Decouple en 2 useEffect pour gerer la race condition au mount (orgId
  //    arrive parfois apres la detection de l'URL).
  useEffect(() => {
    if (pendingAutoSync && orgId) {
      setPendingAutoSync(false);
      syncMutation.mutate({ orgId, monthsBack: 16 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSync, orgId]);

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <NotConnectedView
        orgId={orgId}
        onConnect={connectMutation.mutate}
        isConnecting={connectMutation.isPending}
      />
    );
  }

  return <ConnectedView orgId={orgId} status={status} />;
}
