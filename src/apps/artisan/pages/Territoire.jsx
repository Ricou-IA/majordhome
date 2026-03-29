/**
 * Territoire.jsx
 * Page carte interactive du territoire CRM
 */

import { useState, useEffect, useCallback } from 'react';
import { Map, Loader2, AlertTriangle, Zap, MapPin } from 'lucide-react';
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

  // État batch géocodage clients
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);

  // État batch géocodage leads
  const [leadBatchRunning, setLeadBatchRunning] = useState(false);
  const [leadBatchProgress, setLeadBatchProgress] = useState(null);
  const [ungeocodedLeadsCount, setUngeocodedLeadsCount] = useState(0);

  const ungeocodedCount = stats?.notGeocoded || 0;

  // Charger le count de leads non géocodés
  useEffect(() => {
    if (!orgId) return;
    territoireService.getUngeocodedLeads(orgId).then(({ count, error }) => {
      if (error) {
        console.error('[Territoire] getUngeocodedLeads error:', error);
      }
      setUngeocodedLeadsCount(count || 0);
    });
  }, [orgId, leadBatchRunning]);

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

      refetchPoints();
    } catch (error) {
      toast.error('Erreur lors du géocodage batch');
      console.error('[Territoire] batch geocode error:', error);
    } finally {
      setBatchRunning(false);
      setBatchProgress(null);
    }
  }, [orgId, refetchPoints]);

  // ========================================================================
  // BATCH GÉOCODAGE LEADS
  // ========================================================================

  const handleBatchGeocodeLeads = useCallback(async () => {
    if (!orgId) return;
    setLeadBatchRunning(true);
    toast.info('Chargement des leads à géocoder...');

    try {
      const result = await territoireService.getUngeocodedLeads(orgId);

      if (!result.data?.length) {
        toast.info('Tous les leads sont déjà géocodés');
        setLeadBatchRunning(false);
        return;
      }

      setLeadBatchProgress({ current: 0, total: result.data.length });

      const results = await geocodingService.batchGeocodeLeads(
        result.data,
        (current, total) => setLeadBatchProgress({ current, total })
      );

      const parts = [`${results.success} géocodés`];
      if (results.assigned > 0) parts.push(`${results.assigned} assignés`);
      if (results.failed > 0) parts.push(`${results.failed} échoués`);
      toast.success(`Leads : ${parts.join(', ')}`);

      refetchPoints();
    } catch (error) {
      toast.error('Erreur lors du géocodage des leads');
      console.error('[Territoire] batch geocode leads error:', error);
    } finally {
      setLeadBatchRunning(false);
      setLeadBatchProgress(null);
    }
  }, [orgId, refetchPoints]);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handlePointClick = useCallback((point) => {
  }, []);

  const handleZoneClick = useCallback(() => {
    // Pas de toast — clic zone silencieux
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

        {/* Boutons batch géocodage */}
        <div className="flex items-center gap-2">
          {/* Clients */}
          <button
            onClick={handleBatchGeocode}
            disabled={batchRunning || ungeocodedCount === 0}
            className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            {batchRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  Clients {batchProgress?.current || 0}/{batchProgress?.total || '...'}
                </span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                <span>
                  {ungeocodedCount > 0
                    ? `Géocoder ${ungeocodedCount} clients`
                    : 'Clients géocodés ✓'}
                </span>
              </>
            )}
          </button>

          {/* Leads */}
          <button
            onClick={handleBatchGeocodeLeads}
            disabled={leadBatchRunning || ungeocodedLeadsCount === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            {leadBatchRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  Leads {leadBatchProgress?.current || 0}/{leadBatchProgress?.total || '...'}
                </span>
              </>
            ) : (
              <>
                <MapPin className="w-4 h-4" />
                <span>
                  {ungeocodedLeadsCount > 0
                    ? `Géocoder ${ungeocodedLeadsCount} leads`
                    : 'Leads géocodés ✓'}
                </span>
              </>
            )}
          </button>
        </div>
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
