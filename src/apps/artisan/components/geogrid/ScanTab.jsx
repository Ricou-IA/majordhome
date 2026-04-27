import { useState } from 'react';
import { useGeoGridScans, useGeoGridResults, useLaunchScan, useDeleteScan } from '@hooks/useGeoGrid';
import GeoGridMap from './GeoGridMap';
import ScanConfigPanel from './ScanConfigPanel';
import ScanHistory from './ScanHistory';

export default function ScanTab({ orgId }) {
  const [selectedScanId, setSelectedScanId] = useState(null);

  const { data: scans, isLoading: scansLoading } = useGeoGridScans(orgId);
  const { data: results } = useGeoGridResults(selectedScanId);
  const launchScan = useLaunchScan();
  const deleteScan = useDeleteScan();

  // Filtre l'historique pour n'afficher QUE les scans manuels (pas ceux d'un benchmark)
  const manualScans = scans?.filter((s) => !s.benchmark_id) || [];

  const selectedScan = scans?.find((s) => s.id === selectedScanId);
  const stats = selectedScan?.stats || {};

  const handleLaunch = (config) => {
    launchScan.mutate(
      { ...config, orgId },
      {
        onSuccess: (result) => {
          if (result.data?.scanId) {
            setSelectedScanId(result.data.scanId);
          }
        },
      }
    );
  };

  const handleDelete = (scanId) => {
    if (scanId === selectedScanId) setSelectedScanId(null);
    deleteScan.mutate(scanId);
  };

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {selectedScan && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Top 3', value: stats.top3 || 0, total: stats.total, color: 'text-green-600 bg-green-50' },
            { label: 'Top 10', value: stats.top10 || 0, total: stats.total, color: 'text-amber-600 bg-amber-50' },
            { label: 'Trouvé', value: stats.found || 0, total: stats.total, color: 'text-blue-600 bg-blue-50' },
            { label: 'Absent', value: stats.absent || 0, total: stats.total, color: 'text-red-600 bg-red-50' },
          ].map(({ label, value, total, color }) => (
            <div key={label} className={`rounded-lg p-3 ${color}`}>
              <div className="text-2xl font-bold">{value}<span className="text-sm font-normal opacity-60">/{total}</span></div>
              <div className="text-xs font-medium">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sidebar config + Map */}
      <div className="flex gap-4">
        <div className="w-80 flex-shrink-0">
          <ScanConfigPanel onLaunch={handleLaunch} isScanning={launchScan.isPending} orgId={orgId} />
        </div>

        <div className="flex-1">
          <GeoGridMap
            results={results}
            centerLat={selectedScan?.center_lat || 43.9016}
            centerLng={selectedScan?.center_lng || 1.8976}
            scanMode={selectedScan?.scan_mode || 'grid'}
            isLoading={launchScan.isPending}
          />
        </div>
      </div>

      {/* Historique pleine largeur */}
      <ScanHistory
        scans={manualScans}
        isLoading={scansLoading}
        selectedScanId={selectedScanId}
        onSelect={setSelectedScanId}
        onDelete={handleDelete}
      />
    </div>
  );
}
