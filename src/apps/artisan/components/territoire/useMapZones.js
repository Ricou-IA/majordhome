/**
 * useMapZones.js
 * Hook pour calculer et cacher les zones isochrones territoriales
 * Utilise l'API Mapbox Isochrone + Turf.js pour le découpage
 */

import { useState, useEffect, useCallback } from 'react';
import * as turf from '@turf/turf';
import { TERRITOIRE_CONFIG } from '@/lib/territoire-config';

const CACHE_KEY = 'mayer-territoire-zones';
const CACHE_TS_KEY = 'mayer-territoire-zones-at';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 jours

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
    return null; // fallback géré par calculateZones
  }

  const data = await res.json();
  return data.features[0];
}

/**
 * Fallback : crée un cercle approximatif quand l'API Isochrone est indisponible
 * 60 min de conduite ≈ 60 km en zone rurale/périurbaine
 */
function createFallbackCircle(lng, lat, minutes) {
  const radiusKm = minutes * 0.9; // ~54 km pour 60 min (vitesse moyenne ~54 km/h)
  return turf.circle([lng, lat], radiusKm, { steps: 64, units: 'kilometers' });
}

/**
 * Découpe un polygone en deux demi-espaces par la bissectrice perpendiculaire
 */
function splitByBisector(polygon, pointA, pointB) {
  if (!polygon) return { sideA: null, sideB: null };

  const mx = (pointA[0] + pointB[0]) / 2;
  const my = (pointA[1] + pointB[1]) / 2;
  const dx = pointB[0] - pointA[0];
  const dy = pointB[1] - pointA[1];
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return { sideA: polygon, sideB: null };

  const S = 12; // degrés — assez grand pour couvrir la zone
  const px = (-dy / len) * S;
  const py = (dx / len) * S;
  const ex = (-dx / len) * S;
  const ey = (-dy / len) * S;

  // Demi-espace côté A (Gaillac)
  const halfA = turf.polygon([[
    [mx + px, my + py],
    [mx - px, my - py],
    [mx - px + ex, my - py + ey],
    [mx + px + ex, my + py + ey],
    [mx + px, my + py],
  ]]);

  // Demi-espace côté B (Pechbonnieu)
  const halfB = turf.polygon([[
    [mx + px, my + py],
    [mx - px, my - py],
    [mx - px - ex, my - py - ey],
    [mx + px - ex, my + py - ey],
    [mx + px, my + py],
  ]]);

  let sideA = null;
  let sideB = null;

  try {
    sideA = turf.intersect(turf.featureCollection([polygon, halfA]));
  } catch (e) {
    console.warn('[useMapZones] intersect sideA error:', e);
  }
  try {
    sideB = turf.intersect(turf.featureCollection([polygon, halfB]));
  } catch (e) {
    console.warn('[useMapZones] intersect sideB error:', e);
  }

  return { sideA, sideB };
}

/**
 * Calcule les zones territoire Gaillac/Pechbonnieu
 */
async function calculateZones(token) {
  const { centers, isochroneMinutes } = TERRITOIRE_CONFIG;

  // 1. Récupérer les deux isochrones en parallèle (avec fallback cercle si 403)
  let [isoG, isoP] = await Promise.all([
    fetchIsochrone(centers.gaillac.lng, centers.gaillac.lat, isochroneMinutes, token),
    fetchIsochrone(centers.pechbonnieu.lng, centers.pechbonnieu.lat, isochroneMinutes, token),
  ]);

  // Fallback : cercles approximatifs si l'API Isochrone est indisponible
  const usedFallback = !isoG || !isoP;
  if (!isoG) {
    isoG = createFallbackCircle(centers.gaillac.lng, centers.gaillac.lat, isochroneMinutes);
  }
  if (!isoP) {
    isoP = createFallbackCircle(centers.pechbonnieu.lng, centers.pechbonnieu.lat, isochroneMinutes);
  }

  // 2. Zones exclusives
  let exclusiveG = null;
  let exclusiveP = null;
  try {
    exclusiveG = turf.difference(turf.featureCollection([isoG, isoP]));
  } catch (e) { console.warn('[useMapZones] diff G:', e); }
  try {
    exclusiveP = turf.difference(turf.featureCollection([isoP, isoG]));
  } catch (e) { console.warn('[useMapZones] diff P:', e); }

  // 3. Zone de chevauchement → découpage par bissectrice
  let overlap = null;
  try {
    overlap = turf.intersect(turf.featureCollection([isoG, isoP]));
  } catch (e) { console.warn('[useMapZones] intersect overlap:', e); }

  const { sideA: overlapG, sideB: overlapP } = splitByBisector(
    overlap,
    [centers.gaillac.lng, centers.gaillac.lat],
    [centers.pechbonnieu.lng, centers.pechbonnieu.lat],
  );

  // 4. Union zones finales
  const partsG = [exclusiveG, overlapG].filter(Boolean);
  const partsP = [exclusiveP, overlapP].filter(Boolean);

  let zoneGaillac = null;
  let zonePechbonnieu = null;

  if (partsG.length === 1) {
    zoneGaillac = partsG[0];
  } else if (partsG.length > 1) {
    try {
      zoneGaillac = turf.union(turf.featureCollection(partsG));
    } catch (e) {
      zoneGaillac = partsG[0];
      console.warn('[useMapZones] union G:', e);
    }
  }

  if (partsP.length === 1) {
    zonePechbonnieu = partsP[0];
  } else if (partsP.length > 1) {
    try {
      zonePechbonnieu = turf.union(turf.featureCollection(partsP));
    } catch (e) {
      zonePechbonnieu = partsP[0];
      console.warn('[useMapZones] union P:', e);
    }
  }

  return {
    zone_gaillac: zoneGaillac,
    zone_pechbonnieu: zonePechbonnieu,
    metadata: {
      computed_at: new Date().toISOString(),
      isochrone_minutes: isochroneMinutes,
      fallback: usedFallback, // true si cercles approximatifs au lieu d'isochrones
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
    } catch (e) {
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
