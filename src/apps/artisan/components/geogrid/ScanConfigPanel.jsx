import { useState, useEffect, useMemo } from 'react';
import { Search, Loader2, AlertTriangle, Info, Grid3x3, MapPin, ExternalLink } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useGeoGridQuota } from '@hooks/useGeoGrid';
import { fetchTarnCommunes, filterByPopulation, centroidOf } from './communesService';

const DEFAULT_CONFIG = {
  businessName: 'Mayer Energie',
  placeId: '',
  keyword: 'climatisation',
  radiusKm: 5,
  gridSize: 7,
  searchRadiusM: 1000,
};

// Code INSEE de Gaillac — ville par défaut au mount (en attendant le chargement des communes)
const DEFAULT_CITY_CODE = '81099';
const DEFAULT_CITY_LAT = 43.9016;
const DEFAULT_CITY_LNG = 1.8976;

const POPULATION_THRESHOLDS = [
  { value: 0, label: 'Toutes (314 communes)' },
  { value: 500, label: '≥ 500 hab' },
  { value: 1000, label: '≥ 1000 hab' },
  { value: 2000, label: '≥ 2000 hab' },
  { value: 5000, label: '≥ 5000 hab' },
];

// Profils de recherche simulée (biais Google `locationBias`)
// Le radius indique à quel point Google privilégie la proximité géographique stricte.
const SEARCH_PROFILES = [
  { value: 500, label: 'Proximité piétonne (500 m)', hint: 'Resto, café, commerce — client à pied' },
  { value: 1000, label: 'Proximité quartier (1 km)', hint: 'Coiffeur, pressing, boulangerie' },
  { value: 2000, label: 'Recherche ville (2 km)', hint: 'Installateur, plombier, chauffagiste — le pro vient au client' },
  { value: 3000, label: 'Recherche ville étendue (3 km)', hint: 'Service technique, prestation à domicile' },
  { value: 5000, label: 'Recherche zone large (5 km)', hint: 'Concessionnaire, magasin spécialisé' },
];

// Pricing Google Places API Text Search Pro — tranche 5000-100000 req/mois
const PRICE_PER_REQ_OVER_FREE_EUR = 27.75 / 1000;

