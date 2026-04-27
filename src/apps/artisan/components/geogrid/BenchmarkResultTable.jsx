import { useMemo, useState } from 'react';
import { Loader2, Eye } from 'lucide-react';
import { useBenchmarkScans } from '@hooks/useGeoGrid';
import { Link } from 'react-router-dom';

const FAMILY_COLORS = {
  'Poêle': 'bg-amber-100 text-amber-700',
  'Ramonage': 'bg-purple-100 text-purple-700',
  'Climatisation': 'bg-blue-100 text-blue-700',
  'PAC': 'bg-green-100 text-green-700',
  'Chauffage': 'bg-red-100 text-red-700',
  'Entretien': 'bg-pink-100 text-pink-700',
  'Autre': 'bg-secondary-100 text-secondary-700',
};

function detectFamily(keyword) {
  const k = keyword.toLowerCase();
  if (/ramon/.test(k)) return 'Ramonage';
  if (/poele|pellet|insert|granul|cheminée|cheminee/.test(k)) return 'Poêle';
  if (/entretien|maintenance|nettoyage/.test(k)) return 'Entretien';
  if (/clim/.test(k)) return 'Climatisation';
  if (/pac|pompe.{0,2}chaleur/.test(k)) return 'PAC';
  if (/chauf|chaud|plomb/.test(k)) return 'Chauffage';
  return 'Autre';
}

function PositionBadge({ value, label, total, color }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-1">
      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
        {value}/{total}
      </span>
      <span className="text-[10px] text-secondary-400">{pct}%</span>
    </div>
  );
}

export default function BenchmarkResultTable({ benchmark }) {
  const [groupBy, setGroupBy] = useState('family'); // 'family' | 'none'
  const [sortBy, setSortBy] = useState('found'); // 'found' | 'top10' | 'top3' | 'keyword'

  const { data: scans, isLoading } = useBenchmarkScans(benchmark.id);

  // Enrichis les scans avec famille + tri
  const enrichedScans = useMemo(() => {
    if (!scans) return [];
    const enriched = scans.map((s) => ({
      ...s,
      family: detectFamily(s.keyword),
      stats: s.stats || {},
    }));

    // Tri
    enriched.sort((a, b) => {
      if (sortBy === 'keyword') return a.keyword.localeCompare(b.keyword);
      const aVal = a.stats[sortBy] || 0;
      const bVal = b.stats[sortBy] || 0;
      return bVal - aVal;
    });

    return enriched;
  }, [scans, sortBy]);

  // Group by family
  const groupedScans = useMemo(() => {
    if (groupBy === 'none') return { 'Tous': enrichedScans };
    const groups = {};
    enrichedScans.forEach((s) => {
      if (!groups[s.family]) groups[s.family] = [];
      groups[s.family].push(s);
    });
    return groups;
  }, [enrichedScans, groupBy]);

  // Synthèse globale
  const summary = useMemo(() => {
    if (!enrichedScans.length) return null;
    const total = enrichedScans.reduce((acc, s) => {
      acc.top3 += s.stats.top3 || 0;
      acc.top10 += s.stats.top10 || 0;
      acc.found += s.stats.found || 0;
      acc.total += s.stats.total || 0;
      return acc;
    }, { top3: 0, top10: 0, found: 0, total: 0 });

    // Synthèse par famille
    const byFamily = {};
    enrichedScans.forEach((s) => {
      if (!byFamily[s.family]) byFamily[s.family] = { count: 0, top3: 0, top10: 0, found: 0, total: 0 };
      const f = byFamily[s.family];
      f.count += 1;
      f.top3 += s.stats.top3 || 0;
      f.top10 += s.stats.top10 || 0;
      f.found += s.stats.found || 0;
      f.total += s.stats.total || 0;
    });

    return { total, byFamily };
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
    <div className="bg-white rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
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
            <option value="none">Pas de groupement</option>
          </select>
        </div>
      </div>

      {/* Synthèse cards par famille */}
      {summary && groupBy === 'family' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {Object.entries(summary.byFamily).map(([family, stats]) => {
            const visiblePct = stats.total ? Math.round((stats.found / stats.total) * 100) : 0;
            return (
              <div key={family} className={`rounded p-2 ${FAMILY_COLORS[family] || FAMILY_COLORS.Autre}`}>
                <div className="text-xs font-semibold">{family}</div>
                <div className="text-2xl font-bold">{visiblePct}%</div>
                <div className="text-[10px] opacity-75">visibilité ({stats.count} kw)</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tableau */}
      {Object.entries(groupedScans).map(([family, items]) => (
        <div key={family} className="space-y-1">
          {groupBy === 'family' && (
            <div className="flex items-center gap-2 mt-3">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${FAMILY_COLORS[family] || FAMILY_COLORS.Autre}`}>
                {family}
              </span>
              <span className="text-xs text-secondary-400">{items.length} keywords</span>
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="border-b bg-secondary-50 text-secondary-700 text-xs">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Keyword</th>
                {groupBy === 'none' && <th className="text-left px-3 py-2 font-medium">Famille</th>}
                <th className="text-left px-3 py-2 font-medium">Top 3</th>
                <th className="text-left px-3 py-2 font-medium">Top 10</th>
                <th className="text-left px-3 py-2 font-medium">Trouvé</th>
                <th className="text-right px-3 py-2 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-secondary-50">
                  <td className="px-3 py-2 font-mono text-xs text-secondary-900">{s.keyword}</td>
                  {groupBy === 'none' && (
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${FAMILY_COLORS[s.family] || FAMILY_COLORS.Autre}`}>
                        {s.family}
                      </span>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <PositionBadge value={s.stats.top3 || 0} total={s.stats.total} color="bg-green-100 text-green-700" />
                  </td>
                  <td className="px-3 py-2">
                    <PositionBadge value={s.stats.top10 || 0} total={s.stats.total} color="bg-amber-100 text-amber-700" />
                  </td>
                  <td className="px-3 py-2">
                    <PositionBadge value={s.stats.found || 0} total={s.stats.total} color="bg-blue-100 text-blue-700" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to="#"
                      onClick={(e) => {
                        e.preventDefault();
                        // TODO Phase 2: ouvrir scan détail dans modal/onglet "Scan unique"
                      }}
                      className="p-1 rounded hover:bg-primary-100 text-primary-600 inline-block"
                      title="Voir le scan détaillé"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
