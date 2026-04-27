import { useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useGeoGridScans, useGeoGridResults, useLaunchScan, useDeleteScan } from '@hooks/useGeoGrid';
import GeoGridMap from '../components/geogrid/GeoGridMap';
import ScanConfigPanel from '../components/geogrid/ScanConfigPanel';
import ScanHistory from '../components/geogrid/ScanHistory';

export default function GeoGrid() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const [selectedScanId, setSelectedScanId] = useState(null);

  const { data: scans, isLoading: scansLoading } = useGeoGridScans(orgId);
  const { data: results } = useGeoGridResults(selectedScanId);
  const launchScan = useLaunchScan();
  const deleteScan = useDeleteScan();

  // Récupère les infos du scan sélectionné pour centrer la carte
  const selectedScan = scans?.find((s) => s.id === selectedScanId);

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

  // Stats du scan courant
  const stats = selectedScan?.stats || {};

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-100 rounded-lg">
          <Grid3x3 className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-secondary-900">GeoGrid Rank Tracker</h1>
          <p className="text-sm text-secondary-500">
            Visualisez votre classement Google Maps sur une grille géographique
          </p>
        </div>
      </div>

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

      {/* Main layout: sidebar config + map */}
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

      {/* Historique des scans en pleine largeur */}
      <ScanHistory
        scans={scans}
        isLoading={scansLoading}
        selectedScanId={selectedScanId}
        onSelect={setSelectedScanId}
        onDelete={handleDelete}
      />
    </div>
  );
}