export default function ScanConfigPanel({ onLaunch, isScanning, orgId }) {
  const { organization } = useAuth();
  const orgName = organization?.name || '';
  const orgPlaceId = organization?.settings?.google_place_id || '';

  const [mode, setMode] = useState('grid'); // 'grid' | 'cities'
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [selectedCityCode, setSelectedCityCode] = useState(DEFAULT_CITY_CODE);
  const [allowOverage, setAllowOverage] = useState(false);
  const [minPopulation, setMinPopulation] = useState(1000);
  const [citiesSearchRadius, setCitiesSearchRadius] = useState(2000);
  const [communes, setCommunes] = useState(null);
  const [loadingCommunes, setLoadingCommunes] = useState(false);
  const [communesError, setCommunesError] = useState(null);

  // Détecte si le businessName saisi correspond à l'org (insensible casse/espaces)
  const isOrgBusiness = useMemo(() => {
    const a = config.businessName?.toLowerCase().trim();
    const b = orgName.toLowerCase().trim();
    return a && b && a === b;
  }, [config.businessName, orgName]);

  // Synchronise le placeId avec le businessName :
  // - Match org → remplit le placeId stocké
  // - Plus de match ET le placeId actuel est celui de l'org → vide (laisse l'utilisateur saisir)
  useEffect(() => {
    if (!orgPlaceId) return;
    setConfig((prev) => {
      if (isOrgBusiness && prev.placeId !== orgPlaceId) {
        return { ...prev, placeId: orgPlaceId };
      }
      if (!isOrgBusiness && prev.placeId === orgPlaceId) {
        return { ...prev, placeId: '' };
      }
      return prev;
    });
  }, [isOrgBusiness, orgPlaceId]);

  const { data: quota } = useGeoGridQuota(orgId);

  // Charge la liste des communes du Tarn au mount (utilisée par les deux modes)
  useEffect(() => {
    if (communes) return;
    setLoadingCommunes(true);
    setCommunesError(null);
    fetchTarnCommunes()
      .then((data) => setCommunes(data))
      .catch((err) => setCommunesError(err.message))
      .finally(() => setLoadingCommunes(false));
  }, [communes]);

  const filteredCommunes = useMemo(
    () => (communes ? filterByPopulation(communes, minPopulation) : []),
    [communes, minPopulation]
  );

  // Villes principales (≥ 10 000 hab) pour le sélecteur du mode grille
  const bigCities = useMemo(
    () => (communes ? filterByPopulation(communes, 10000) : []),
    [communes]
  );

  // Ville sélectionnée (source de vérité). bigCities peut être vide pendant le chargement
  // → fallback sur les coordonnées de Gaillac codées en dur.
  const selectedCity = useMemo(
    () => bigCities.find((c) => c.code === selectedCityCode) || null,
    [bigCities, selectedCityCode]
  );

  // Si la ville sélectionnée n'est plus dans la liste après chargement (edge case), fallback sur la 1ère
  useEffect(() => {
    if (bigCities.length && !bigCities.some((c) => c.code === selectedCityCode)) {
      setSelectedCityCode(bigCities[0].code);
    }
  }, [bigCities, selectedCityCode]);

  // Coordonnées effectives utilisées pour le scan en mode grille (toujours dérivées de la ville sélectionnée)
  const gridCenterLat = selectedCity?.lat ?? DEFAULT_CITY_LAT;
  const gridCenterLng = selectedCity?.lng ?? DEFAULT_CITY_LNG;

  const handleChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'grid') {
      onLaunch({
        ...config,
        mode: 'grid',
        centerLat: gridCenterLat,
        centerLng: gridCenterLng,
        radiusKm: parseFloat(config.radiusKm),
        gridSize: parseInt(config.gridSize),
        searchRadiusM: parseInt(config.searchRadiusM),
      });
    } else {
      const center = centroidOf(filteredCommunes);
      onLaunch({
        mode: 'cities',
        businessName: config.businessName,
        placeId: config.placeId,
        keyword: config.keyword,
        centerLat: center.lat,
        centerLng: center.lng,
        searchRadiusM: citiesSearchRadius,
        points: filteredCommunes.map((c) => ({ name: c.name, code: c.code, lat: c.lat, lng: c.lng })),
      });
    }
  };

  const totalPoints = mode === 'grid' ? parseInt(config.gridSize) ** 2 : filteredCommunes.length;
  const requestsUsed = quota?.requestsUsed || 0;
  const freeTierLimit = quota?.freeTierLimit || 5000;
  const projectedUsed = requestsUsed + totalPoints;
  const wouldExceed = projectedUsed > freeTierLimit;
  const overageReqs = Math.max(0, projectedUsed - Math.max(requestsUsed, freeTierLimit));
  const overageCostEur = overageReqs * PRICE_PER_REQ_OVER_FREE_EUR;

  const percentUsed = quota?.percentUsed ?? 0;
  const projectedPercent = Math.min(100, Math.round((projectedUsed / freeTierLimit) * 100));
  const barColor = percentUsed >= 95 ? 'bg-red-500'
    : percentUsed >= 70 ? 'bg-amber-500'
    : 'bg-green-500';
  const projectedColor = wouldExceed ? 'bg-red-300' : 'bg-green-300';

  const isLaunchBlocked = (wouldExceed && !allowOverage) || (mode === 'cities' && totalPoints === 0);

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-4 space-y-4">
      <h3 className="font-semibold text-secondary-900">Configuration du scan</h3>

      {/* Toggle mode */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-secondary-100 rounded-lg">
        <button
          type="button"
          onClick={() => setMode('grid')}
          className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
            mode === 'grid' ? 'bg-white text-primary-700 shadow-sm' : 'text-secondary-600 hover:text-secondary-900'
          }`}
        >
          <Grid3x3 className="w-3.5 h-3.5" />
          Maillage Gaillac
        </button>
        <button
          type="button"
          onClick={() => setMode('cities')}
          className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
            mode === 'cities' ? 'bg-white text-primary-700 shadow-sm' : 'text-secondary-600 hover:text-secondary-900'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          Communes Tarn
        </button>
      </div>

      {/* Champs partagés */}
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
          <label className="text-xs font-medium text-secondary-600 mb-1 flex items-center justify-between gap-1">
            <span className="flex items-center gap-1.5">
              Place ID
              {isOrgBusiness && orgPlaceId && (
                <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-green-100 text-green-700" title={`Auto-rempli depuis ${orgName}`}>
                  AUTO
                </span>
              )}
            </span>
            {!isOrgBusiness && (
              <a
                href="https://developers.google.com/maps/documentation/places/web-service/place-id"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:text-primary-700 text-[11px] flex items-center gap-0.5"
                title="Ouvre l'outil Google Place ID Finder. Cherche le business (pas l'adresse) et clique sur le pin."
              >
                Trouver
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
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

      {/* Mode grille : config géométrique */}
      {mode === 'grid' && (
        <>
          {/* Sélecteur ville principale (≥10 000 hab) */}
          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1">
              Ville à analyser
            </label>
            <select
              value={selectedCityCode}
              onChange={(e) => setSelectedCityCode(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              disabled={loadingCommunes || !bigCities.length}
            >
              {loadingCommunes && <option>Chargement...</option>}
              {bigCities.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.population.toLocaleString('fr-FR')} hab)
                </option>
              ))}
            </select>
            {selectedCity && (
              <div className="text-[11px] text-secondary-500 mt-1">
                Centre : {selectedCity.lat.toFixed(4)}, {selectedCity.lng.toFixed(4)}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
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
        </>
      )}

      {/* Mode communes : sélecteur seuil pop + profil de recherche */}
      {mode === 'cities' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1">
              Seuil de population <span className="text-secondary-400">(filtre les communes scannées)</span>
            </label>
            <select
              value={minPopulation}
              onChange={(e) => setMinPopulation(parseInt(e.target.value))}
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              {POPULATION_THRESHOLDS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1 flex items-center gap-1">
              Profil de recherche simulé
              <span title="Définit à quel point Google privilégie la proximité géographique stricte. Plus large = simule un client prêt à faire venir un pro de plus loin.">
                <Info className="w-3 h-3 text-secondary-400" />
              </span>
            </label>
            <select
              value={citiesSearchRadius}
              onChange={(e) => setCitiesSearchRadius(parseInt(e.target.value))}
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              {SEARCH_PROFILES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <div className="text-[11px] text-secondary-500 mt-1 italic">
              {SEARCH_PROFILES.find((p) => p.value === citiesSearchRadius)?.hint}
            </div>
          </div>

          <div className="text-xs text-secondary-600 bg-secondary-50 rounded px-2 py-1.5">
            {loadingCommunes && <span>Chargement des communes du Tarn...</span>}
            {communesError && <span className="text-red-600">Erreur : {communesError}</span>}
            {communes && !loadingCommunes && (
              <span>
                <span className="font-medium text-secondary-900">{filteredCommunes.length}</span> communes sélectionnées sur {communes.length}
                {filteredCommunes.length > 0 && (
                  <span className="text-secondary-500"> · de <span className="font-medium">{filteredCommunes[0]?.name}</span> ({filteredCommunes[0]?.population.toLocaleString('fr-FR')} hab) à <span className="font-medium">{filteredCommunes[filteredCommunes.length - 1]?.name}</span> ({filteredCommunes[filteredCommunes.length - 1]?.population.toLocaleString('fr-FR')} hab)</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Compteur quota Google Places API — free tier mensuel UTC */}
      {quota && (
        <div className="border-t pt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-secondary-700 flex items-center gap-1">
              Quota gratuit ce mois
              <span title="Free tier Google Places API : 5000 requêtes/mois (reset le 1er à 00:00 UTC). Au-delà : ~27,75 €/1000 req.">
                <Info className="w-3 h-3 text-secondary-400" />
              </span>
            </span>
            <span className="text-secondary-600 tabular-nums">
              {requestsUsed} / {freeTierLimit} req · {quota.scansCount} scan{quota.scansCount > 1 ? 's' : ''}
            </span>
          </div>

          {/* Barre de progression avec projection */}
          <div className="relative h-2 bg-secondary-100 rounded-full overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 ${projectedColor} transition-all`}
              style={{ width: `${projectedPercent}%` }}
              title={`Après ce scan : ${projectedUsed} req`}
            />
            <div
              className={`absolute inset-y-0 left-0 ${barColor} transition-all`}
              style={{ width: `${Math.min(100, percentUsed)}%` }}
            />
          </div>

          <div className="text-xs text-secondary-500">
            Ce scan = <span className="font-medium text-secondary-700">{totalPoints} req</span>
            {' → '}
            {wouldExceed ? (
              <span className="text-red-600 font-medium">
                dépassement de {overageReqs} req (~{overageCostEur.toFixed(2)} €)
              </span>
            ) : (
              <span>reste <span className="font-medium text-secondary-700">{freeTierLimit - projectedUsed}</span> req gratuites</span>
            )}
          </div>

          {/* Override checkbox si dépassement */}
          {wouldExceed && (
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
      )}

      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-secondary-500">
          {totalPoints} points — ~{Math.ceil(totalPoints * 0.3)}s de scan
        </span>
        <button
          type="submit"
          disabled={isScanning || isLaunchBlocked}
          title={isLaunchBlocked ? (mode === 'cities' && totalPoints === 0 ? 'Aucune commune sélectionnée' : 'Quota gratuit dépassé — cocher la case pour autoriser') : ''}
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
