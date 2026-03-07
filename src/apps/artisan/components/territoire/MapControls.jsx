/**
 * MapControls.jsx
 * Panneau de contrôle flottant pour filtrer les points CRM et zones
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, RefreshCw, MapPin, Loader2, FileCheck } from 'lucide-react';
import { CRM_POINT_TYPES, CONTRACT_COLOR } from '@/lib/territoire-config';

export default function MapControls({
  points = [],
  visibleTypes = [],
  onToggleType,
  showZones = true,
  onToggleZones,
  zonesLoading = false,
  onRecalculateZones,
  stats = null,
  showContractsOnly = false,
  onToggleContracts,
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Compter les points par type
  const countByType = {};
  for (const type of Object.keys(CRM_POINT_TYPES)) {
    countByType[type] = points.filter(p => p.type === type).length;
  }
  const totalVisible = points.filter(p => visibleTypes.includes(p.type)).length;

  // Compteur contrats actifs (sous-ensemble des clients)
  const contractCount = points.filter(p => p.type === 'client' && p.hasContract).length;

  if (collapsed) {
    return (
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-lg border border-secondary-200 text-sm font-medium text-secondary-700 hover:bg-secondary-50 transition-colors"
        >
          <MapPin className="w-4 h-4 text-primary-600" />
          <span>{totalVisible} points</span>
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="absolute top-4 right-4 z-10 w-64 bg-white rounded-xl shadow-xl border border-secondary-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-100 bg-secondary-50">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary-600" />
          <span className="text-sm font-semibold text-secondary-800">Filtres</span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded hover:bg-secondary-200 text-secondary-400 transition-colors"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
      </div>

      {/* Types CRM */}
      <div className="px-4 py-3 space-y-2">
        <p className="text-xs font-medium text-secondary-400 uppercase tracking-wide mb-2">
          Types de points
        </p>
        {Object.entries(CRM_POINT_TYPES).map(([type, config]) => {
          const count = countByType[type] || 0;
          const isVisible = visibleTypes.includes(type);

          return (
            <div key={type}>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={() => onToggleType(type)}
                  className="sr-only"
                />
                <span
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    isVisible
                      ? 'border-transparent'
                      : 'border-secondary-300 bg-white'
                  }`}
                  style={isVisible ? { backgroundColor: config.color, borderColor: config.color } : {}}
                >
                  {isVisible && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <span className="flex-1 text-sm text-secondary-700 group-hover:text-secondary-900 transition-colors">
                  {config.label}
                </span>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                  count > 0 ? 'bg-secondary-100 text-secondary-600' : 'text-secondary-300'
                }`}>
                  {count}
                </span>
              </label>

              {/* Filtre contrats actifs (sous le type Client) */}
              {type === 'client' && contractCount > 0 && (
                <label className="flex items-center gap-2 ml-7 mt-1 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={showContractsOnly}
                    onChange={onToggleContracts}
                    className="sr-only"
                  />
                  <span
                    className={`w-3 h-3 rounded border flex items-center justify-center transition-colors ${
                      showContractsOnly
                        ? 'border-transparent'
                        : 'border-secondary-300 bg-white'
                    }`}
                    style={showContractsOnly ? { backgroundColor: CONTRACT_COLOR, borderColor: CONTRACT_COLOR } : {}}
                  >
                    {showContractsOnly && (
                      <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="text-xs text-secondary-500 group-hover:text-secondary-700 transition-colors">
                    Contrats actifs ({contractCount})
                  </span>
                </label>
              )}
            </div>
          );
        })}
      </div>

      {/* Zones */}
      <div className="px-4 py-3 border-t border-secondary-100 space-y-2">
        <p className="text-xs font-medium text-secondary-400 uppercase tracking-wide mb-2">
          Zones territoire
        </p>

        <button
          onClick={onToggleZones}
          className="flex items-center gap-3 w-full text-left group"
        >
          {showZones ? (
            <Eye className="w-4 h-4 text-primary-500" />
          ) : (
            <EyeOff className="w-4 h-4 text-secondary-400" />
          )}
          <span className="flex-1 text-sm text-secondary-700">
            {showZones ? 'Zones visibles' : 'Zones masquées'}
          </span>
        </button>

        <button
          onClick={onRecalculateZones}
          disabled={zonesLoading}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium text-secondary-600 bg-secondary-50 rounded-lg hover:bg-secondary-100 disabled:opacity-50 transition-colors"
        >
          {zonesLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Recalculer les zones
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="px-4 py-3 border-t border-secondary-100 bg-secondary-50">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div>
              <p className="text-lg font-bold text-secondary-800">{stats.geocoded}</p>
              <p className="text-xs text-secondary-500">Géocodés</p>
            </div>
            <div>
              <p className="text-lg font-bold text-secondary-800">{stats.coverage}%</p>
              <p className="text-xs text-secondary-500">Couverture</p>
            </div>
          </div>
          {stats.notGeocoded > 0 && (
            <p className="mt-2 text-xs text-amber-600 text-center">
              {stats.notGeocoded} clients sans coordonnées
            </p>
          )}
        </div>
      )}
    </div>
  );
}
