import { useMemo, useState } from 'react';
import { Loader2, Eye } from 'lucide-react';
import { useBenchmarkScans } from '@hooks/useGeoGrid';

const FAMILY_COLORS = {
  'Poêle': 'bg-amber-100 text-amber-800 border-amber-200',
  'Ramonage': 'bg-purple-100 text-purple-800 border-purple-200',
  'Climatisation': 'bg-blue-100 text-blue-800 border-blue-200',
  'PAC': 'bg-green-100 text-green-800 border-green-200',
  'Chauffage': 'bg-red-100 text-red-800 border-red-200',
  'Entretien': 'bg-pink-100 text-pink-800 border-pink-200',
  'Autre': 'bg-secondary-100 text-secondary-800 border-secondary-200',
};

const FAMILY_BADGE_COLORS = {
  'Poêle': 'bg-amber-500',
  'Ramonage': 'bg-purple-500',
  'Climatisation': 'bg-blue-500',
  'PAC': 'bg-green-500',
  'Chauffage': 'bg-red-500',
  'Entretien': 'bg-pink-500',
  'Autre': 'bg-secondary-500',
};

function detectFamily(keyword) {
  const k = keyword.toLowerCase();
  if (/ramon/.test(k)) return 'Ramonage';
  if (/poele|pellet|insert|granul|cheminée|cheminee/.test(k)) return 'Poêle';
  if (/entretien|maintenance|nettoyage/.test(k)) return 'Entretien';
  if (/clim/.test(k)) return 'Climatisation';
  // PAC : matche "pac" isolé OU "pompe ... chaleur" avec jusqu'à 8 chars entre (couvre "pompe a chaleur", "pompe à chaleur", "pompe de chaleur" etc.)
  if (/\bpac\b|pompe.{0,8}chaleur/.test(k)) return 'PAC';
  if (/chauf|chaud|plomb/.test(k)) return 'Chauffage';
  return 'Autre';
}

function PositionCell({ value, total, threshold = 50 }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  // Couleur du % selon performance : vert ≥50%, ambre 1-49%, gris 0%
  const pctColor = pct === 0
    ? 'text-secondary-300'
    : pct >= threshold
      ? 'text-green-600 font-semibold'
      : 'text-amber-600 font-medium';
  return (
    <div className="flex items-baseline gap-2 tabular-nums">
      <span className="font-medium text-secondary-900 w-12 text-right">{value}<span className="text-secondary-400 text-xs">/{total}</span></span>
      <span className={`text-xs w-10 text-right ${pctColor}`}>{pct}%</span>
    </div>
  );
}

