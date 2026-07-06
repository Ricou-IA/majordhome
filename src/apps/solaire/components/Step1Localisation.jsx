// src/apps/solaire/components/Step1Localisation.jsx
// Étape 1 du wizard : localisation (GPS ou adresse) + toiture (pente %, orientation, surface).
import { useState, useEffect, lazy, Suspense } from 'react';
import { toast } from 'sonner';
import * as turf from '@turf/turf';
import { MapPin, LocateFixed, Loader2, AlertTriangle, ArrowRight, Check, Sun, Box, Ruler } from 'lucide-react';
import { useDebounce } from '@hooks/useDebounce';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';
import { searchAddress, getDevicePosition } from '../lib/pvgis';
import { fetchFluxOverlay } from '../lib/googleSolarFlux';
import { fetchRoof3D } from '../lib/googleSolar3D';
import { fetchRoofPlaneFromIgn } from '../lib/ignMns';
import { percentToDegrees, orientationToAspect, maxPowerKwc, panelsCount } from '../lib/pvEngine';
import FluxHeatmap from './dossier/FluxHeatmap';
import RoofLocatorMap from './dossier/RoofLocatorMap';

// Three.js est lourd → viewer 3D lazy-loadé (chunk séparé, hors bundle principal).
const Roof3DViewer = lazy(() => import('./dossier/Roof3DViewer'));

// Boussole 3×3 (centre vide) — ordre d'affichage
const COMPASS = [
  ['NO', 'N', 'NE'],
  ['O', null, 'E'],
  ['SO', 'S', 'SE'],
];

