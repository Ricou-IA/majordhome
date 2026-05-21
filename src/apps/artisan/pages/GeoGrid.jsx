import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Grid3x3, Search, ListChecks, BarChart3, Globe } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import ScanTab from '../components/geogrid/ScanTab';
import KeywordListsPanel from '../components/geogrid/KeywordListsPanel';
import BenchmarksPanel from '../components/geogrid/BenchmarksPanel';
import GscPanel from '../components/geogrid/GscPanel';

const TABS = [
  { id: 'scan', label: 'Scan unique', icon: Search },
  { id: 'lists', label: 'Listes de keywords', icon: ListChecks },
  { id: 'benchmarks', label: 'Benchmarks', icon: BarChart3 },
  { id: 'gsc', label: 'Search Console', icon: Globe },
];

export default function GeoGrid() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const location = useLocation();
  // Auto-selection de l'onglet Search Console au retour OAuth (?gsc=connected)
  const initialTab = new URLSearchParams(location.search).get('gsc') ? 'gsc' : 'scan';
  const [activeTab, setActiveTab] = useState(initialTab);

  // P0.20 — sous-titre paramétré par org (fallback générique)
  const brandName = organization?.settings?.brand_name || organization?.name || '';
  const territoryLabel = organization?.settings?.geogrid_territory_label || ''; // ex "le Tarn", "la Loire-Atlantique"
  const subtitle = brandName && territoryLabel
    ? `Mesurez la visibilité Google Maps de ${brandName} sur ${territoryLabel}`
    : brandName
      ? `Mesurez la visibilité Google Maps de ${brandName}`
      : 'Mesurez votre visibilité Google Maps';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-100 rounded-lg">
          <Grid3x3 className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-secondary-900">GeoGrid Rank Tracker</h1>
          <p className="text-sm text-secondary-500">{subtitle}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-secondary-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-primary-500 text-primary-700'
                : 'border-transparent text-secondary-600 hover:text-secondary-900'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'scan' && <ScanTab orgId={orgId} />}
      {activeTab === 'lists' && <KeywordListsPanel orgId={orgId} />}
      {activeTab === 'benchmarks' && <BenchmarksPanel orgId={orgId} />}
      {activeTab === 'gsc' && <GscPanel orgId={orgId} />}
    </div>
  );
}
