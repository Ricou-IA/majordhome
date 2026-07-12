// src/apps/solaire/components/Step1Localisation.jsx
// Étape 1 du wizard : localisation (GPS ou adresse) + toiture (pente %, orientation, surface).
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import * as turf from '@turf/turf';
import { MapPin, LocateFixed, Loader2, AlertTriangle, ArrowRight, Check, Plus, Trash2, Star, Lock, Unlock } from 'lucide-react';
import { useDebounce } from '@hooks/useDebounce';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';
import { searchAddress, getDevicePosition, fetchPvgis1kwc, reverseGeocode } from '../lib/pvgis';
import { fetchRoofPlaneFromIgn } from '../lib/ignMns';
import { percentToDegrees, orientationToAspect, maxPowerKwc, panelsCount } from '../lib/pvEngine';
import RoofLocatorMap from './dossier/RoofLocatorMap';
import CadastreSection from './dossier/CadastreSection';

// Boussole 3×3 (centre vide) — ordre d'affichage
const COMPASS = [
  ['NO', 'N', 'NE'],
  ['O', null, 'E'],
  ['SO', 'S', 'SE'],
];

// Étiquette boussole (8 points) depuis l'azimut compas 0..360 (0=N, sens horaire).
const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
function azimuthToCompassLabel(azimuthCompass) {
  if (azimuthCompass == null || Number.isNaN(azimuthCompass)) return '—';
  const idx = Math.round(((azimuthCompass % 360) + 360) % 360 / 45) % 8;
  return COMPASS_8[idx];
}

