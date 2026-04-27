import { useState, useEffect, useMemo, useRef } from 'react';
import { X, Play, Loader2, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@contexts/AuthContext';
import geogridService from '@services/geogrid.service';
import { useQueryClient } from '@tanstack/react-query';
import { geogridKeys, FREE_TIER_LIMIT } from '@hooks/useGeoGrid';
import { fetchTarnCommunes, filterByPopulation, centroidOf } from './communesService';

const PRICE_PER_REQ_OVER_FREE_EUR = 27.75 / 1000;

const POPULATION_THRESHOLDS = [
  { value: 1000, label: '≥ 1000 hab (~77 villes)' },
  { value: 2000, label: '≥ 2000 hab (~30 villes)' },
  { value: 5000, label: '≥ 5000 hab (~10 villes)' },
];

const GRID_SIZES = [
  { value: 5, label: '5x5 (25 pts)' },
  { value: 7, label: '7x7 (49 pts)' },
];

const BIG_CITIES_DEFAULT = [
  { code: '81004', name: 'Albi', lat: 43.928, lng: 2.148 },
  { code: '81065', name: 'Castres', lat: 43.605, lng: 2.241 },
  { code: '81099', name: 'Gaillac', lat: 43.9016, lng: 1.8976 },
];

export default function BenchmarkLauncher({ orgId, lists, quota, onClose, onLaunched }) {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const cancelRef = useRef(false);

  const [selectedListId, setSelectedListId] = useState(lists[0]?.id || '');
  const [scanMode, setScanMode] = useState('grid'); // grid | cities
  const [gaillacCenter, setGaillacCenter] = useState('81099'); // code commune pour mode grid
  const [gridSize, setGridSize] = useState(5);
  const [radiusKm, setRadiusKm] = useState(3);
  const [searchRadiusM, setSearchRadiusM] = useState(2000);
  const [minPopulation, setMinPopulation] = useState(2000);
  const [allowOverage, setAllowOverage] = useState(false);

  const [communes, setCommunes] = useState(null);

  // État du run
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentKeyword: '' });
  const [errors, setErrors] = useState([]);

  // Charge communes pour mode cities + sélecteur ville mode grid
  useEffect(() => {
    fetchTarnCommunes().then(setCommunes).catch(() => setCommunes([]));
  }, []);

  const bigCities = useMemo(
    () => (communes ? filterByPopulation(communes, 10000) : BIG_CITIES_DEFAULT),
    [communes]
  );

  const filteredCommunes = useMemo(
    () => (communes ? filterByPopulation(communes, minPopulation) : []),
    [communes, minPopulation]
  );

  const selectedCity = bigCities.find((c) => c.code === gaillacCenter) || BIG_CITIES_DEFAULT[2];
  const selectedList = lists.find((l) => l.id === selectedListId);

  // Calcul coût en req
  const totalKeywords = selectedList?.keywords?.length || 0;
  const pointsPerScan = scanMode === 'grid' ? gridSize * gridSize : filteredCommunes.length;
  const totalReqs = totalKeywords * pointsPerScan;

  const requestsUsed = quota?.requestsUsed || 0;
  const projectedUsed = requestsUsed + totalReqs;
  const wouldExceed = projectedUsed > FREE_TIER_LIMIT;
  const overageReqs = Math.max(0, projectedUsed - Math.max(requestsUsed, FREE_TIER_LIMIT));
  const overageCostEur = overageReqs * PRICE_PER_REQ_OVER_FREE_EUR;

  // Estimation durée : 49 pts ~16s, 25 pts ~9s, communes ~5s
  const estimatedSecondsPerScan = pointsPerScan * 0.3 + 2;
  const estimatedDurationSec = totalKeywords * estimatedSecondsPerScan;
  const estimatedDurationMin = Math.ceil(estimatedDurationSec / 60);

  const isLaunchBlocked = !selectedListId || totalKeywords === 0 || (wouldExceed && !allowOverage) || (scanMode === 'cities' && !filteredCommunes.length);

  const handleClose = () => {
    if (running) {
      cancelRef.current = true;
      toast.info('Annulation demandée — finition du scan en cours puis arrêt');
    }
    onClose();
  };

  const handleLaunch = async () => {
    if (!selectedList || running) return;

    setRunning(true);
    cancelRef.current = false;
    setProgress({ current: 0, total: totalKeywords, currentKeyword: '' });
    setErrors([]);

    // 1. Crée le benchmark en DB
    let benchmarkId;
    try {
      const center = scanMode === 'cities' ? centroidOf(filteredCommunes) : { lat: selectedCity.lat, lng: selectedCity.lng };
      const { data: benchmark, error: benchmarkError } = await geogridService.createBenchmark(orgId, {
        list_id: selectedListId,
        scan_mode: scanMode,
        business_name: organization?.name || 'Mayer Energie',
        place_id: organization?.settings?.google_place_id || null,
        center_lat: center.lat,
        center_lng: center.lng,
        radius_km: scanMode === 'grid' ? radiusKm : null,
        grid_size: scanMode === 'grid' ? gridSize : null,
        search_radius_m: searchRadiusM,
        city_min_population: scanMode === 'cities' ? minPopulation : null,
        total_keywords: totalKeywords,
      });
      if (benchmarkError) throw benchmarkError;
      benchmarkId = benchmark.id;
    } catch (e) {
      toast.error(`Erreur création benchmark : ${e.message}`);
      setRunning(false);
      return;
    }

    // 2. Loop sur les keywords
    const errorsList = [];
    let completedCount = 0;

    for (const keyword of selectedList.keywords) {
      if (cancelRef.current) break;

      setProgress({ current: completedCount, total: totalKeywords, currentKeyword: keyword });

      try {
        const params = {
          orgId,
          keyword,
          businessName: organization?.name || 'Mayer Energie',
          placeId: organization?.settings?.google_place_id || '',
          searchRadiusM,
        };

        if (scanMode === 'grid') {
          params.mode = 'grid';
          params.centerLat = selectedCity.lat;
          params.centerLng = selectedCity.lng;
          params.radiusKm = radiusKm;
          params.gridSize = gridSize;
        } else {
          params.mode = 'cities';
          const center = centroidOf(filteredCommunes);
          params.centerLat = center.lat;
          params.centerLng = center.lng;
          params.points = filteredCommunes.map((c) => ({ name: c.name, code: c.code, lat: c.lat, lng: c.lng }));
        }

        const { data, error } = await geogridService.launchScan(params);
        if (error) throw error;

        // Lier le scan au benchmark
        if (data?.scanId) {
          await supabase
            .from('majordhome_geogrid_scans_write')
            .update({ benchmark_id: benchmarkId })
            .eq('id', data.scanId);
        }

        completedCount += 1;
        await geogridService.updateBenchmarkProgress(benchmarkId, { completed_keywords: completedCount });
      } catch (e) {
        errorsList.push({ keyword, error: e.message });
        setErrors([...errorsList]);
      }
    }

    // 3. Marquer le benchmark terminé
    const finalStatus = cancelRef.current ? 'cancelled' : (errorsList.length === totalKeywords ? 'failed' : 'completed');
    await geogridService.updateBenchmarkProgress(benchmarkId, {
      status: finalStatus,
      completed_at: new Date().toISOString(),
      error_message: errorsList.length ? `${errorsList.length} keyword(s) en erreur` : null,
    });

    queryClient.invalidateQueries({ queryKey: geogridKeys.all });

    if (finalStatus === 'completed') {
      toast.success(`Benchmark terminé — ${completedCount}/${totalKeywords} keywords scannés`);
    } else if (finalStatus === 'cancelled') {
      toast.info(`Benchmark annulé — ${completedCount}/${totalKeywords} keywords scannés avant arrêt`);
    } else {
      toast.error(`Benchmark échoué — ${errorsList.length} erreurs`);
    }

    setRunning(false);
    onLaunched(benchmarkId);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-secondary-900">Lancer un benchmark</h2>
            <button onClick={handleClose} className="text-secondary-400 hover:text-secondary-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Sélection liste */}
          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1">Liste de keywords</label>
            <select
              value={selectedListId}
              onChange={(e) => setSelectedListId(e.target.value)}
              disabled={running}
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.keyword_count || l.keywords?.length || 0} keywords)
                </option>
              ))}
            </select>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1">Mode de scan</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'grid', label: '📍 Présence locale (Gaillac)', desc: 'Maillage fin sur 1 ville' },
                { value: 'cities', label: '🗺️ Visibilité Tarn (communes)', desc: '1 point par ville' },
              ].map((m) => (
                <button
                  key={m.value}
                  onClick={() => setScanMode(m.value)}
                  disabled={running}
                  className={`text-left p-2 rounded-md border-2 transition-colors text-sm ${
                    scanMode === m.value ? 'border-primary-500 bg-primary-50' : 'border-secondary-200 hover:border-secondary-300'
                  }`}
                >
                  <div className="font-medium">{m.label}</div>
                  <div className="text-xs text-secondary-500">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Config mode grid */}
          {scanMode === 'grid' && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-secondary-600 mb-1">Ville</label>
                <select
                  value={gaillacCenter}
                  onChange={(e) => setGaillacCenter(e.target.value)}
                  disabled={running}
                  className="w-full px-3 py-1.5 text-sm border rounded-md"
                >
                  {bigCities.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary-600 mb-1">Grille</label>
                <select
                  value={gridSize}
                  onChange={(e) => setGridSize(parseInt(e.target.value))}
                  disabled={running}
                  className="w-full px-3 py-1.5 text-sm border rounded-md"
                >
                  {GRID_SIZES.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary-600 mb-1">Rayon (km)</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(parseFloat(e.target.value))}
                  disabled={running}
                  className="w-full px-3 py-1.5 text-sm border rounded-md"
                />
              </div>
            </div>
          )}

          {/* Config mode cities */}
          {scanMode === 'cities' && (
            <div>
              <label className="block text-xs font-medium text-secondary-600 mb-1">Seuil population communes</label>
              <select
                value={minPopulation}
                onChange={(e) => setMinPopulation(parseInt(e.target.value))}
                disabled={running}
                className="w-full px-3 py-1.5 text-sm border rounded-md"
              >
                {POPULATION_THRESHOLDS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              {filteredCommunes.length > 0 && (
                <div className="mt-1 text-xs text-secondary-500">
                  {filteredCommunes.length} communes sélectionnées
                </div>
              )}
            </div>
          )}

          {/* Profil de recherche */}
          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1 flex items-center gap-1">
              Rayon recherche (m)
              <span title="Profil utilisateur simulé. 2000m = standard installateur (le pro vient au client).">
                <Info className="w-3 h-3 text-secondary-400" />
              </span>
            </label>
            <input
              type="number"
              min="500"
              max="5000"
              step="100"
              value={searchRadiusM}
              onChange={(e) => setSearchRadiusM(parseInt(e.target.value))}
              disabled={running}
              className="w-full px-3 py-1.5 text-sm border rounded-md"
            />
          </div>

          {/* Récap coût */}
          <div className="border-t pt-3 space-y-2">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="bg-secondary-50 rounded p-2">
                <div className="text-xs text-secondary-500">Keywords</div>
                <div className="font-bold">{totalKeywords}</div>
              </div>
              <div className="bg-secondary-50 rounded p-2">
                <div className="text-xs text-secondary-500">Total req</div>
                <div className="font-bold">{totalReqs}</div>
              </div>
              <div className="bg-secondary-50 rounded p-2">
                <div className="text-xs text-secondary-500">Durée estimée</div>
                <div className="font-bold">~{estimatedDurationMin} min</div>
              </div>
            </div>

            {/* Quota */}
            {quota && (
              <div className="text-xs text-secondary-600">
                Après ce benchmark : <span className="font-medium">{projectedUsed}</span> / {FREE_TIER_LIMIT} req
                {wouldExceed && (
                  <span className="text-red-600 ml-2">
                    (dépassement de {overageReqs} req ≈ {overageCostEur.toFixed(2)} €)
                  </span>
                )}
              </div>
            )}

            {wouldExceed && !running && (
              <label className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowOverage}
                  onChange={(e) => setAllowOverage(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-amber-900">
                  <AlertTriangle className="w-3 h-3 inline mr-1" />
                  Autoriser le dépassement payant (~{overageCostEur.toFixed(2)} €)
                </span>
              </label>
            )}
          </div>

          {/* Progression en cours */}
          {running && (
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {progress.current} / {progress.total} keywords scannés
                </span>
                <span className="text-secondary-500 text-xs">
                  Cliquer "Annuler" pour arrêter après le scan en cours
                </span>
              </div>
              <div className="h-2 bg-secondary-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 transition-all"
                  style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }}
                />
              </div>
              {progress.currentKeyword && (
                <div className="text-xs text-secondary-600">
                  En cours : <span className="font-mono">{progress.currentKeyword}</span>
                </div>
              )}
              {errors.length > 0 && (
                <div className="text-xs text-red-600">
                  {errors.length} erreur(s) sur des keywords
                </div>
              )}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-sm font-medium text-secondary-700 hover:bg-secondary-100 rounded-md"
            >
              {running ? 'Annuler' : 'Fermer'}
            </button>
            <button
              onClick={handleLaunch}
              disabled={running || isLaunchBlocked}
              className="flex items-center gap-2 px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Scan en cours...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Lancer ({totalReqs} req)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
