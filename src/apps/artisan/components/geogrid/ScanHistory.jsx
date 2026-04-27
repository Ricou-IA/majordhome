import { Trash2, Eye, Clock } from 'lucide-react';
import { formatDateTimeFR } from '@/lib/utils';

function getRankColor(rank) {
  if (rank === null || rank === undefined) return 'bg-secondary-100 text-secondary-600';
  if (rank <= 3) return 'bg-green-100 text-green-700';
  if (rank <= 10) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

export default function ScanHistory({ scans, isLoading, selectedScanId, onSelect, onDelete }) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-secondary-900 mb-3">Historique des scans</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-secondary-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!scans?.length) {
    return (
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-secondary-900 mb-3">Historique</h3>
        <p className="text-sm text-secondary-500">Aucun scan effectué.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-secondary-900">Historique des scans</h3>
        <span className="text-xs text-secondary-500">{scans.length} scan{scans.length > 1 ? 's' : ''}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {scans.map((scan) => {
          const stats = scan.stats || {};
          const isSelected = scan.id === selectedScanId;

          return (
            <div
              key={scan.id}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                isSelected
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-secondary-200 hover:border-secondary-300 hover:bg-secondary-50'
              }`}
              onClick={() => onSelect(scan.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-secondary-900 truncate">
                      {scan.keyword}
                    </span>
                    {scan.scan_mode === 'cities' ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 whitespace-nowrap">
                        Tarn · {scan.total_points} villes
                      </span>
                    ) : (
                      <span className="text-xs text-secondary-400 whitespace-nowrap">
                        {scan.grid_size}x{scan.grid_size}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-secondary-500">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{formatDateTimeFR(scan.created_at)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(scan.id);
                    }}
                    className="p-1 rounded hover:bg-primary-100 text-primary-600"
                    title="Voir sur la carte"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(scan.id);
                    }}
                    className="p-1 rounded hover:bg-red-100 text-red-500"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 mt-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getRankColor(stats.top3 > 0 ? 1 : null)}`}>
                  Top3: {stats.top3 || 0}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getRankColor(stats.top10 > 0 ? 5 : null)}`}>
                  Top10: {stats.top10 || 0}
                </span>
                <span className="text-xs text-secondary-500 ml-auto truncate">
                  {stats.found || 0}/{stats.total || 0} trouvé
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
