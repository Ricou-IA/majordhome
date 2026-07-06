// src/apps/solaire/components/dossier/RoofLocatorMap.jsx
// Vue aérienne (Mapbox satellite) avec outil de dessin : l'utilisateur trace le contour
// de sa toiture. La surface est calculée depuis le tracé (turf) — indépendant de la
// détection de bâtiment de Google (peu fiable). Le polygone remonte via onPolygon.
import { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { Pencil } from 'lucide-react';
import { MAPBOX_CONFIG } from '@/lib/mapbox';

const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

// Styles de tracé contrastés (bleu foncé + halo blanc) pour bien ressortir sur l'imagerie satellite.
const DRAW_STYLES = [
  { id: 'gl-draw-polygon-fill', type: 'fill', filter: ['==', '$type', 'Polygon'],
    paint: { 'fill-color': '#1D4ED8', 'fill-opacity': 0.25 } },
  { id: 'gl-draw-polygon-stroke', type: 'line', filter: ['==', '$type', 'Polygon'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0B1F4D', 'line-width': 3 } },
  { id: 'gl-draw-line', type: 'line', filter: ['==', '$type', 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0B1F4D', 'line-width': 3, 'line-dasharray': [0.2, 2] } },
  { id: 'gl-draw-vertex-halo', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
    paint: { 'circle-radius': 6, 'circle-color': '#FFFFFF' } },
  { id: 'gl-draw-vertex', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
    paint: { 'circle-radius': 4, 'circle-color': '#1D4ED8' } },
  { id: 'gl-draw-midpoint', type: 'circle', filter: ['all', ['==', 'meta', 'midpoint'], ['==', '$type', 'Point']],
    paint: { 'circle-radius': 3, 'circle-color': '#93C5FD' } },
];

export default function RoofLocatorMap({ center, initialPolygon, onPolygon }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const onPolygonRef = useRef(onPolygon);
  onPolygonRef.current = onPolygon; // dernière closure (évite le stale)

  // Init unique (le composant est remonté via `key` quand le lieu change → pas de tracé fantôme).
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_CONFIG.accessToken || center?.lat == null) return undefined;
    mapboxgl.accessToken = MAPBOX_CONFIG.accessToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [center.lon, center.lat],
      zoom: 19,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      defaultMode: 'draw_polygon',
      styles: DRAW_STYLES,
    });
    map.addControl(draw, 'top-left');
    drawRef.current = draw;

    // Un seul polygone : à chaque nouveau tracé, on supprime les précédents.
    const emitSingle = () => {
      const fc = draw.getAll();
      if (fc.features.length === 0) { onPolygonRef.current?.(null); return; }
      const last = fc.features[fc.features.length - 1];
      fc.features.slice(0, -1).forEach((f) => draw.delete(f.id));
      onPolygonRef.current?.(last);
    };
    const onDelete = () => { if (draw.getAll().features.length === 0) onPolygonRef.current?.(null); };
    map.on('draw.create', emitSingle);
    map.on('draw.update', emitSingle);
    map.on('draw.delete', onDelete);

    // Restauration d'un tracé existant (brouillon rechargé).
    map.on('load', () => {
      if (initialPolygon) {
        draw.add({ type: 'Feature', geometry: initialPolygon, properties: {} });
        draw.changeMode('simple_select');
      }
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; drawRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-80 rounded-lg overflow-hidden border border-secondary-200" />
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-white/90 rounded-md px-2.5 py-1 text-xs font-medium text-secondary-700 pointer-events-none text-center">
        <Pencil className="w-3.5 h-3.5 flex-shrink-0" /> Tracez le contour du toit — cliquez chaque coin, double-clic pour fermer
      </div>
    </div>
  );
}
