// src/apps/solaire/components/dossier/RoofLocatorMap.jsx
// Vue aérienne (Mapbox satellite) pour que l'utilisateur clique précisément sa toiture.
// Le clic fournit des coordonnées précises à Google Solar (résout l'imprécision GPS/adresse).
import { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MousePointerClick } from 'lucide-react';
import { MAPBOX_CONFIG } from '@/lib/mapbox';

const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

export default function RoofLocatorMap({ center, picked, onPick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick; // toujours la dernière closure (évite le stale onPick)

  // Init unique.
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
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('click', (e) => onPickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recentre quand l'adresse/GPS change.
  useEffect(() => {
    if (mapRef.current && center?.lat != null) {
      mapRef.current.easeTo({ center: [center.lon, center.lat], zoom: 19 });
    }
  }, [center?.lat, center?.lon]);

  // Marqueur sur le point cliqué.
  useEffect(() => {
    if (!mapRef.current) return;
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    if (picked?.lat != null) {
      markerRef.current = new mapboxgl.Marker({ color: '#F5C542' })
        .setLngLat([picked.lon, picked.lat]).addTo(mapRef.current);
    }
  }, [picked?.lat, picked?.lon]);

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-72 rounded-lg overflow-hidden border border-secondary-200" />
      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-white/90 rounded-md px-2.5 py-1 text-xs font-medium text-secondary-700 pointer-events-none">
        <MousePointerClick className="w-3.5 h-3.5" /> Cliquez sur votre toiture
      </div>
    </div>
  );
}
