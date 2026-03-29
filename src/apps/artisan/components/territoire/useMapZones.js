/**
 * useMapZones.js
 * Hook pour calculer et cacher les zones isochrones territoriales
 * Utilise l'API Mapbox Isochrone + Matrix + contours CP + Turf.js
 *
 * Algorithme v2 : découpage de l'overlap par codes postaux
 * (le centre le plus rapide en temps de trajet prend le CP)
 */

import { useState, useEffect, useCallback } from 'react';
import * as turf from '@turf/turf';
import { TERRITOIRE_CONFIG } from '@/lib/territoire-config';

const CACHE_KEY = 'mayer-territoire-zones-v8';
const CACHE_TS_KEY = 'mayer-territoire-zones-v8-at';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 jours

// ============================================================================
// API HELPERS
// ============================================================================

/**
 * Appel API Mapbox Isochrone
 * Retourne le feature isochrone ou null si indisponible (403 = plan payant requis)
 */
async function fetchIsochrone(lng, lat, minutes, token) {
  const url = `https://api.mapbox.com/isochrone/v1/mapbox/driving/${lng},${lat}`
    + `?contours_minutes=${minutes}&polygons=true&denoise=1&generalize=300`
    + `&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[useMapZones] Isochrone API ${res.status} — fallback cercle`);
    return null;
  }

  const data = await res.json();
  return data.features[0];
}

/**
 * Fallback : crée un cercle approximatif quand l'API Isochrone est indisponible
 * 60 min de conduite ≈ 54 km en zone rurale/périurbaine
 */
function createFallbackCircle(lng, lat, minutes) {
  const radiusKm = minutes * 0.9;
  return turf.circle([lng, lat], radiusKm, { steps: 64, units: 'kilometers' });
}

/**
 * Cache module-level pour le GeoJSON des codes postaux
 */
let _postalCodesCache = null;

/**
 * Charge les contours des codes postaux depuis le fichier statique
 */
