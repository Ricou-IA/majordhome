/**
 * Territoire.jsx
 * Page carte interactive du territoire CRM
 */

import { useState, useCallback } from 'react';
import { Map, Loader2, AlertTriangle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';

import { MAPBOX_CONFIG } from '@/lib/mapbox';
import TerritoireMap from '../components/territoire/TerritoireMap';
import { useMapZones } from '../components/territoire/useMapZones';
import { useTerritoireData, useTerritoireStats } from '../components/territoire/useTerritoireData';
import { territoireService } from '@services/territoire.service';
import { geocodingService } from '@services/geocoding.service';

// ============================================================================
// COMPOSANT PAGE
// ============================================================================

export default function Territoire() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  // Données carte
  const { points, isLoading: pointsLoading, refetch: refetchPoints } = useTerritoireData();
  const { data: stats } = useTerritoireStats();

  // Zones isochrones
  const {
    zones,
    isLoading: zonesLoading,
    error: zonesError,
    invalidate: invalidateZones,
  } = useMapZones(MAPBOX_CONFIG.accessToken);

  // État batch géocodage
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);

  const ungeocodedCount = stats?.notGeocoded || 0;

  // ========================================================================
  // BATCH GÉOCODAGE
  // ========================================================================

  const handleBatchGeocode = useCallback(async () => {
    if (!orgId) return;
    setBatchRunning(true);
    toast.info('Chargement des clients à géocoder...');

    try {
      const result = await territoireService.getUngeocodedClients(orgId);

      if (!result.data?.length) {
        toast.info('Tous les clients sont déjà géocodés');
        setBatchRunning(false);
        return;
      }

      setBatchProgress({ current: 0, total: result.data.length });

      const results = await geocodingService.batchGeocodeClients(
        result.data,
        (current, total) => setBatchProgress({ current, total })
      );

      toast.success(
        `Géocodage terminé : ${results.success} réussis, ${results.failed} échoués`
      );

      window.location.reload();
    } catch (error) {
      toast.error('Erreur lors du géocodage batch');
      console.error('[Territoire] batch geocode error:', error);
    } finally {
      setBatchRunning(false);
      setBatchProgress(null);
    }
  }, [orgId]);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handlePointClick = useCallback((point) => {
    console.log('[Territoire] Point cliqué:', point);
  }, []);

  const handleZoneClick = useCallback((zone) => {
    toast.info(`Zone ${zone === 'gaillac' ? 'Gaillac' : 'Pechbonnieu'} sélectionnée`);
  }, []);

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
            <Map className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-secondary-900">Territoire</h1>
            <p className="text-sm text-secondary-500">
              Carte interactive de l'activité CRM
            </p>
          </div>
        </div>

        {/* Bouton batch géocodage */}
        <button
          onClick={handleBatchGeocode}
          disabled={batchRunning || ungeocodedCount === 0}
          className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors text-sm font-medium"
        >
          {batchRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                Géocodage {batchProgress?.current || 0}/{batchProgress?.total || '...'}...
              </span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              <span>
                {ungeocodedCount > 0
                  ? `Géocoder ${ungeocodedCount} clients`
                  : 'Tous les clients sont géocodés'}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Info zones fallback (cercles approximatifs au lieu d'isochrones) */}
      {zones?.metadata?.fallback && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-blue-500 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-blue-800">Zones approximatives</p>
            <p className="text-blue-600">Cercles de rayon ~{zones.metadata.isochrone_minutes} min (API Isochrone Mapbox non disponible)</p>
          </div>
        </div>
      )}

      {/* Erreur zones (seulement si fallback aussi échoue) */}
      {zonesError && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-800">Impossible de calculer les zones</p>
            <p className="text-amber-600">{zonesError}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {pointsLoading && !points.length ? (
        <div className="flex items-center justify-center h-[600px] bg-secondary-50 rounded-xl border border-secondary-200">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto" />
            <p className="mt-3 text-sm text-secondary-500">Chargement des données...</p>
          </div>
        </div>
      ) : (
        <TerritoireMap
          points={points}
          zones={zones}
          zonesLoading={zonesLoading}
          onInvalidateZones={invalidateZones}
          stats={stats}
          height="calc(100vh - 200px)"
          onPointClick={handlePointClick}
          onZoneClick={handleZoneClick}
        />
      )}
    </div>
  );
}