export default function Step1Localisation({ location, roof, config, roofGeometry, onLocation, onRoof, onRoofGeometry, onNext }) {
  const [gpsLoading, setGpsLoading] = useState(false);
  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const debouncedQuery = useDebounce(addressQuery, 300);

  // Autocomplétion adresse (data.gouv)
  useEffect(() => {
    let cancelled = false;
    if (debouncedQuery.trim().length < 3) {
      setSuggestions([]);
      return undefined;
    }
    searchAddress(debouncedQuery).then(({ data }) => {
      if (!cancelled) setSuggestions(data);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const [solarStatus, setSolarStatus] = useState('idle'); // idle|locate|drawn

  // Étape B : overlay flux Google Solar (chargé à la demande).
  const [fluxOverlay, setFluxOverlay] = useState(null);
  const [fluxLoading, setFluxLoading] = useState(false);
  const [fluxMsg, setFluxMsg] = useState(null);
  const [fluxDebug, setFluxDebug] = useState(null); // diagnostic temporaire (alignement overlay)

  // Viewer 3D (DSM + flux drapé) — chargé à la demande.
  const [roof3d, setRoof3d] = useState(null);
  const [roof3dLoading, setRoof3dLoading] = useState(false);

  // Pente/orientation depuis le MNS IGN LiDAR HD (plane-fit sur le toit tracé).
  const [ignLoading, setIgnLoading] = useState(false);
  const [ignMsg, setIgnMsg] = useState(null);

  // Nouveau lieu → on efface tout tracé précédent (l'user retrace sur la vue aérienne).
  useEffect(() => {
    onRoofGeometry(null);
    setSolarStatus(location.lat == null ? 'idle' : 'locate');
    setFluxOverlay(null);
    setFluxMsg(null);
    setRoof3d(null);
    setIgnLoading(false);
    setIgnMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.lat, location.lon]);

  const loadFlux = async () => {
    if (location.lat == null) return;
    setFluxLoading(true);
    setFluxMsg(null);
    setFluxDebug(null);
    // Le flux se récupère au centre de la TOITURE TRACÉE (pas au point géocodé, qui peut être
    // ailleurs si l'utilisateur a déplacé la carte pour tracer une autre maison → décalage).
    const [flng, flat] = roofGeometry?.polygon
      ? turf.centroid(roofGeometry.polygon).geometry.coordinates
      : [location.lon, location.lat];
    const { data } = await fetchFluxOverlay({ lat: flat, lon: flng });
    setFluxLoading(false);
    if (data?.source === 'google') {
      setFluxOverlay({ imageUrl: data.imageUrl, coordinates: data.coordinates });
      const c = data.coordinates; // [TL, TR, BR, BL] en [lng,lat]
      const west = c[0][0]; const north = c[0][1]; const east = c[2][0]; const south = c[2][1];
      setFluxDebug(`fetch ${flat.toFixed(5)}, ${flng.toFixed(5)} · overlay lng ${west.toFixed(5)}→${east.toFixed(5)} · lat ${south.toFixed(5)}→${north.toFixed(5)}`);
    } else if (data?.source === 'none') {
      setFluxMsg('Pas de couche de flux Google sur ce point.');
    } else {
      setFluxMsg('Flux Google indisponible.');
    }
  };

  // Vue 3D : DSM + flux drapé, mesure au clic. Centroïde de la toiture tracée (comme loadFlux).
  const openRoof3D = async () => {
    if (location.lat == null) return;
    setRoof3dLoading(true);
    const [flng, flat] = roofGeometry?.polygon
      ? turf.centroid(roofGeometry.polygon).geometry.coordinates
      : [location.lon, location.lat];
    const { data } = await fetchRoof3D({ lat: flat, lon: flng });
    setRoof3dLoading(false);
    if (data?.source === 'google') {
      setRoof3d(data);
    } else if (data?.source === 'none') {
      toast.info('Pas de données 3D Google sur ce point.');
    } else {
      toast.error('Vue 3D Google indisponible.');
    }
  };

  // Pente/orientation/surface depuis le MNS IGN LiDAR HD (bouton explicite, pas d'auto-run sur
  // chaque édition de sommet). IGN écrase la surface avec la surface pentée du pan ajusté.
  const computeIgnPlane = async () => {
    if (!roofGeometry?.polygon) return;
    setIgnLoading(true); setIgnMsg(null);
    const { data } = await fetchRoofPlaneFromIgn(roofGeometry.polygon);
    setIgnLoading(false);
    if (data?.source === 'ign') {
      onRoof({
        tiltPercent: Math.max(0, Math.round(data.pitchPercent)),
        orientation: Math.round(data.aspectPvgis),
        surfaceM2: Math.round(data.slopeAreaM2),
      });
      setIgnMsg(`IGN LiDAR : pente ${Math.round(data.pitchDeg)}° · surface pentée ${Math.round(data.slopeAreaM2)} m² (ajustables ci-dessous)`);
    } else if (data?.source === 'none') {
      setIgnMsg('Pas de donnée IGN exploitable ici — saisissez pente/orientation à la main.');
    } else {
      setIgnMsg('Analyse IGN indisponible — saisie manuelle.');
    }
  };

  // Tracé du toit sur la vue aérienne → surface calculée par turf (empreinte au sol).
  const handlePolygon = (feature) => {
    if (!feature) {
      onRoofGeometry(null);
      setSolarStatus('locate');
      return;
    }
    const footprintM2 = turf.area(feature); // empreinte au sol (m²) — vue du dessus
    onRoof({ surfaceM2: Math.round(footprintM2) });
    onRoofGeometry({ source: 'drawn', polygon: feature.geometry, footprint_m2: footprintM2 });
    setSolarStatus('drawn');
  };

  const handleGps = async () => {
    setGpsLoading(true);
    try {
      const pos = await getDevicePosition();
      onLocation({ lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy, source: 'gps', address: '' });
      toast.success(`Position trouvée (±${Math.round(pos.accuracy)} m)`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGpsLoading(false);
    }
  };

  const pickSuggestion = (s) => {
    onLocation({ lat: s.lat, lon: s.lon, address: s.label, accuracy: null, source: 'adresse' });
    setAddressQuery('');
    setSuggestions([]);
  };

  const tilt = Number(roof.tiltPercent);
  const tiltDeg = Number.isFinite(tilt) ? Math.round(percentToDegrees(tilt) * 10) / 10 : null;
  const aspect = orientationToAspect(roof.orientation);
  const isNorthFacing = Math.abs(aspect) > 135;
  const surface = Number(roof.surfaceM2);
  const hasSurface = Number.isFinite(surface) && surface > 0;
  const maxKwc = hasSurface ? maxPowerKwc(surface, config.panel_area_m2, config.panel_power_wc) : 0;
  const hasLocation = location.lat !== null && location.lon !== null;
  const canContinue = hasLocation && hasSurface && maxKwc > 0 && Number.isFinite(tilt);

  return (
    <div className="space-y-5">
      {/* Localisation */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-secondary-900">Localisation du logement</h2>

        <button
          onClick={handleGps}
          disabled={gpsLoading}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60"
        >
          {gpsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-5 h-5" />}
          {gpsLoading ? 'Localisation en cours…' : '📍 Me localiser'}
        </button>

        <div className="relative">
          <FormField label="Ou saisir une adresse">
            <input
              className={inputClass}
              value={addressQuery}
              placeholder="12 rue de la République, Gaillac"
              onChange={(e) => setAddressQuery(e.target.value)}
              autoComplete="off"
            />
          </FormField>
          {suggestions.length > 0 && (
            <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-secondary-200 rounded-lg shadow-lg overflow-hidden">
              {suggestions.map((s) => (
                <li key={`${s.lat}-${s.lon}`}>
                  <button
                    onClick={() => pickSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-secondary-50 flex items-center gap-2"
                  >
                    <MapPin className="w-4 h-4 text-secondary-400 flex-shrink-0" />
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {hasLocation && (
          <div className="flex items-center gap-2 text-sm text-[#1565C0] bg-blue-50 rounded-lg px-3 py-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            <span>
              {location.source === 'gps'
                ? `Position GPS${location.accuracy ? ` (±${Math.round(location.accuracy)} m)` : ''}`
                : location.address}
              {' — '}
              {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
            </span>
          </div>
        )}

        {hasLocation && (
          <RoofLocatorMap
            key={`${location.lat},${location.lon}`}
            center={{ lat: location.lat, lon: location.lon }}
            initialPolygon={roofGeometry?.polygon}
            onPolygon={handlePolygon}
            fluxOverlay={fluxOverlay}
          />
        )}
        {hasLocation && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={loadFlux}
              disabled={fluxLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-secondary-200 bg-white text-sm font-medium text-secondary-700 hover:border-secondary-400 disabled:opacity-60"
            >
              {fluxLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sun className="w-4 h-4 text-[#F5C542]" />}
              {fluxLoading ? 'Chargement du flux…' : '☀️ Voir le flux solaire (Google)'}
            </button>
            <button
              type="button"
              onClick={openRoof3D}
              disabled={roof3dLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-secondary-200 bg-white text-sm font-medium text-secondary-700 hover:border-secondary-400 disabled:opacity-60"
            >
              {roof3dLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Box className="w-4 h-4 text-[#1565C0]" />}
              {roof3dLoading ? 'Chargement de la 3D…' : '🧊 Vue 3D + flux (Google)'}
            </button>
            {solarStatus === 'drawn' && (
              <button
                type="button"
                onClick={computeIgnPlane}
                disabled={ignLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-secondary-200 bg-white text-sm font-medium text-secondary-700 hover:border-secondary-400 disabled:opacity-60"
              >
                {ignLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ruler className="w-4 h-4 text-[#1565C0]" />}
                {ignLoading ? 'Analyse IGN…' : '📐 Pente & orientation (IGN LiDAR)'}
              </button>
            )}
            {ignMsg && (
              <p className="text-xs text-secondary-500 text-center">{ignMsg}</p>
            )}
            {fluxMsg && (
              <p className="text-xs text-secondary-500 text-center">{fluxMsg}</p>
            )}
            {fluxOverlay && (
              <p className="text-xs text-secondary-500 text-center">
                Flux annuel Google Solar (indicatif) — bleu foncé = faible, clair/jaune = fort.
              </p>
            )}
            {fluxDebug && (
              <p className="text-[10px] font-mono text-secondary-400 text-center break-all">{fluxDebug}</p>
            )}
          </div>
        )}
        {hasLocation && solarStatus === 'locate' && (
          <div className="flex items-center gap-2 text-sm text-secondary-600 bg-secondary-50 rounded-lg px-3 py-2">
            <MapPin className="w-4 h-4 flex-shrink-0" /> Tracez le contour de votre toiture sur la vue aérienne pour calculer la surface.
          </div>
        )}
        {hasLocation && solarStatus === 'drawn' && roofGeometry?.footprint_m2 && (
          <div className="flex items-center gap-2 text-sm text-[#1565C0] bg-blue-50 rounded-lg px-3 py-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            Toiture tracée — surface {Math.round(roofGeometry.footprint_m2)} m² (empreinte au sol). Renseignez pente et orientation ci-dessous.
          </div>
        )}
      </div>

      {/* Toiture */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-secondary-900">Toiture</h2>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Pente (%)">
            <input
              type="number"
              inputMode="decimal"
              className={inputClass}
              value={roof.tiltPercent ?? ''}
              min={0}
              step={1}
              onChange={(e) => {
                const n = e.target.value === '' ? '' : Number(e.target.value);
                onRoof({ tiltPercent: Number.isNaN(n) ? '' : n });
              }}
            />
            {tiltDeg !== null && (
              <p className="text-xs text-secondary-500 mt-1">{tilt} % ≈ {tiltDeg}°</p>
            )}
          </FormField>

          <FormField label="Surface disponible (m²)">
            <input
              type="number"
              inputMode="decimal"
              className={inputClass}
              value={roof.surfaceM2 ?? ''}
              min={0}
              step={1}
              onChange={(e) => {
                const n = e.target.value === '' ? '' : Number(e.target.value);
                onRoof({ surfaceM2: Number.isNaN(n) ? '' : n });
              }}
            />
            {hasSurface && (
              <p className="text-xs text-secondary-500 mt-1">
                → max {panelsCount(maxKwc, config.panel_power_wc)} panneaux soit {maxKwc} kWc
              </p>
            )}
          </FormField>
        </div>

        <FormField label="Orientation">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="grid grid-cols-3 gap-1 w-40 flex-shrink-0">
              {COMPASS.flat().map((dir, i) =>
                dir === null ? (
                  <div key={`c-${i}`} className="h-11" />
                ) : (
                  <button
                    key={dir}
                    onClick={() => onRoof({ orientation: dir })}
                    className={`h-11 rounded-lg text-sm font-medium border transition-colors ${
                      roof.orientation === dir
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-secondary-700 border-secondary-200 hover:border-secondary-400'
                    }`}
                  >
                    {dir}
                  </button>
                ),
              )}
            </div>
            <div className="flex-1 min-w-[140px]">
              <p className="text-xs text-secondary-500 mb-1">Ou en degrés (Sud = 0, Est = −90, Ouest = +90)</p>
              <input
                type="number"
                inputMode="numeric"
                className={inputClass}
                min={-180}
                max={180}
                value={typeof roof.orientation === 'number' ? roof.orientation : ''}
                placeholder={`${aspect}`}
                onChange={(e) => {
                  const n = e.target.value === '' ? 'S' : Number(e.target.value);
                  onRoof({ orientation: typeof n === 'number' && Number.isNaN(n) ? 'S' : n });
                }}
              />
            </div>
          </div>
          {isNorthFacing && (
            <div className="flex items-center gap-2 text-sm text-secondary-800 bg-secondary-100 rounded-lg px-3 py-2 mt-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Orientation défavorable — production fortement réduite
            </div>
          )}
        </FormField>
      </div>

      {roofGeometry?.flux_image_path && <FluxHeatmap fluxImagePath={roofGeometry.flux_image_path} />}

      <button
        onClick={onNext}
        disabled={!canContinue}
        className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continuer <ArrowRight className="w-4 h-4" />
      </button>

      {roof3d && (
        <Suspense fallback={null}>
          <Roof3DViewer roof={roof3d} onClose={() => setRoof3d(null)} />
        </Suspense>
      )}
    </div>
  );
}