export default function Step1Localisation({ location, roof, config, roofGeometry, pans, cadastre, abf, onLocation, onRoof, onRoofGeometry, onAddPan, onRemovePan, onUpdatePan, onCadastre, onAbf, onNext }) {
  const [gpsLoading, setGpsLoading] = useState(false);
  const [addressQuery, setAddressQuery] = useState(location.address || '');
  const [suggestions, setSuggestions] = useState([]);
  const debouncedQuery = useDebounce(addressQuery, 300);

  // Autocomplétion adresse (data.gouv). On ne supprime le pop-up que si l'adresse est DÉJÀ validée
  // (choisie dans la liste) : après un GPS approximatif, on laisse au contraire les suggestions
  // s'afficher pour que l'utilisateur sélectionne l'adresse exacte (avec le n° de rue).
  useEffect(() => {
    let cancelled = false;
    const q = debouncedQuery.trim();
    if (q.length < 3 || (debouncedQuery === location.address && location.source === 'adresse')) {
      setSuggestions([]);
      return undefined;
    }
    searchAddress(debouncedQuery).then(({ data }) => {
      if (!cancelled) setSuggestions(data);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, location.address]);

  const [solarStatus, setSolarStatus] = useState('idle'); // idle|locate|drawn

  // Sélection d'un pan (liste ↔ carte) : la carte Toiture devient l'éditeur du pan sélectionné.
  const [selectedPanId, setSelectedPanId] = useState(null);
  // Toiture verrouillée par défaut (valeurs IGN fiables) ; cadenas pour forçage manuel.
  const [toitureUnlocked, setToitureUnlocked] = useState(false);

  // Ajout d'un pan (géométrie IGN LiDAR + ensoleillement PVGIS par pan).
  const [panLoading, setPanLoading] = useState(false);

  // Effacement impératif du tracé en cours dans la carte (sans remonter la carte).
  const [resetToken, setResetToken] = useState(0);

  // Nouveau lieu → on efface tout tracé précédent (l'user retrace sur la vue aérienne).
  useEffect(() => {
    onRoofGeometry(null);
    setSolarStatus(location.lat == null ? 'idle' : 'locate');
    setPanLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.lat, location.lon]);

  // Ajout d'un pan : géométrie IGN LiDAR (pente/orientation/surface pentée) + ensoleillement
  // annuel PVGIS (kWh/kWc/an) calculé pour ce pan. Le pan rejoint la liste comparative.
  const addPan = async () => {
    if (!roofGeometry?.polygon) return;
    setPanLoading(true);
    const { data: geo } = await fetchRoofPlaneFromIgn(roofGeometry.polygon);
    if (geo?.source !== 'ign') {
      setPanLoading(false);
      toast.error('Géométrie IGN indisponible pour ce pan — réessayez ou tracez plus au centre.');
      return;
    }
    const [lon, lat] = turf.centroid(roofGeometry.polygon).geometry.coordinates;
    const { data: pv } = await fetchPvgis1kwc({
      lat, lon, loss: config.system_loss,
      angleDeg: Math.round(geo.pitchDeg * 10) / 10, aspect: Math.round(geo.aspectPvgis),
    });
    setPanLoading(false);
    onAddPan({
      id: crypto.randomUUID(),
      polygon: roofGeometry.polygon,
      footprintM2: geo.footprintM2, slopeAreaM2: geo.slopeAreaM2,
      pitchDeg: geo.pitchDeg, pitchPercent: geo.pitchPercent,
      aspectPvgis: geo.aspectPvgis, azimuthCompass: geo.azimuthCompass,
      eY: pv?.e_y ?? null,
    });
    onRoofGeometry(null); // vide le dessin courant pour le pan suivant
    setResetToken((t) => t + 1); // efface le tracé dans la carte sans la remonter
  };

  // Agrégat pans → toiture single-roof (le sim aval reste mono-toiture) : surface totale +
  // angles du meilleur pan (max ensoleillement, fallback max surface si eY tous null).
  // TODO incrément 3 : simulation par pan (répartir les kWc entre pans selon leur eY).
  useEffect(() => {
    if (!pans || pans.length === 0) return;
    const totalSlope = pans.reduce((s, p) => s + (p.slopeAreaM2 || 0), 0);
    const withEy = pans.filter((p) => p.eY != null);
    const best = (withEy.length ? withEy : pans).reduce(
      (a, b) => (withEy.length ? (b.eY > a.eY ? b : a) : (b.slopeAreaM2 > a.slopeAreaM2 ? b : a)),
    );
    onRoof({
      surfaceM2: Math.round(totalSlope),
      tiltPercent: Math.max(0, Math.round(best.pitchPercent)),
      orientation: Math.round(best.aspectPvgis),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pans]);

  // Sélection par défaut : le meilleur pan (max ensoleillement). Re-sélectionne si le pan
  // sélectionné disparaît (suppression) ; désélectionne si plus aucun pan.
  useEffect(() => {
    if (!pans || pans.length === 0) {
      setSelectedPanId(null);
      return;
    }
    if (selectedPanId == null || !pans.some((p) => p.id === selectedPanId)) {
      const best = pans.reduce((a, b) => ((b.eY ?? -1) > (a.eY ?? -1) ? b : a));
      setSelectedPanId(best.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pans]);

  // Changement de sélection → re-verrouille (on repart des valeurs IGN fiables).
  useEffect(() => {
    setToitureUnlocked(false);
  }, [selectedPanId]);

  const activePan = pans ? pans.find((p) => p.id === selectedPanId) || null : null;

  // Re-PVGIS pour tout pan « stale » (eY null suite à une édition manuelle pente/orientation).
  // Debounce ~600 ms ; recalcule kWh/kWc/an pour l'angle/aspect édités.
  useEffect(() => {
    const stale = (pans ?? []).find((p) => p.eY == null && Number.isFinite(p.pitchDeg) && Number.isFinite(p.aspectPvgis));
    if (!stale) return undefined;
    const t = setTimeout(async () => {
      const [lon, lat] = turf.centroid(stale.polygon).geometry.coordinates;
      const { data } = await fetchPvgis1kwc({
        lat, lon, loss: config.system_loss,
        angleDeg: Math.round(stale.pitchDeg * 10) / 10, aspect: Math.round(stale.aspectPvgis),
      });
      if (data?.e_y != null) onUpdatePan(stale.id, { eY: data.e_y });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pans]);

  const bestEy = pans && pans.length ? Math.max(...pans.map((p) => (p.eY != null ? p.eY : -Infinity))) : null;
  const totalPansSurface = pans ? pans.reduce((s, p) => s + (p.slopeAreaM2 || 0), 0) : 0;

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
      // Géocodage inverse : pré-remplit l'adresse (approximative, source 'gps') — l'utilisateur la
      // confirme/complète ensuite via l'autocomplétion (le CERFA exige le n° de rue exact).
      const { data: rev } = await reverseGeocode(pos.lon, pos.lat);
      onLocation({ lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy, source: 'gps', address: rev?.label || '' });
      setAddressQuery(rev?.label || '');
      toast.success(rev?.label ? `Position : ${rev.label} — vérifiez l'adresse` : `Position trouvée (±${Math.round(pos.accuracy)} m)`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGpsLoading(false);
    }
  };

  const pickSuggestion = (s) => {
    onLocation({ lat: s.lat, lon: s.lon, address: s.label, accuracy: null, source: 'adresse' });
    setAddressQuery(s.label); // adresse confirmée affichée dans le champ (validée pour le dossier)
    setSuggestions([]);
  };

  // Mode « éditeur de pan » : la carte Toiture pilote le pan sélectionné (dès qu'un pan existe).
  const panEditor = pans && pans.length > 0 && activePan;

  // Valeurs affichées dans la carte Toiture : depuis le pan actif (mode éditeur) sinon roof.*.
  const tiltPercentVal = panEditor ? activePan.pitchPercent : roof.tiltPercent;
  const surfaceVal = panEditor ? activePan.slopeAreaM2 : roof.surfaceM2;
  const orientationVal = panEditor ? activePan.aspectPvgis : roof.orientation;

  const tilt = Number(tiltPercentVal);
  const tiltDeg = Number.isFinite(tilt) ? Math.round(percentToDegrees(tilt) * 10) / 10 : null;
  const aspect = panEditor
    ? (Number.isFinite(Number(orientationVal)) ? Number(orientationVal) : 0)
    : orientationToAspect(orientationVal);
  const isNorthFacing = Math.abs(aspect) > 135;
  const surface = Number(surfaceVal);
  const hasSurface = Number.isFinite(surface) && surface > 0;
  const maxKwc = hasSurface ? maxPowerKwc(surface, config.panel_area_m2, config.panel_power_wc) : 0;
  const hasLocation = location.lat !== null && location.lon !== null;
  // Adresse « validée » = choisie dans l'autocomplétion BAN (exacte). Le GPS reverse-géocode
  // ne donne qu'une adresse approximative → à confirmer par l'utilisateur pour le dossier.
  const addressValidated = location.source === 'adresse' && !!location.address;
  const canContinue = hasLocation && hasSurface && maxKwc > 0 && Number.isFinite(tilt);

  // En mode éditeur les inputs sont désactivés tant que le cadenas n'est pas ouvert.
  const inputsLocked = panEditor && !toitureUnlocked;

  // Handlers d'édition : dispatch UPDATE_PAN (mode éditeur) sinon SET_ROOF (fallback).
  const handleTiltChange = (raw) => {
    const n = raw === '' ? '' : Number(raw);
    const clean = Number.isNaN(n) ? '' : n;
    if (panEditor) {
      const deg = clean === '' ? null : Math.atan(clean / 100) * 180 / Math.PI;
      onUpdatePan(activePan.id, { pitchPercent: clean, pitchDeg: deg, eY: null });
    } else {
      onRoof({ tiltPercent: clean });
    }
  };
  const handleSurfaceChange = (raw) => {
    const n = raw === '' ? '' : Number(raw);
    const clean = Number.isNaN(n) ? '' : n;
    if (panEditor) onUpdatePan(activePan.id, { slopeAreaM2: clean });
    else onRoof({ surfaceM2: clean });
  };
  const handleOrientationDir = (dir) => {
    if (panEditor) onUpdatePan(activePan.id, { aspectPvgis: orientationToAspect(dir), eY: null });
    else onRoof({ orientation: dir });
  };
  const handleOrientationDeg = (raw) => {
    if (panEditor) {
      const n = raw === '' ? 0 : Number(raw);
      onUpdatePan(activePan.id, { aspectPvgis: Number.isNaN(n) ? 0 : n, eY: null });
    } else {
      const n = raw === '' ? 'S' : Number(raw);
      onRoof({ orientation: typeof n === 'number' && Number.isNaN(n) ? 'S' : n });
    }
  };
  // Sélection de la boussole : en mode éditeur, la direction dont l'aspect correspond à celui du pan.
  const selectedDir = panEditor ? null : roof.orientation;
  const panActiveIndex = panEditor ? pans.findIndex((p) => p.id === activePan.id) : -1;

  return (
    <div className="space-y-5">
      {/* Écran large (xl) : carte dominante à gauche, saisie à droite. Tablette/mobile : empilé.
          Pas de sticky ici : la colonne carte dépasse le viewport → deux zones de scroll désynchronisées. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 xl:items-start gap-5">
        <div className="xl:col-span-2">
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
              <FormField label="Adresse exacte du logement">
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
              <div className="space-y-2">
                {/* Statut de validation de l'adresse (exigence dossier : adresse exacte confirmée) */}
                {addressValidated ? (
                  <div className="flex items-start gap-2 text-sm text-[#1565C0] bg-blue-50 rounded-lg px-3 py-2">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>Adresse validée : {location.address}</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-sm text-[#B45309] bg-amber-50 border border-[#F5C542] rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      Adresse à confirmer pour le dossier — sélectionnez l'adresse exacte (avec le n° de rue)
                      dans la liste ci-dessus. La position GPS est approximative.
                    </span>
                  </div>
                )}
                <p className="text-xs text-secondary-500">
                  Position : {location.lat.toFixed(5)}, {location.lon.toFixed(5)}
                  {location.source === 'gps' && location.accuracy ? ` (±${Math.round(location.accuracy)} m)` : ''}
                </p>
              </div>
            )}

            {hasLocation && (
              <RoofLocatorMap
                key={`${location.lat},${location.lon}`}
                center={{ lat: location.lat, lon: location.lon }}
                initialPolygon={roofGeometry?.polygon}
                onPolygon={handlePolygon}
                savedPans={pans}
                selectedPanId={selectedPanId}
                onSelectPan={setSelectedPanId}
                resetToken={resetToken}
              />
            )}
            {hasLocation && solarStatus === 'drawn' && (
              <button
                type="button"
                onClick={addPan}
                disabled={panLoading}
                className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-60"
              >
                {panLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {panLoading ? 'Analyse du pan…' : '➕ Ajouter ce pan'}
              </button>
            )}

            {hasLocation && solarStatus === 'locate' && (
              <div className="flex items-center gap-2 text-sm text-secondary-600 bg-secondary-50 rounded-lg px-3 py-2">
                <MapPin className="w-4 h-4 flex-shrink-0" /> Tracez le contour de votre toiture sur la vue aérienne pour calculer la surface.
              </div>
            )}
            {hasLocation && solarStatus === 'drawn' && roofGeometry?.footprint_m2 && (
              <div className="flex items-center gap-2 text-sm text-[#1565C0] bg-blue-50 rounded-lg px-3 py-2">
                <Check className="w-4 h-4 flex-shrink-0" />
                Toiture tracée — surface {Math.round(roofGeometry.footprint_m2)} m² (empreinte au sol). Renseignez pente et orientation dans le panneau Toiture.
              </div>
            )}
          </div>
        </div>

        {/* Colonne saisie : pans tracés, panneau Toiture, cadastre */}
        <div className="space-y-5">
          {/* Pans cartographiés — comparaison (meilleur ensoleillement mis en avant) */}
          {pans && pans.length > 0 && (
            <div className="card space-y-2">
              <h3 className="text-sm font-semibold text-secondary-900">Pans de toiture</h3>
              <ul className="space-y-2">
                {pans.map((pan, i) => {
                  const isBest = pan.eY != null && bestEy != null && pan.eY === bestEy;
                  const isSelected = pan.id === selectedPanId;
                  return (
                    <li
                      key={pan.id}
                      onClick={() => setSelectedPanId(pan.id)}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-primary-400 ring-2 ring-primary-400 bg-primary-50'
                          : isBest
                            ? 'border-[#F5C542] ring-1 ring-[#F5C542] bg-amber-50/40'
                            : 'border-secondary-200 bg-white hover:border-secondary-400'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-secondary-900">
                          {isBest && <Star className="w-3.5 h-3.5 text-[#B45309] fill-[#F5C542] flex-shrink-0" />}
                          Pan {i + 1}
                          {isBest && <span className="text-xs font-normal text-[#B45309]">★ meilleur</span>}
                        </div>
                        <div className="text-xs text-secondary-500">
                          pente {Math.round(pan.pitchDeg)}° · {azimuthToCompassLabel(pan.azimuthCompass)} · {Math.round(pan.slopeAreaM2)} m² ·{' '}
                          {pan.eY != null ? `${Math.round(pan.eY)} kWh/kWc/an` : '—'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemovePan(pan.id); }}
                        className="p-1.5 text-secondary-400 hover:text-red-600 rounded-md hover:bg-red-50 flex-shrink-0"
                        aria-label={`Supprimer le pan ${i + 1}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-secondary-600">
                Total surface : {Math.round(totalPansSurface)} m² · {pans.length} pan(s)
              </p>
            </div>
          )}

          {/* Toiture — en mode éditeur (pans existants) = panneau du pan sélectionné, verrouillé */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-secondary-900">
                {panEditor ? `Toiture — Pan ${panActiveIndex + 1}` : 'Toiture'}
              </h2>
              {panEditor && (
                <button
                  type="button"
                  onClick={() => setToitureUnlocked((v) => !v)}
                  title="Forcer les valeurs manuellement"
                  aria-label="Forcer les valeurs manuellement"
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    toitureUnlocked
                      ? 'bg-amber-50 text-[#B45309] border-[#F5C542]'
                      : 'bg-white text-secondary-600 border-secondary-200 hover:border-secondary-400'
                  }`}
                >
                  {toitureUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  {toitureUnlocked ? 'Déverrouillé' : 'Forcer'}
                </button>
              )}
            </div>
            {panEditor && (
              <p className="text-xs text-secondary-500">
                Valeurs mesurées par IGN.{' '}
                {toitureUnlocked ? 'Édition manuelle activée.' : 'Ouvrez le cadenas pour les forcer manuellement.'}
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Pente (%)">
                <input
                  type="number"
                  inputMode="decimal"
                  className={inputClass}
                  value={Number.isFinite(tilt) ? Math.round(tilt) : ''}
                  min={0}
                  step={1}
                  disabled={inputsLocked}
                  onChange={(e) => handleTiltChange(e.target.value)}
                />
                {tiltDeg !== null && (
                  <p className="text-xs text-secondary-500 mt-1">{Math.round(tilt)} % ≈ {Math.round(tiltDeg)}°</p>
                )}
              </FormField>

              <FormField label="Surface disponible (m²)">
                <input
                  type="number"
                  inputMode="decimal"
                  className={inputClass}
                  value={Number.isFinite(surface) ? Math.round(surface) : ''}
                  min={0}
                  step={1}
                  disabled={inputsLocked}
                  onChange={(e) => handleSurfaceChange(e.target.value)}
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
                        disabled={inputsLocked}
                        onClick={() => handleOrientationDir(dir)}
                        className={`h-11 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          (panEditor ? orientationToAspect(dir) === Number(orientationVal) : selectedDir === dir)
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
                    disabled={inputsLocked}
                    value={panEditor ? (Number.isFinite(Number(orientationVal)) ? Math.round(Number(orientationVal)) : '') : (typeof roof.orientation === 'number' ? roof.orientation : '')}
                    placeholder={`${aspect}`}
                    onChange={(e) => handleOrientationDeg(e.target.value)}
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

          {/* Cadastre + ABF — capture write-once pour le dossier PV (remonté à chaque lieu) */}
          {hasLocation && (
            <CadastreSection
              key={`cad-${location.lat},${location.lon}`}
              location={location}
              cadastre={cadastre}
              abf={abf}
              onCadastre={onCadastre}
              onAbf={onAbf}
            />
          )}
        </div>
      </div>

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
