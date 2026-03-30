import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_CONFIG } from '@/lib/mapbox';

mapboxgl.accessToken = MAPBOX_CONFIG.accessToken;

function getRankColor(rank) {
  if (rank === null || rank === undefined) return '#6b7280'; // Gris
  if (rank <= 3) return '#22c55e';  // Vert
  if (rank <= 10) return '#f59e0b'; // Orange
  return '#ef4444';                  // Rouge
}

function getRankLabel(rank) {
  if (rank === null || rank === undefined) return '—';
  return String(rank);
}

export default function GeoGridMap({ results, centerLat, centerLng, isLoading }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Init map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_CONFIG.style,
      center: [centerLng || MAPBOX_CONFIG.defaultCenter[0], centerLat || MAPBOX_CONFIG.defaultCenter[1]],
      zoom: 12,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-left');

    map.current.on('load', () => setMapLoaded(true));

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      setMapLoaded(false);
    };
  }, []);

  // Update center when config changes
  useEffect(() => {
    if (!map.current || !centerLat || !centerLng) return;
    map.current.flyTo({ center: [centerLng, centerLat], zoom: 12 });
  }, [centerLat, centerLng]);

  // Render results
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!results?.length) return;

    // Center marker
    const centerEl = document.createElement('div');
    centerEl.style.cssText = 'width:20px;height:20px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);';
    const centerMarker = new mapboxgl.Marker({ element: centerEl })
      .setLngLat([centerLng, centerLat])
      .setPopup(new mapboxgl.Popup({ offset: 10 }).setHTML('<b>Centre du scan</b>'))
      .addTo(map.current);
    markersRef.current.push(centerMarker);

    // Result markers
    results.forEach((point) => {
      const color = getRankColor(point.rank);
      const label = getRankLabel(point.rank);

      const el = document.createElement('div');
      el.style.cssText = `
        width: 32px; height: 32px;
        background: ${color};
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
        color: white; font-size: 11px; font-weight: 700;
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        cursor: pointer;
      `;
      el.textContent = label;

      // Build places list HTML
      const places = point.places || [];
      const placesHtml = places.length > 0
        ? places.map((p) => {
            const bg = p.isYou ? '#dbeafe' : 'transparent';
            const badge = p.isYou ? ' <span style="background:#3b82f6;color:white;font-size:9px;padding:1px 4px;border-radius:3px;margin-left:4px">VOUS</span>' : '';
            return `<div style="display:flex;align-items:baseline;gap:6px;padding:2px 4px;background:${bg};border-radius:3px">
              <span style="font-weight:600;color:#666;min-width:16px">${p.rank}</span>
              <span style="font-size:12px">${p.name}${badge}</span>
            </div>`;
          }).join('')
        : '<div style="color:#999;font-size:12px;padding:4px">Aucun résultat</div>';

      const popup = new mapboxgl.Popup({ offset: 15, maxWidth: '280px' }).setHTML(`
        <div style="font-size:13px">
          <div style="font-weight:700;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #eee">
            Position : ${point.rank !== null && point.rank !== undefined ? '#' + point.rank : 'Absent'}
            <span style="color:#999;font-weight:400;font-size:11px;margin-left:6px">${point.total_results || 0} résultats</span>
          </div>
          <div style="max-height:200px;overflow-y:auto">${placesHtml}</div>
        </div>
      `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([point.lng, point.lat])
        .setPopup(popup)
        .addTo(map.current);

      markersRef.current.push(marker);
    });

    // Fit bounds
    const bounds = new mapboxgl.LngLatBounds();
    results.forEach((p) => bounds.extend([p.lng, p.lat]));
    map.current.fitBounds(bounds, { padding: 40 });
  }, [results, mapLoaded, centerLat, centerLng]);

  return (
    <div className="relative rounded-lg overflow-hidden border">
      <div ref={mapContainer} className="w-full" style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }} />

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-md p-3 text-xs space-y-1.5">
        <div className="font-semibold text-secondary-800 mb-1">Classement</div>
        {[
          { color: '#22c55e', label: 'Top 3' },
          { color: '#f59e0b', label: 'Top 4-10' },
          { color: '#ef4444', label: 'Top 11-20' },
          { color: '#6b7280', label: 'Absent' },
          { color: '#3b82f6', label: 'Centre' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className="w-3.5 h-3.5 rounded-full border border-white shadow-sm flex-shrink-0"
              style={{ background: color }}
            />
            <span className="text-secondary-700">{label}</span>
          </div>
        ))}
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="mt-2 text-sm text-secondary-600">Scan en cours...</p>
          </div>
        </div>
      )}
    </div>
  );
}
