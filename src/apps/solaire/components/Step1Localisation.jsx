// src/apps/solaire/components/Step1Localisation.jsx
// Étape 1 du wizard : localisation (GPS ou adresse) + toiture (pente %, orientation, surface).
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { MapPin, LocateFixed, Loader2, AlertTriangle, ArrowRight, Check, Sparkles } from 'lucide-react';
import { useDebounce } from '@hooks/useDebounce';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';
import { searchAddress, getDevicePosition } from '../lib/pvgis';
import { percentToDegrees, orientationToAspect, maxPowerKwc, panelsCount, degreesToPercent } from '../lib/pvEngine';
import { fetchBuildingInsights } from '../lib/googleSolar';
import FluxHeatmap from './dossier/FluxHeatmap';
import RoofLocatorMap from './dossier/RoofLocatorMap';

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

  const [solarStatus, setSolarStatus] = useState('idle'); // idle|locate|loading|filled|manual
  const [pickedPoint, setPickedPoint] = useState(null);

  // Nouveau lieu → on réinitialise la sélection de toit (l'user re-clique sur la vue aérienne).
  useEffect(() => {
    setPickedPoint(null);
    setSolarStatus(location.lat == null ? 'idle' : 'locate'); // 'locate' = carte prête, en attente du clic
  }, [location.lat, location.lon]);

  // Clic sur la vue aérienne → Google Solar sur les coordonnées précises cliquées (repli manuel si 404).
  const handlePickRoof = async (point) => {
    setPickedPoint(point);
    setSolarStatus('loading');
    const { data } = await fetchBuildingInsights({ lat: point.lat, lon: point.lon });
    if (!data || data.source === 'manual' || !data.dominant) {
      setSolarStatus('manual');
      return;
    }
    const d = data.dominant;
    // Pente/orientation = pan dominant ; surface = TOUT le toit exploitable (pas un seul pan).
    const surface = data.usableAreaM2 ?? d.area_m2;
    onRoof({
      tiltPercent: Math.max(0, Math.round(degreesToPercent(d.pitch_deg))),
      orientation: Math.round(d.aspect_pvgis),
      surfaceM2: Math.round(surface),
    });
    onRoofGeometry({ ...data });
    setSolarStatus('filled');
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
            center={{ lat: location.lat, lon: location.lon }}
            picked={pickedPoint}
            onPick={handlePickRoof}
          />
        )}
        {hasLocation && solarStatus === 'locate' && (
          <div className="flex items-center gap-2 text-sm text-secondary-600 bg-secondary-50 rounded-lg px-3 py-2">
            <MapPin className="w-4 h-4 flex-shrink-0" /> Cliquez votre maison sur la vue aérienne pour l'analyser.
          </div>
        )}
        {hasLocation && solarStatus === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-secondary-600 bg-secondary-50 rounded-lg px-3 py-2">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /> Analyse de la toiture (Google Solar)…
          </div>
        )}
        {hasLocation && solarStatus === 'filled' && (
          <div className="flex items-center gap-2 text-sm text-[#1565C0] bg-blue-50 rounded-lg px-3 py-2">
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            Toiture pré-remplie via Google Solar{roofGeometry?.imageryQuality ? ` (qualité ${roofGeometry.imageryQuality})` : ''} — ajustable ci-dessous.
          </div>
        )}
        {hasLocation && solarStatus === 'manual' && (
          <div className="flex items-center gap-2 text-sm text-secondary-600 bg-secondary-50 rounded-lg px-3 py-2">
            <MapPin className="w-4 h-4 flex-shrink-0" /> Toit non couvert par Google Solar ici — recliquez ailleurs sur le toit, ou saisissez la toiture à la main.
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
    </div>
  );
}
