import { useState } from 'react';
import { Play, Trash2, Clock, CheckCircle2, XCircle, BarChart3 } from 'lucide-react';
import { formatDateTimeFR } from '@/lib/utils';
import { useKeywordLists, useBenchmarks, useDeleteBenchmark, useGeoGridQuota } from '@hooks/useGeoGrid';
import BenchmarkLauncher from './BenchmarkLauncher';
import BenchmarkResultTable from './BenchmarkResultTable';

function StatusBadge({ status, completed, total }) {
  if (status === 'running') {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-700 flex items-center gap-1">
        <Clock className="w-3 h-3 animate-pulse" />
        En cours · {completed}/{total}
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-700 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Terminé
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700 flex items-center gap-1">
        <XCircle className="w-3 h-3" />
        Échec
      </span>
    );
  }
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded bg-secondary-100 text-secondary-700">
      {status}
    </span>
  );
}

export default function BenchmarksPanel({ orgId }) {
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState(null);
  const [launcherOpen, setLauncherOpen] = useState(false);

  const { data: lists } = useKeywordLists(orgId);
  const { data: benchmarks, isLoading } = useBenchmarks(orgId);
  const { data: quota } = useGeoGridQuota(orgId);
  const deleteBenchmark = useDeleteBenchmark();

  const selectedBenchmark = benchmarks?.find((b) => b.id === selectedBenchmarkId);

  const handleDelete = async (id) => {
    if (!confirm('Supprimer ce benchmark et tous ses scans ?')) return;
    if (id === selectedBenchmarkId) setSelectedBenchmarkId(null);
    await deleteBenchmark.mutateAsync(id);
  };

  const hasAnyList = (lists?.length || 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-secondary-600">
          Un benchmark = un run d'une liste de keywords sur Gaillac et/ou Tarn. Lancement mensuel = thermomètre SEO.
        </p>
        <button
          onClick={() => setLauncherOpen(true)}
          disabled={!hasAnyList}
          title={!hasAnyList ? "Crée d'abord une liste de keywords dans l'onglet 'Listes'" : ''}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="w-4 h-4" />
          Lancer un benchmark
        </button>
      </div>

      {/* Historique des benchmarks */}
      {isLoading ? (
        <div className="bg-white rounded-lg border p-4">
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-secondary-100 rounded" />
            ))}
          </div>
        </div>
      ) : !benchmarks?.length ? (
        <div className="bg-white rounded-lg border p-8 text-center">
          <BarChart3 className="w-12 h-12 text-secondary-300 mx-auto mb-3" />
          <p className="text-sm text-secondary-500">
            Aucun benchmark exécuté. Lance le 1er pour créer une référence et mesurer dans le temps.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-secondary-50 text-secondary-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Liste</th>
                <th className="text-left px-3 py-2 font-medium">Mode</th>
                <th className="text-left px-3 py-2 font-medium">Lancé le</th>
                <th className="text-left px-3 py-2 font-medium">Statut</th>
                <th className="text-right px-3 py-2 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => setSelectedBenchmarkId(b.id === selectedBenchmarkId ? null : b.id)}
                  className={`cursor-pointer transition-colors border-b last:border-0 ${
                    b.id === selectedBenchmarkId ? 'bg-primary-50' : 'hover:bg-secondary-50'
                  }`}
                >
                  <td className="px-4 py-2 font-medium text-secondary-900">{b.list_name}</td>
                  <td className="px-3 py-2 text-secondary-600">
                    {b.scan_mode === 'grid' && '📍 Gaillac (grille)'}
                    {b.scan_mode === 'cities' && '🗺️ Tarn (communes)'}
                    {b.scan_mode === 'both' && '📍🗺️ Les deux'}
                  </td>
                  <td className="px-3 py-2 text-secondary-600">{formatDateTimeFR(b.started_at)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={b.status} completed={b.completed_keywords} total={b.total_keywords} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(b.id);
                      }}
                      className="p-1 rounded hover:bg-red-100 text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tableau de résultats du benchmark sélectionné */}
      {selectedBenchmark && (
        <BenchmarkResultTable benchmark={selectedBenchmark} />
      )}

      {/* Drawer de lancement */}
      {launcherOpen && (
        <BenchmarkLauncher
          orgId={orgId}
          lists={lists || []}
          quota={quota}
          onClose={() => setLauncherOpen(false)}
          onLaunched={(benchmarkId) => {
            setLauncherOpen(false);
            setSelectedBenchmarkId(benchmarkId);
          }}
        />
      )}
    </div>
  );
}
