/**
 * TerritoireMap.jsx
 * Carte interactive Mapbox affichant les zones territoire et points CRM
 *
 * Fonctionnalités :
 * - Zones isochrones des centres de l'organisation (fill + outline)
 * - Points CRM clusterisés par type (client, contrat, lead)
 * - Popup détaillé au clic sur un point
 * - Panneau de filtres flottant
 * - Marqueurs HTML custom pour les centres
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { MAPBOX_CONFIG, getMapDefaultCenter } from '@/lib/mapbox';
import { CRM_POINT_TYPES, CONTRACT_COLOR, getTerritoireCenters } from '@/lib/territoire-config';
import { useOrgSettings } from '@hooks/useOrgSettings';
import MapControls from './MapControls';
import MapPopup from './MapPopup';
import MapSearch from './MapSearch';
import ClientModal from '../clients/ClientModal';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const echapper = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Carte d'un centre : son nom et son adresse (le nom et l'adresse sont saisis par l'entreprise : on les échappe).
function carteDuCentre(center, adresseRepli) {
  const adresse = center.address || adresseRepli || '';
  return `
    <div style="padding: 8px 10px; min-width: 160px; max-width: 240px;">
      <p style="font-weight: 600; font-size: 14px; margin: 0;">${echapper(center.label)}</p>
      ${adresse ? `<p style="font-size: 12px; color: #6b7280; margin: 4px 0 0; line-height: 1.35;">${echapper(adresse)}</p>` : ''}
    </div>
  `;
}

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
  const navigate = useNavigate();
  const { settings: orgSettings } = useOrgSettings();
  const orgCenters = useMemo(() => getTerritoireCenters(orgSettings), [orgSettings]);
  const hasOrgCenters = Object.keys(orgCenters).length > 0;
  // Le siège sans adresse propre (centre enregistré avant) reprend celle de Coordonnées.
  const adresseSiege = [orgSettings?.address, [orgSettings?.postal_code, orgSettings?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  // Couches, sources et écouteurs des zones posés sur la carte (retirés avant chaque nouveau tracé)
  const zoneLayersRef = useRef([]);
  const zoneSourcesRef = useRef([]);
  const zoneHandlersRef = useRef([]);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [visibleTypes, setVisibleTypes] = useState(Object.keys(CRM_POINT_TYPES));
  const [showZones, setShowZones] = useState(true);
  const [focusedPointId, setFocusedPointId] = useState(null);
  const [clientModalId, setClientModalId] = useState(null);
  const [showContractsOnly, setShowContractsOnly] = useState(false);
  const savedViewRef = useRef(null); // Pour restaurer la vue après focus

  // ========================================================================
  // DONNÉES GEOJSON
  // ========================================================================

  const geojsonPoints = useMemo(() => {
    let filtered = points.filter(p => visibleTypes.includes(p.type));

    // Filtre contrats actifs : ne garder que les clients avec contrat
    if (showContractsOnly) {
      filtered = filtered.filter(p => p.type !== 'client' || p.hasContract);
    }

    // Mode focus : n'afficher que le point recherché
    if (focusedPointId) {
      filtered = filtered.filter(p => p.id === focusedPointId);
    }

    return {
      type: 'FeatureCollection',
      features: filtered.map(p => {
        // Clients avec contrat actif → violet, sinon couleur du type
        const color = (p.type === 'client' && p.hasContract)
          ? CONTRACT_COLOR
          : (CRM_POINT_TYPES[p.type]?.color || '#6b7280');

        return {
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
            color,
          },
          geometry: {
            type: 'Point',
            coordinates: [p.lng, p.lat],
          },
        };
      }),
    };
  }, [points, visibleTypes, focusedPointId, showContractsOnly]);

  // ========================================================================
  // INITIALISATION MAP
  // ========================================================================

  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_CONFIG.accessToken) return;

    mapboxgl.accessToken = MAPBOX_CONFIG.accessToken;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_CONFIG.style,
      center: initialCenter || getMapDefaultCenter(orgSettings),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init carte au montage : initialCenter/initialZoom/settings ne servent qu'aux valeurs initiales
  }, []);

  // ========================================================================
  // MARQUEURS CENTRES
  // ========================================================================

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    // Supprimer les anciens marqueurs
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // P0.19 — centres territoriaux depuis settings org (fallback {} si non configuré)
    Object.entries(orgCenters).forEach(([_key, center], index) => {
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
      el.textContent = center.emoji || '📍';

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([center.lng, center.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25, closeButton: false })
            .setHTML(carteDuCentre(center, index === 0 ? adresseSiege : ''))
        )
        .addTo(mapRef.current);

      markersRef.current.push(marker);
    });
  }, [mapLoaded, orgCenters, adresseSiege]);

  // ========================================================================
  // ZONES TERRITOIRE
  // ========================================================================

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    // Nettoyer les couches posées au passage précédent (les centres peuvent avoir changé)
    zoneHandlersRef.current.forEach(({ layerId, type, handler }) => map.off(type, layerId, handler));
    zoneHandlersRef.current = [];
    zoneLayersRef.current.forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    zoneSourcesRef.current.forEach((id) => { if (map.getSource(id)) map.removeSource(id); });
    zoneLayersRef.current = [];
    zoneSourcesRef.current = [];

    if (!zones || !showZones || !hasOrgCenters) return;

    const poserSource = (id, data) => { map.addSource(id, { type: 'geojson', data }); zoneSourcesRef.current.push(id); };
    const poserCouche = (couche) => { map.addLayer(couche); zoneLayersRef.current.push(couche.id); };
    const ecouter = (type, layerId, handler) => { map.on(type, layerId, handler); zoneHandlersRef.current.push({ layerId, type, handler }); };

    // Zone principale (outline pointillé — périmètre global d'intervention)
    if (zones.zone_principale) {
      poserSource('zone-principale', zones.zone_principale);
      poserCouche({
        id: 'zone-principale-line',
        type: 'line',
        source: 'zone-principale',
        paint: {
          'line-color': '#6b7280',
          'line-width': 2,
          'line-dasharray': [4, 3],
          'line-opacity': 0.5,
        },
      });
    }

    // Une zone par centre des réglages (siège puis antennes), à la couleur du centre
    (zones.ordre || []).forEach((key) => {
      const zone = zones.zones?.[key];
      if (!zone) return;
      const couleur = orgCenters[key]?.color || '#64748b';
      const source = `zone-centre-${key}`;
      poserSource(source, zone);
      poserCouche({
        id: `${source}-fill`,
        type: 'fill',
        source,
        paint: { 'fill-color': couleur, 'fill-opacity': 0.12 },
      });
      poserCouche({
        id: `${source}-line`,
        type: 'line',
        source,
        paint: { 'line-color': couleur, 'line-width': 2.5, 'line-opacity': 0.7 },
      });
      ecouter('click', `${source}-fill`, () => onZoneClick?.(key));
      ecouter('mouseenter', `${source}-fill`, () => { map.getCanvas().style.cursor = 'pointer'; });
      ecouter('mouseleave', `${source}-fill`, () => { map.getCanvas().style.cursor = ''; });
    });
  }, [mapLoaded, zones, showZones, onZoneClick, orgCenters, hasOrgCenters]);

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

    // Clusters — taille fixe, couleur unique, support 3 chiffres
    map.addLayer({
      id: 'crm-clusters',
      type: 'circle',
      source: 'crm-points',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#6366f1', // indigo-500 (neutre, mélange client+lead)
        'circle-radius': 22,
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
        'text-size': 12,
        'text-allow-overlap': true,
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
    if (point.type === 'lead') {
      navigate('/pipeline');
    } else {
      setClientModalId(point.id);
    }
  }, [navigate]);

  // Recherche — mode focus : n'afficher que le point sélectionné
  const handleSearchSelect = useCallback((point) => {
    if (!mapRef.current) return;

    // Sauvegarder la vue courante pour la restaurer
    savedViewRef.current = {
      center: mapRef.current.getCenter().toArray(),
      zoom: mapRef.current.getZoom(),
    };

    setFocusedPointId(point.id);
    setSelectedPoint(point);

    mapRef.current.flyTo({
      center: [point.lng, point.lat],
      zoom: 15,
      duration: 1500,
    });
  }, []);

  // Quitter le mode focus — restaurer la vue
  const handleClearFocus = useCallback(() => {
    setFocusedPointId(null);
    setSelectedPoint(null);

    if (mapRef.current && savedViewRef.current) {
      mapRef.current.flyTo({
        center: savedViewRef.current.center,
        zoom: savedViewRef.current.zoom,
        duration: 1000,
      });
      savedViewRef.current = null;
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

      {/* Recherche client */}
      <MapSearch
        points={points}
        onSelect={handleSearchSelect}
        onClear={handleClearFocus}
      />

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
        showContractsOnly={showContractsOnly}
        onToggleContracts={() => {
          setShowContractsOnly(prev => {
            const next = !prev;
            // Activer automatiquement le type Client quand on active le filtre contrats
            if (next && !visibleTypes.includes('client')) {
              setVisibleTypes(v => [...v, 'client']);
            }
            return next;
          });
        }}
      />

      {/* Popup point sélectionné */}
      <MapPopup
        point={selectedPoint}
        onClose={handleClearFocus}
        onViewDetail={handleViewDetail}
      />

      {/* Modale fiche client */}
      <ClientModal
        clientId={clientModalId}
        isOpen={!!clientModalId}
        onClose={() => setClientModalId(null)}
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
