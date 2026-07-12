// src/apps/solaire/components/dossier/RoofLocatorMap.jsx
// Vue aérienne (Mapbox satellite) avec outil de dessin : l'utilisateur trace le contour
// de sa toiture. La surface est calculée depuis le tracé (turf) — indépendant de la
// détection de bâtiment de Google (peu fiable). Le polygone remonte via onPolygon.
import { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import * as turf from '@turf/turf';
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

export default function RoofLocatorMap({ center, initialPolygon, onPolygon, savedPans, selectedPanId, onSelectPan, resetToken }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const onPolygonRef = useRef(onPolygon);
  onPolygonRef.current = onPolygon; // dernière closure (évite le stale)
  const onSelectPanRef = useRef(onSelectPan);
  onSelectPanRef.current = onSelectPan; // dernière closure (évite le stale sur le click handler)

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
      defaultMode: 'simple_select',
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

    // Restauration d'un tracé existant (brouillon rechargé) + sources réactives des pans enregistrés.
    map.on('load', () => {
      if (initialPolygon) {
        draw.add({ type: 'Feature', geometry: initialPolygon, properties: {} });
        draw.changeMode('simple_select');
      }
      // Sources vides créées une fois ; l'effet [savedPans] les alimente ensuite via setData
      // (la carte n'est plus remontée à chaque ajout de pan → rendu réactif).
      map.addSource('saved-pans', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('saved-pan-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'saved-pans-fill', type: 'fill', source: 'saved-pans', paint: { 'fill-color': '#F5C542', 'fill-opacity': 0.35 } });
      map.addLayer({ id: 'saved-pans-line', type: 'line', source: 'saved-pans', paint: { 'line-color': '#B45309', 'line-width': 2 } });
      // Surbrillance du pan sélectionné (contour bleu épais) — filtre initialement vide.
      map.addLayer({
        id: 'saved-pan-highlight',
        type: 'line',
        source: 'saved-pans',
        paint: { 'line-color': '#1D4ED8', 'line-width': 4 },
        filter: ['==', ['get', 'id'], selectedPanId ?? ''],
      });
      map.addLayer({
        id: 'saved-pans-labels',
        type: 'symbol',
        source: 'saved-pan-labels',
        layout: { 'text-field': ['get', 'label'], 'text-size': 14, 'text-allow-overlap': true },
        paint: { 'text-color': '#7C2D12', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 },
      });

      // Sélection d'un pan en cliquant son polygone (ref → pas de stale closure).
      map.on('click', 'saved-pans-fill', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) onSelectPanRef.current?.(id);
      });
      map.on('mouseenter', 'saved-pans-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'saved-pans-fill', () => { map.getCanvas().style.cursor = ''; });
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; drawRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rendu réactif des pans enregistrés : polygones (fill+line) + numéros au centroïde (symbol).
  // Alimente les sources créées au `load` ; attend le style prêt si l'init n'est pas terminée.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const apply = () => {
      const src = map.getSource('saved-pans');
      const labelSrc = map.getSource('saved-pan-labels');
      if (!src || !labelSrc) return; // sources pas encore créées (load pas fini)
      const pans = (savedPans ?? []).filter((p) => p?.polygon);
      src.setData({
        type: 'FeatureCollection',
        features: pans.map((p, i) => ({ type: 'Feature', geometry: p.polygon, properties: { id: p.id, label: String(i + 1) } })),
      });
      labelSrc.setData({
        type: 'FeatureCollection',
        features: pans.map((p, i) => {
          const c = turf.centroid(p.polygon);
          return { type: 'Feature', geometry: c.geometry, properties: { label: String(i + 1) } };
        }),
      });
    };
    if (map.getSource('saved-pans')) apply(); else map.once('load', apply);
    return undefined;
  }, [savedPans]);

  // Surbrillance : met à jour le filtre de la couche highlight sur le pan sélectionné.
  // Attend le load si la couche n'existe pas encore (init pas terminée).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const apply = () => {
      if (!map.getLayer('saved-pan-highlight')) return;
      map.setFilter('saved-pan-highlight', ['==', ['get', 'id'], selectedPanId ?? '']);
    };
    if (map.getLayer('saved-pan-highlight')) apply(); else map.once('load', apply);
    return undefined;
  }, [selectedPanId]);

  // Effacement impératif du tracé en cours après enregistrement d'un pan (sans remonter la carte
  // → la vue/zoom de l'utilisateur est préservée).
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    draw.deleteAll();
    draw.changeMode('simple_select');
  }, [resetToken]);

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-80 lg:h-[480px] xl:h-[560px] rounded-lg overflow-hidden border border-secondary-200" />
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-white/90 rounded-md px-2.5 py-1 text-xs font-medium text-secondary-700 pointer-events-none text-center">
        <Pencil className="w-3.5 h-3.5 flex-shrink-0" /> Cliquez l'outil ▱ (haut-gauche) puis tracez le toit — un clic par coin, double-clic pour fermer
      </div>
    </div>
  );
}
