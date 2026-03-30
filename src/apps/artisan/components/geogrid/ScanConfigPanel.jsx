import { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';

const DEFAULT_CONFIG = {
  businessName: 'Mayer Energie',
  placeId: '',
  keyword: 'climatisation',
  centerLat: 43.9016,
  centerLng: 1.8976,
  radiusKm: 5,
  gridSize: 7,
  searchRadiusM: 1000,
};

export default function ScanConfigPanel({ onLaunch, isScanning }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  const handleChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onLaunch({
      ...config,
      centerLat: parseFloat(config.centerLat),
      centerLng: parseFloat(config.centerLng),
      radiusKm: parseFloat(config.radiusKm),
      gridSize: parseInt(config.gridSize),
      searchRadiusM: parseInt(config.searchRadiusM),
    });
  };

  const totalPoints = config.gridSize * config.gridSize;

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-4 space-y-4">
      <h3 className="font-semibold text-secondary-900">Configuration du scan</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">
            Nom de l'établissement
          </label>
          <input
            type="text"
            value={config.businessName}
            onChange={(e) => handleChange('businessName', e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">
            Place ID <span className="text-secondary-400">(optionnel)</span>
          </label>
          <input
            type="text"
            value={config.placeId}
            onChange={(e) => handleChange('placeId', e.target.value)}
            placeholder="ChIJ..."
            className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1">
          Mot-clé de recherche
        </label>
        <input
          type="text"
          value={config.keyword}
          onChange={(e) => handleChange('keyword', e.target.value)}
          placeholder="ex: climatisation, plombier, chauffagiste..."
          className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">Latitude centre</label>
          <input
            type="number"
            step="any"
            value={config.centerLat}
            onChange={(e) => handleChange('centerLat', e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">Longitude centre</label>
          <input
            type="number"
            step="any"
            value={config.centerLng}
            onChange={(e) => handleChange('centerLng', e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">Rayon (km)</label>
          <input
            type="number"
            min="1"
            max="50"
            value={config.radiusKm}
            onChange={(e) => handleChange('radiusKm', e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">Grille (NxN)</label>
          <select
            value={config.gridSize}
            onChange={(e) => handleChange('gridSize', e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value={5}>5x5 (25 pts)</option>
            <option value={7}>7x7 (49 pts)</option>
            <option value={9}>9x9 (81 pts)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-600 mb-1">Rayon recherche (m)</label>
          <input
            type="number"
            min="500"
            max="5000"
            step="100"
            value={config.searchRadiusM}
            onChange={(e) => handleChange('searchRadiusM', e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-secondary-500">
          {totalPoints} points — ~{Math.ceil(totalPoints * 0.3)}s de scan
        </span>
        <button
          type="submit"
          disabled={isScanning}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isScanning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Scan en cours...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Lancer le scan
            </>
          )}
        </button>
      </div>
    </form>
  );
}