async function fetchPostalCodeContours() {
  if (_postalCodesCache) return _postalCodesCache;

  try {
    const res = await fetch(TERRITOIRE_CONFIG.postalCodesUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _postalCodesCache = await res.json();
    return _postalCodesCache;
  } catch (e) {
    console.error('[useMapZones] Chargement contours CP échoué:', e);
    return null;
  }
}

/**
 * Appelle l'API Mapbox Matrix pour obtenir les temps de trajet
 * de N origines vers 2 destinations (Gaillac + Pechbonnieu)
 *
 * @param {number[][]} origins - [[lng, lat], ...] centroides des CP
 * @param {number[][]} destinations - [[lng, lat], [lng, lat]] les 2 centres
 * @param {string} token - Mapbox access token
 * @returns {number[][]} - [[dureeVersG, dureeVersP], ...] en secondes (null si erreur)
 */
async function fetchDrivingTimesMatrix(origins, destinations, token) {
  const BATCH_SIZE = TERRITOIRE_CONFIG.matrixBatchSize;
  const allDurations = [];

  for (let i = 0; i < origins.length; i += BATCH_SIZE) {
    const batch = origins.slice(i, i + BATCH_SIZE);

    // Format coords : destinations d'abord (index 0,1), puis origines (index 2..N)
    const coords = [...destinations, ...batch]
      .map(c => `${c[0]},${c[1]}`)
      .join(';');

    const destIndexes = destinations.map((_, idx) => idx).join(';');
    const srcIndexes = batch.map((_, idx) => idx + destinations.length).join(';');

    const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}`
      + `?destinations=${destIndexes}&sources=${srcIndexes}`
      + `&access_token=${token}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[useMapZones] Matrix API ${res.status} pour batch ${i}`);
        batch.forEach(() => allDurations.push([null, null]));
        continue;
      }

      const data = await res.json();
      if (data.durations) {
        for (const row of data.durations) {
          allDurations.push(row); // [tempsVersGaillac, tempsVersPechbonnieu]
        }
      } else {
        batch.forEach(() => allDurations.push([null, null]));
      }
    } catch (e) {
      console.warn('[useMapZones] Matrix API erreur:', e);
      batch.forEach(() => allDurations.push([null, null]));
    }

    // Respecter le rate limit (30 req/min)
    if (i + BATCH_SIZE < origins.length) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  return allDurations;
}

// ============================================================================
// NETTOYAGE GÉOMÉTRIE
// ============================================================================

/**
 * Fusionne un MultiPolygon (union de CP) en un seul Polygon propre.
 * 1. Extrait les polygones individuels
 * 2. Buffer +500m chacun (pour créer des overlaps aux gaps)
 * 3. Union progressive pour tout fusionner en un bloc
 * 4. Buffer -500m pour revenir à la taille originale
 * 5. Clip à la zone principale + simplification
 */
function cleanupZone(zone, clipTo) {
  if (!zone) return null;
  try {
    const geom = zone.geometry || zone;

    // Si c'est déjà un Polygon simple, juste simplifier
    if (geom.type === 'Polygon') {
      let cleaned = turf.simplify(zone, { tolerance: 0.001, highQuality: true });
      return cleaned || zone;
    }

    // Extraire les polygones individuels du MultiPolygon
    if (geom.type !== 'MultiPolygon') return zone;
    const polygons = geom.coordinates.map(coords => turf.polygon(coords));
    if (polygons.length <= 1) return zone;


    // Buffer +500m chaque polygone pour créer des overlaps
    const buffered = polygons
      .map(p => { try { return turf.buffer(p, 0.5, { units: 'kilometers' }); } catch { return null; } })
      .filter(Boolean);
    if (buffered.length === 0) return zone;

    // Union progressive pour fusionner les polygones qui se touchent
    let merged = buffered[0];
    for (let i = 1; i < buffered.length; i++) {
      try {
        merged = turf.union(turf.featureCollection([merged, buffered[i]]));
      } catch { /* skip */ }
    }

    // Éroder de 500m pour revenir à la taille originale
    merged = turf.buffer(merged, -0.5, { units: 'kilometers' });
    if (!merged) return zone;

    // Clipper à la zone principale
    if (clipTo) {
      try { merged = turf.intersect(turf.featureCollection([merged, clipTo])); } catch { /* ok */ }
    }
    if (!merged) return zone;

    // Simplifier
    merged = turf.simplify(merged, { tolerance: 0.001, highQuality: true });

    return merged || zone;
  } catch (e) {
    console.warn('[useMapZones] cleanupZone échoué:', e);
    return zone;
  }
}

// ============================================================================
// ALGORITHME DE ZONES
// ============================================================================

/**
 * Découpe la zone d'overlap en utilisant les contours des codes postaux.
 * Chaque CP est assigné au centre le plus rapide en temps de trajet.
 *
 * @returns {{ zoneP: Feature|null }} - Zone Pechbonnieu (l'appelant calcule G = isoG - zoneP)
 */
async function splitOverlapByPostalCodes(overlap, isoG, clippedIsoP, centers, token) {
  // 1. Charger les contours CP
  const cpData = await fetchPostalCodeContours();
  if (!cpData || !cpData.features.length) {
    throw new Error('Données codes postaux indisponibles');
  }

  // 2. Trouver les CP qui intersectent l'overlap
  const overlapCPs = [];
  for (const cpFeature of cpData.features) {
    try {
      const inter = turf.intersect(turf.featureCollection([overlap, cpFeature]));
      if (inter && turf.area(inter) > 1000) { // > 1000 m² pour filtrer le bruit
        overlapCPs.push({
          feature: cpFeature,
          clipped: inter,
          centroid: turf.centroid(cpFeature).geometry.coordinates,
          postalCode: cpFeature.properties.postal_code,
        });
      }
    } catch {
      // Géométrie invalide, on skip
    }
  }


  if (overlapCPs.length === 0) {
    return { zoneP: clippedIsoP };
  }

  // 3. Temps de trajet centroïde → Gaillac vs Pechbonnieu
  const centroids = overlapCPs.map(cp => cp.centroid);
  const destinations = [
    [centers.gaillac.lng, centers.gaillac.lat],
    [centers.pechbonnieu.lng, centers.pechbonnieu.lat],
  ];

  const durations = await fetchDrivingTimesMatrix(centroids, destinations, token);

  // 4. Assigner chaque CP au centre le plus rapide
  const pechbonnieuCPs = [];

  for (let i = 0; i < overlapCPs.length; i++) {
    const timeToG = durations[i]?.[0] ?? Infinity;
    const timeToP = durations[i]?.[1] ?? Infinity;

    if (timeToP < timeToG) {
      pechbonnieuCPs.push(overlapCPs[i]);
    }
    // Égalité ou erreur → Gaillac (siège, défaut)
  }


  // 5. Construire la zone Pechbonnieu = exclusive P + CPs assignés à P
  // Zone exclusive Pechbonnieu = clippedIsoP - overlap
  let exclusiveP = null;
  try {
    exclusiveP = turf.difference(turf.featureCollection([clippedIsoP, overlap]));
  } catch {
    // Pas de zone exclusive (100% overlap)
  }

  // Union de toutes les parts Pechbonnieu
  const pParts = [
    exclusiveP,
    ...pechbonnieuCPs.map(cp => cp.clipped),
  ].filter(Boolean);

  let zoneP = null;
  if (pParts.length === 1) {
    zoneP = pParts[0];
  } else if (pParts.length > 1) {
    try {
      zoneP = pParts.reduce((acc, part) => {
        if (!acc) return part;
        try {
          return turf.union(turf.featureCollection([acc, part]));
        } catch {
          return acc;
        }
      }, null);
    } catch (e) {
      console.warn('[useMapZones] Union zone Pechbonnieu échouée:', e);
      zoneP = pParts[0];
    }
  }

  // Clipper la zone P finale à la zone principale (isoG)
  if (zoneP) {
    try {
      zoneP = turf.intersect(turf.featureCollection([zoneP, isoG]));
    } catch {
      // Garder tel quel
    }
  }

  return { zoneP };
}

/**
 * Calcule les zones territoire Gaillac/Pechbonnieu
 * v2 : découpage par codes postaux au lieu de la bissectrice
 */
async function calculateZones(token) {
  const { centers, isochroneMinutes } = TERRITOIRE_CONFIG;

  // 1. Récupérer les deux isochrones en parallèle
  let [isoG, isoP] = await Promise.all([
    fetchIsochrone(centers.gaillac.lng, centers.gaillac.lat, isochroneMinutes, token),
    fetchIsochrone(centers.pechbonnieu.lng, centers.pechbonnieu.lat, isochroneMinutes, token),
  ]);

  const usedFallback = !isoG || !isoP;
  if (!isoG) {
    isoG = createFallbackCircle(centers.gaillac.lng, centers.gaillac.lat, isochroneMinutes);
  }
  if (!isoP) {
    isoP = createFallbackCircle(centers.pechbonnieu.lng, centers.pechbonnieu.lat, isochroneMinutes);
  }

  // 2. Clipper l'isochrone Pechbonnieu à la zone principale (Gaillac)
  let clippedIsoP = null;
  try {
    clippedIsoP = turf.intersect(turf.featureCollection([isoP, isoG]));
  } catch (e) {
    console.warn('[useMapZones] Clip isoP à isoG échoué:', e);
    clippedIsoP = isoP; // fallback
  }

  // 3. Calculer l'overlap entre isoG et clippedIsoP
  let overlap = null;
  try {
    overlap = turf.intersect(turf.featureCollection([isoG, clippedIsoP]));
  } catch (e) {
    console.warn('[useMapZones] Calcul overlap échoué:', e);
  }

  // 4. Découper l'overlap par codes postaux
  let zoneGaillac = null;
  let zonePechbonnieu = null;

  if (overlap && clippedIsoP) {
    try {
      const { zoneP } = await splitOverlapByPostalCodes(
        overlap, isoG, clippedIsoP, centers, token,
      );

      // 5. Nettoyer Pechbonnieu d'abord (fusion des CP en un seul polygone)
      zonePechbonnieu = cleanupZone(zoneP, isoG) || zoneP;

      // 6. Gaillac = isoG - Pechbonnieu nettoyé → contour propre automatiquement
      if (zonePechbonnieu) {
        try {
          zoneGaillac = turf.difference(turf.featureCollection([isoG, zonePechbonnieu]));
        } catch (e) {
          console.warn('[useMapZones] diff isoG - zoneP échoué:', e);
          zoneGaillac = isoG;
        }
      } else {
        zoneGaillac = isoG;
      }
    } catch (e) {
      console.warn('[useMapZones] Découpe CP échouée, fallback géométrique:', e);
      zonePechbonnieu = clippedIsoP;
      try {
        zoneGaillac = turf.difference(turf.featureCollection([isoG, clippedIsoP]));
      } catch {
        zoneGaillac = isoG;
      }
    }
  } else {
    zoneGaillac = isoG;
    zonePechbonnieu = clippedIsoP;
  }

  return {
    zone_gaillac: zoneGaillac,
    zone_pechbonnieu: zonePechbonnieu,
    zone_principale: isoG, // Pour l'outline pointillé
    metadata: {
      computed_at: new Date().toISOString(),
      isochrone_minutes: isochroneMinutes,
      fallback: usedFallback,
    },
  };
}

// ============================================================================
// HOOK
// ============================================================================

export function useMapZones(mapboxToken) {
  const [zones, setZones] = useState(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!mapboxToken) {
      setLoading(false);
      setError('Token Mapbox manquant');
      return;
    }

    // Vérifier le cache localStorage
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const cachedAt = localStorage.getItem(CACHE_TS_KEY);
      if (cached && cachedAt && Date.now() - Number(cachedAt) < CACHE_TTL) {
        setZones(JSON.parse(cached));
        setLoading(false);
        return;
      }
    } catch {
      // Cache invalide, on recalcule
    }

    // Calculer les zones
    calculateZones(mapboxToken)
      .then(data => {
        setZones(data);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
          localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
        } catch (e) {
          console.warn('[useMapZones] Erreur cache localStorage:', e);
        }
      })
      .catch(e => {
        console.error('[useMapZones] Erreur calcul zones:', e);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [mapboxToken]);

  const invalidate = useCallback(() => {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TS_KEY);
    setLoading(true);
    setError(null);

    if (mapboxToken) {
      calculateZones(mapboxToken)
        .then(data => {
          setZones(data);
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
          localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
        })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [mapboxToken]);

  return { zones, isLoading, error, invalidate };
}

export default useMapZones;