function MiniBar({ pct, color }) {
  return (
    <div className="h-1.5 bg-secondary-100 rounded-full overflow-hidden mt-1">
      <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function BenchmarkResultTable({ benchmark }) {
  const [groupBy, setGroupBy] = useState('family');
  const [sortBy, setSortBy] = useState('found');
  const [selectedFamily, setSelectedFamily] = useState(null);

  const { data: scans, isLoading } = useBenchmarkScans(benchmark.id);

  const enrichedScans = useMemo(() => {
    if (!scans) return [];
    const enriched = scans.map((s) => ({
      ...s,
      family: detectFamily(s.keyword),
      stats: s.stats || {},
    }));
    enriched.sort((a, b) => {
      if (sortBy === 'keyword') return a.keyword.localeCompare(b.keyword);
      const aVal = a.stats[sortBy] || 0;
      const bVal = b.stats[sortBy] || 0;
      return bVal - aVal;
    });
    return enriched;
  }, [scans, sortBy]);

  const groupedScans = useMemo(() => {
    if (groupBy === 'none') {
      // Pas de groupement : on filtre quand même selon la famille sélectionnée
      const list = selectedFamily
        ? enrichedScans.filter((s) => s.family === selectedFamily)
        : enrichedScans;
      return { 'Tous': list };
    }
    const groups = {};
    const order = ['Poêle', 'Ramonage', 'Climatisation', 'PAC', 'Chauffage', 'Entretien', 'Autre'];
    enrichedScans.forEach((s) => {
      if (selectedFamily && s.family !== selectedFamily) return;
      if (!groups[s.family]) groups[s.family] = [];
      groups[s.family].push(s);
    });
    const sortedGroups = {};
    order.forEach((f) => { if (groups[f]) sortedGroups[f] = groups[f]; });
    Object.keys(groups).forEach((f) => { if (!sortedGroups[f]) sortedGroups[f] = groups[f]; });
    return sortedGroups;
  }, [enrichedScans, groupBy, selectedFamily]);

  // Synthèse par famille avec 2 métriques
  const summary = useMemo(() => {
    const byFamily = {};
    enrichedScans.forEach((s) => {
      if (!byFamily[s.family]) byFamily[s.family] = {
        count: 0,
        top3Sum: 0, top10Sum: 0, foundSum: 0, totalSum: 0,
        keywordsInTop10: 0, keywordsInTop3: 0,
      };
      const f = byFamily[s.family];
      f.count += 1;
      f.top3Sum += s.stats.top3 || 0;
      f.top10Sum += s.stats.top10 || 0;
      f.foundSum += s.stats.found || 0;
      f.totalSum += s.stats.total || 0;
      if ((s.stats.top10 || 0) > 0) f.keywordsInTop10 += 1;
      if ((s.stats.top3 || 0) > 0) f.keywordsInTop3 += 1;
    });
    return byFamily;
  }, [enrichedScans]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!enrichedScans.length) {
    return (
      <div className="bg-white rounded-lg border p-6 text-center text-sm text-secondary-500">
        Aucun scan terminé pour ce benchmark.
        {benchmark.status === 'running' && ' Le run est en cours, attends qu\'il se termine.'}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-secondary-900">Résultats du benchmark</h3>
          <p className="text-xs text-secondary-500 mt-0.5">{benchmark.list_name} · {enrichedScans.length} keywords scannés</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-xs px-2 py-1 border rounded"
          >
            <option value="found">Trier par trouvé</option>
            <option value="top10">Trier par top 10</option>
            <option value="top3">Trier par top 3</option>
            <option value="keyword">Trier par mot-clé</option>
          </select>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="text-xs px-2 py-1 border rounded"
          >
            <option value="family">Grouper par famille</option>
            <option value="none">Tout afficher</option>
          </select>
        </div>
      </div>

      {/* Cards synthèse par famille — toutes sur 1 ligne, cliquables pour filtrer */}
      {groupBy === 'family' && Object.keys(summary).length > 0 && (
        <div className="flex gap-2">
          {Object.entries(summary).map(([family, stats]) => {
            const top10Pct = stats.count ? Math.round((stats.keywordsInTop10 / stats.count) * 100) : 0;
            const coveragePct = stats.totalSum ? Math.round((stats.foundSum / stats.totalSum) * 100) : 0;
            const isSelected = selectedFamily === family;
            const isDimmed = selectedFamily !== null && !isSelected;
            return (
              <button
                key={family}
                onClick={() => setSelectedFamily(isSelected ? null : family)}
                className={`flex-1 min-w-0 text-left rounded-lg p-2.5 border transition-all ${
                  FAMILY_COLORS[family] || FAMILY_COLORS.Autre
                } ${
                  isSelected ? 'ring-2 ring-secondary-900 shadow-md' : 'hover:shadow-sm hover:scale-[1.01]'
                } ${
                  isDimmed ? 'opacity-40' : ''
                }`}
                title={isSelected ? 'Cliquer pour désélectionner' : `Filtrer sur ${family}`}
              >
                <div className="text-[11px] font-bold uppercase tracking-wide truncate">{family}</div>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-xl font-bold tabular-nums leading-none">{stats.keywordsInTop10}</span>
                  <span className="text-[10px] opacity-75">/{stats.count}</span>
                  <span className="text-[9px] opacity-60 ml-auto">top10</span>
                </div>
                <MiniBar pct={top10Pct} color={FAMILY_BADGE_COLORS[family] || FAMILY_BADGE_COLORS.Autre} />
                <div className="mt-1.5 text-[10px] opacity-75 flex items-center gap-1">
                  <span className="tabular-nums font-medium">{coveragePct}%</span>
                  <span className="truncate">couverture géo</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Indicateur de filtre actif */}
      {selectedFamily && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-secondary-600">Filtre actif :</span>
          <span className={`font-semibold px-2 py-0.5 rounded border ${FAMILY_COLORS[selectedFamily] || FAMILY_COLORS.Autre}`}>
            {selectedFamily}
          </span>
          <button
            onClick={() => setSelectedFamily(null)}
            className="text-primary-600 hover:text-primary-700 underline"
          >
            voir tout
          </button>
        </div>
      )}

      {/* Tableaux par famille */}
      <div className="space-y-4">
        {Object.entries(groupedScans).map(([family, items]) => (
          <div key={family} className="space-y-1">
            {groupBy === 'family' && (
              <div className="flex items-center gap-2 pt-1">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${FAMILY_COLORS[family] || FAMILY_COLORS.Autre}`}>
                  {family}
                </span>
                <span className="text-xs text-secondary-400">{items.length} keyword{items.length > 1 ? 's' : ''}</span>
              </div>
            )}
            <div className="overflow-hidden rounded border border-secondary-200">
              <table className="w-full text-sm">
                <thead className="bg-secondary-50 text-secondary-600 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Keyword</th>
                    {groupBy === 'none' && (
                      <th className="text-left px-3 py-2 font-medium w-32">Famille</th>
                    )}
                    <th className="text-left px-3 py-2 font-medium w-32" title="Nb de points où Mayer ressort en position 1-3">
                      <div>Top 3</div>
                      <div className="text-[10px] font-normal opacity-60 normal-case">points / % couvert</div>
                    </th>
                    <th className="text-left px-3 py-2 font-medium w-32" title="Nb de points où Mayer ressort dans les 10 premiers résultats">
                      <div>Top 10</div>
                      <div className="text-[10px] font-normal opacity-60 normal-case">points / % couvert</div>
                    </th>
                    <th className="text-left px-3 py-2 font-medium w-32" title="Nb de points où Mayer apparaît dans les 20 premiers résultats Google Maps">
                      <div>Visibilité totale</div>
                      <div className="text-[10px] font-normal opacity-60 normal-case">trouvé sur 25 / % couvert</div>
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr key={s.id} className="border-t border-secondary-100 hover:bg-secondary-50/60">
                      <td className="px-3 py-2 font-mono text-xs text-secondary-900">{s.keyword}</td>
                      {groupBy === 'none' && (
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${FAMILY_COLORS[s.family] || FAMILY_COLORS.Autre}`}>
                            {s.family}
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-2 w-32">
                        <PositionCell value={s.stats.top3 || 0} total={s.stats.total} threshold={20} />
                      </td>
                      <td className="px-3 py-2 w-32">
                        <PositionCell value={s.stats.top10 || 0} total={s.stats.total} threshold={50} />
                      </td>
                      <td className="px-3 py-2 w-32">
                        <PositionCell value={s.stats.found || 0} total={s.stats.total} threshold={70} />
                      </td>
                      <td className="px-3 py-2 w-10 text-right">
                        <button
                          className="p-1 rounded hover:bg-primary-100 text-primary-600"
                          title="Voir le scan détaillé (à venir)"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
