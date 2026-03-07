/**
 * TerritoireMap.jsx
 * Carte interactive Mapbox affichant les zones territoire et points CRM
 *
 * Fonctionnalités :
 * - Zones isochrones Gaillac / Pechbonnieu (fill + outline)
 * - Points CRM clusterisés par type (client, contrat, lead)
 * - Popup détaillé au clic sur un point
 * - Panneau de filtres flottant
 * - Marqueurs HTML custom pour les centres
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { MAPBOX_CONFIG } from '@/lib/mapbox';
import { TERRITOIRE_CONFIG, CRM_POINT_TYPES } from '@/lib/territoire-config';
import MapControls from './MapControls';
import MapPopup from './MapPopup';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function TerritoireMap({
  points = [],
  zones = null,
  zonesLoading = false,
  onInvalidateZones,
  stats = null,
  height = '600px',
  className = '',
  onPointClick,
  onZoneClick,
  initialCenter,
  initialZoom = 9,
}) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [visibleTypes, setVisibleTypes] = useState(Object.keys(CRM_POINT_TYPES));
  const [showZones, setShowZones] = useState(true);

  // ========================================================================
  // DONNÉES GEOJSON
  // ========================================================================

  const geojsonPoints = useMemo(() => {
    const filtered = points.filter(p => visibleTypes.includes(p.type));
    return {
      type: 'FeatureCollection',
      features: filtered.map(p => ({
        type: 'Feature',
        properties: {
          id: p.id,
          type: p.type,
          label: p.label,
          city: p.city || '',
          postalCode: p.postalCode || '',
          phone: p.phone || '',
          email: p.email || '',
          clientNumber: p.clientNumber || '',
          hasContract: p.hasContract || false,
          amount: p.amount || 0,
          status: p.status || '',
          color: CRM_POINT_TYPES[p.type]?.color || '#6b7280',
        },
        geometry: {
          type: 'Point',
          coordinates: [p.lng, p.lat],
        },
      })),
    };
  }, [points, visibleTypes]);

  // ========================================================================
  // INITIALISATION MAP
  // ========================================================================

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_CONFIG.accessToken) return;

    mapboxgl.accessToken = MAPBOX_CONFIG.accessToken;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_CONFIG.style,
      center: initialCenter || MAPBOX_CONFIG.defaultCenter,
      zoom: initialZoom,
      maxBounds: MAPBOX_CONFIG.maxBounds,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-left');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      mapRef.current = map;
      setMapLoaded(true);
    });

    return () => {
      // Cleanup markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // ========================================================================
  // MARQUEURS CENTRES
  // ========================================================================

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    // Supprimer les anciens marqueurs
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const { centers } = TERRITOIRE_CONFIG;

    Object.entries(centers).forEach(([key, center]) => {
      // Créer l'élément HTML du marqueur
      const el = document.createElement('div');
      el.className = 'territoire-center-marker';
      el.style.cssText = `
        width: 36px; height: 36px;
        background: ${center.color};
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        cursor: pointer;
      `;
      el.textContent = center.emoji;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([center.lng, center.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25, closeButton: false })
            .setHTML(`
              <div style="padding: 8px;">
                <p style="font-weight: 600; font-size: 14px; margin: 0 0 4px;">${center.label}</p>
                <p style="font-size: 12px; color: #6b7280; margin: 0;">${center.description}</p>
              </div>
            `)
        )
        .addTo(mapRef.current);

      markersRef.current.push(marker);
    });
  }, [mapLoaded]);

  // ========================================================================
  // ZONES TERRITOIRE
  // ========================================================================

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    // Nettoyer les anciennes couches
    ['zone-gaillac-fill', 'zone-gaillac-line', 'zone-pechbonnieu-fill', 'zone-pechbonnieu-line'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    ['zone-gaillac', 'zone-pechbonnieu'].forEach(id => {
      if (map.getSource(id)) map.removeSource(id);
    });

    if (!zones || !showZones) return;

    const { centers } = TERRITOIRE_CONFIG;

    // Zone Gaillac
    if (zones.zone_gaillac) {
      map.addSource('zone-gaillac', {
        type: 'geojson',
        data: zones.zone_gaillac,
      });
      map.addLayer({
        id: 'zone-gaillac-fill',
        type: 'fill',
        source: 'zone-gaillac',
        paint: {
          'fill-color': centers.gaillac.color,
          'fill-opacity': 0.12,
        },
      });
      map.addLayer({
        id: 'zone-gaillac-line',
        type: 'line',
        source: 'zone-gaillac',
        paint: {
          'line-color': centers.gaillac.color,
          'line-width': 2.5,
          'line-opacity': 0.7,
        },
      });
    }

    // Zone Pechbonnieu
    if (zones.zone_pechbonnieu) {
      map.addSource('zone-pechbonnieu', {
        type: 'geojson',
        data: zones.zone_pechbonnieu,
      });
      map.addLayer({
        id: 'zone-pechbonnieu-fill',
        type: 'fill',
        source: 'zone-pechbonnieu',
        paint: {
          'fill-color': centers.pechbonnieu.color,
          'fill-opacity': 0.12,
        },
      });
      map.addLayer({
        id: 'zone-pechbonnieu-line',
        type: 'line',
        source: 'zone-pechbonnieu',
        paint: {
          'line-color': centers.pechbonnieu.color,
          'line-width': 2.5,
          'line-opacity': 0.7,
        },
      });
    }

    // Click sur zone
    ['zone-gaillac-fill', 'zone-pechbonnieu-fill'].forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.on('click', layerId, () => {
          const zone = layerId.includes('gaillac') ? 'gaillac' : 'pechbonnieu';
          onZoneClick?.(zone);
        });
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = '';
        });
      }
    });
  }, [mapLoaded, zones, showZones, onZoneClick]);

  // ========================================================================
  // POINTS CRM (CLUSTERS)
  // ========================================================================

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    // Nettoyer
    ['crm-points-layer', 'crm-clusters', 'crm-cluster-count'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('crm-points')) map.removeSource('crm-points');

    if (geojsonPoints.features.length === 0) return;

    // Source avec clustering
    map.addSource('crm-points', {
      type: 'geojson',
      data: geojsonPoints,
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 50,
    });

    // Clusters
    map.addLayer({
      id: 'crm-clusters',
      type: 'circle',
      source: 'crm-points',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#f97316', // orange < 10
          10, '#ea580c', // dark orange < 50
          50, '#c2410c', // darker > 50
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          18,
          10, 24,
          50, 32,
        ],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
      },
    });

    // Cluster count label
    map.addLayer({
      id: 'crm-cluster-count',
      type: 'symbol',
      source: 'crm-points',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 13,
      },
      paint: {
        'text-color': '#ffffff',
      },
    });

    // Points individuels
    map.addLayer({
      id: 'crm-points-layer',
      type: 'circle',
      source: 'crm-points',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 7,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // Interactions clusters
    map.on('click', 'crm-clusters', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['crm-clusters'] });
      if (!features.length) return;

      const clusterId = features[0].properties.cluster_id;
      map.getSource('crm-points').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({
          center: features[0].geometry.coordinates,
          zoom: zoom,
        });
      });
    });

    // Interactions points
    map.on('click', 'crm-points-layer', (e) => {
      if (!e.features?.length) return;

      const feature = e.features[0];
      const props = feature.properties;
      const [lng, lat] = feature.geometry.coordinates;

      const point = {
        id: props.id,
        type: props.type,
        label: props.label,
        city: props.city,
        postalCode: props.postalCode,
        phone: props.phone,
        email: props.email,
        clientNumber: props.clientNumber,
        hasContract: props.hasContract === true || props.hasContract === 'true',
        amount: props.amount ? Number(props.amount) : undefined,
        status: props.status,
        lat,
        lng,
      };

      setSelectedPoint(point);
      onPointClick?.(point);
    });

    // Curseurs
    map.on('mouseenter', 'crm-clusters', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'crm-clusters', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', 'crm-points-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'crm-points-layer', () => {
      map.getCanvas().style.cursor = '';
    });
  }, [mapLoaded, geojsonPoints, onPointClick]);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleToggleType = useCallback((type) => {
    setVisibleTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  }, []);

  const handleViewDetail = useCallback((point) => {
    // Naviguer vers la fiche client (ou lead)
    if (point.type === 'lead') {
      window.location.href = `/pipeline/leads/${point.id}`;
    } else {
      // Clients — utiliser le project_id ou client_id
      window.location.href = `/clients?selected=${point.id}`;
    }
  }, []);

  // ========================================================================
  // RENDER
  // ========================================================================

  if (!MAPBOX_CONFIG.accessToken) {
    return (
      <div
        className={`bg-secondary-100 rounded-xl flex items-center justify-center ${className}`}
        style={{ height }}
      >
        <div className="text-center text-secondary-500 p-6">
          <MapPinIcon className="w-12 h-12 mx-auto mb-3 text-secondary-300" />
          <p className="font-medium">Token Mapbox manquant</p>
          <p className="text-sm mt-1">
            Ajoutez <code className="bg-secondary-200 px-1 rounded">VITE_MAPBOX_TOKEN</code> dans votre fichier .env
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative rounded-xl overflow-hidden border border-secondary-200 ${className}`} style={{ height }}>
      {/* Carte Mapbox */}
      <div ref={mapContainer} className="w-full h-full" />

      {/* Panneau de contrôle */}
      <MapControls
        points={points}
        visibleTypes={visibleTypes}
        onToggleType={handleToggleType}
        showZones={showZones}
        onToggleZones={() => setShowZones(prev => !prev)}
        zonesLoading={zonesLoading}
        onRecalculateZones={onInvalidateZones}
        stats={stats}
      />

      {/* Popup point sélectionné */}
      <MapPopup
        point={selectedPoint}
        onClose={() => setSelectedPoint(null)}
        onViewDetail={handleViewDetail}
      />

      {/* Loading overlay */}
      {zonesLoading && (
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-30 pointer-events-none">
          <div className="bg-white rounded-lg shadow-lg px-4 py-3 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-secondary-600">Calcul des zones...</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MapPinIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  );
}
