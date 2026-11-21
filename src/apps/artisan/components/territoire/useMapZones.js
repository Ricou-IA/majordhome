/**
 * useMapZones.js
 * Hook pour calculer et cacher les zones isochrones territoriales
 * Utilise l'API Mapbox Isochrone + Matrix + contours CP + Turf.js
 *
 * Algorithme v2 : découpage de l'overlap par codes postaux
 * (le centre le plus rapide en temps de trajet prend le CP)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import * as turf from '@turf/turf';
import { TERRITOIRE_CONFIG, getTerritoireCenters, centresValides, empreinteCentres, dureeTerritoire, dureeDuCentre } from '@/lib/territoire-config';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { logger } from '@lib/logger';

// P1.9 — clés localStorage suffixées par orgId pour éviter fuite cross-org
// au switch d'organisation (multi-tenant futur).
const CACHE_KEY_BASE = 'territoire-zones-v9';
const CACHE_TS_KEY_BASE = 'territoire-zones-v9-at';
const buildCacheKey = (orgId) => `${CACHE_KEY_BASE}:${orgId || 'noorg'}`;
const buildCacheTsKey = (orgId) => `${CACHE_TS_KEY_BASE}:${orgId || 'noorg'}`;
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
    logger.warn(`[useMapZones] Isochrone API ${res.status} — fallback cercle`);
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
    logger.error('[useMapZones] Chargement contours CP échoué:', e);
    return null;
  }
}

/**
 * Appelle l'API Mapbox Matrix pour obtenir les temps de trajet
 * de N origines vers 2 destinations (siège + antenne)
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
        logger.warn(`[useMapZones] Matrix API ${res.status} pour batch ${i}`);
        batch.forEach(() => allDurations.push([null, null]));
        continue;
      }

      const data = await res.json();
      if (data.durations) {
        for (const row of data.durations) {
          allDurations.push(row); // [tempsVersSiege, tempsVersAntenne]
        }
      } else {
        batch.forEach(() => allDurations.push([null, null]));
      }
    } catch (e) {
      logger.warn('[useMapZones] Matrix API erreur:', e);
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
    logger.warn('[useMapZones] cleanupZone échoué:', e);
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
 * @returns {{ zoneP: Feature|null }} - Zone de l'antenne (l'appelant calcule siège = isoG - zoneP)
 */
async function splitOverlapByPostalCodes(overlap, isoG, clippedIsoP, siege, antenne, token) {
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

  // 3. Temps de trajet centroïde → siège vs antenne
  const centroids = overlapCPs.map(cp => cp.centroid);
  const destinations = [
    [siege.lng, siege.lat],
    [antenne.lng, antenne.lat],
  ];

  const durations = await fetchDrivingTimesMatrix(centroids, destinations, token);

  // 4. Assigner chaque CP au centre le plus rapide
  const cpsAntenne = [];

  for (let i = 0; i < overlapCPs.length; i++) {
    const timeToG = durations[i]?.[0] ?? Infinity;
    const timeToP = durations[i]?.[1] ?? Infinity;

    if (timeToP < timeToG) {
      cpsAntenne.push(overlapCPs[i]);
    }
    // Égalité ou erreur → siège (défaut)
  }


  // 5. Construire la zone de l'antenne = exclusive P + CPs assignés à P
  // Zone exclusive de l'antenne = clippedIsoP - overlap
  let exclusiveP = null;
  try {
    exclusiveP = turf.difference(turf.featureCollection([clippedIsoP, overlap]));
  } catch {
    // Pas de zone exclusive (100% overlap)
  }

  // Union de toutes les parts de l'antenne
  const pParts = [
    exclusiveP,
    ...cpsAntenne.map(cp => cp.clipped),
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
      logger.warn('[useMapZones] Union de la zone antenne échouée:', e);
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
 * Zone d'une antenne face au siège : son isochrone, bornée à celle du siège, la partie commune
 * étant partagée code postal par code postal (le centre le plus rapide en voiture prend le CP).
 * Hors des départements dont on a les contours, repli géométrique : l'antenne garde son isochrone.
 */
async function zoneDAntenne(isoSiege, isoAntenne, siege, antenne, token) {
  let clipped = null;
  try {
    clipped = turf.intersect(turf.featureCollection([isoAntenne, isoSiege]));
  } catch (e) {
    logger.warn('[useMapZones] Clip antenne / siège échoué:', e);
    clipped = isoAntenne;
  }
  if (!clipped) return null; // l'antenne est hors de portée du siège : pas de zone commune à partager

  try {
    const { zoneP } = await splitOverlapByPostalCodes(clipped, isoSiege, clipped, siege, antenne, token);
    return cleanupZone(zoneP, isoSiege) || zoneP;
  } catch (e) {
    logger.warn('[useMapZones] Découpe CP échouée, repli géométrique:', e);
    return clipped;
  }
}

/**
 * Calcule les zones du territoire à partir des centres des réglages de l'organisation
 * (`settings.territoire_centers`) : le 1er est le siège, les suivants des antennes.
 *   - siège seul : sa zone est son isochrone ;
 *   - antennes : chacune prend sa part (dans l'ordre des réglages, sans recouvrir une antenne
 *     déjà servie), le siège garde le reste de son isochrone.
 *
 * @returns {Promise<{ zones: Object<string, Feature>, ordre: string[], zone_principale: Feature, metadata: Object }|null>}
 */
async function calculateZones(token, centers, minutesParDefaut = TERRITOIRE_CONFIG.isochroneMinutes) {
  const entrees = centresValides(centers);
  if (entrees.length === 0) return null;
  const [siege, ...antennes] = entrees;
  // Chaque centre a son étendue (minutes de voiture autour de lui)
  const durees = entrees.map((c) => dureeDuCentre(c, minutesParDefaut));
  const isochroneMinutes = durees[0];

  // 1. Isochrones de tous les centres, en parallèle (cercle approximatif si l'API ne répond pas)
  let usedFallback = false;
  const isos = (await Promise.all(
    entrees.map((c, i) => fetchIsochrone(c.lng, c.lat, durees[i], token)),
  )).map((iso, i) => {
    if (iso) return iso;
    usedFallback = true;
    return createFallbackCircle(entrees[i].lng, entrees[i].lat, durees[i]);
  });
  const isoSiege = isos[0];

  // 2. Chaque antenne prend sa part, sans recouvrir celles déjà attribuées
  const zones = {};
  let prises = null;
  for (let i = 0; i < antennes.length; i++) {
    let zone = await zoneDAntenne(isoSiege, isos[i + 1], siege, antennes[i], token);
    if (zone && prises) {
      try {
        zone = turf.difference(turf.featureCollection([zone, prises]));
      } catch (e) {
        logger.warn('[useMapZones] Retrait des antennes précédentes échoué:', e);
      }
    }
    if (!zone) continue;
    zones[antennes[i].key] = zone;
    try {
      prises = prises ? turf.union(turf.featureCollection([prises, zone])) : zone;
    } catch (e) {
      logger.warn('[useMapZones] Union des antennes échouée:', e);
    }
  }

  // 3. Le siège garde le reste de son isochrone
  let zoneSiege = isoSiege;
  if (prises) {
    try {
      zoneSiege = turf.difference(turf.featureCollection([isoSiege, prises])) || isoSiege;
    } catch (e) {
      logger.warn('[useMapZones] Zone du siège : différence échouée:', e);
    }
  }
  zones[siege.key] = zoneSiege;

  return {
    zones,
    ordre: entrees.map((c) => c.key),
    zone_principale: isoSiege, // Pour l'outline pointillé
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
  const { organization } = useAuth();
  const orgId = organization?.id;
  const cacheKey = buildCacheKey(orgId);
  const cacheTsKey = buildCacheTsKey(orgId);
  // Centres du territoire = réglages de l'organisation (Paramètres → Organisation → Territoire).
  // Aucun centre ⇒ aucune zone : la carte montre seulement les points.
  const { settings: orgSettings } = useOrgSettings();
  const orgCenters = useMemo(() => getTerritoireCenters(orgSettings), [orgSettings]);
  // Empreinte des centres : un siège déplacé ou une antenne ajoutée invalide le cache du navigateur.
  // Étendue de chaque centre (minutes de voiture), comprise dans l'empreinte ; `minutes` = repli commun.
  const minutes = dureeTerritoire(orgSettings);
  const empreinte = useMemo(() => empreinteCentres(orgCenters, minutes), [orgCenters, minutes]);
  const aDesCentres = empreinte !== '';

  const [zones, setZones] = useState(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!mapboxToken) {
      setLoading(false);
      setError('Token Mapbox manquant');
      return;
    }

    // Pas de centre dans les réglages : pas de zone (la carte affiche les points seuls).
    if (!aDesCentres) {
      setZones(null);
      setLoading(false);
      return;
    }

    // Vérifier le cache localStorage
    try {
      const cached = localStorage.getItem(cacheKey);
      const cachedAt = localStorage.getItem(cacheTsKey);
      if (cached && cachedAt && Date.now() - Number(cachedAt) < CACHE_TTL) {
        const enCache = JSON.parse(cached);
        if (enCache?.metadata?.centres === empreinte) {
          setZones(enCache);
          setLoading(false);
          return;
        }
      }
    } catch {
      // Cache invalide, on recalcule
    }

    // Calculer les zones
    calculateZones(mapboxToken, orgCenters, minutes)
      .then(data => {
        if (data) data.metadata.centres = empreinte;
        setZones(data);
        try {
          if (data) {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(cacheTsKey, String(Date.now()));
          }
        } catch (e) {
          logger.warn('[useMapZones] Erreur cache localStorage:', e);
        }
      })
      .catch(e => {
        logger.error('[useMapZones] Erreur calcul zones:', e);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [mapboxToken, cacheKey, cacheTsKey, orgCenters, minutes, empreinte, aDesCentres]);

  const invalidate = useCallback(() => {
    localStorage.removeItem(cacheKey);
    localStorage.removeItem(cacheTsKey);
    setLoading(true);
    setError(null);

    if (mapboxToken && aDesCentres) {
      calculateZones(mapboxToken, orgCenters, minutes)
        .then(data => {
          if (data) data.metadata.centres = empreinte;
          setZones(data);
          if (data) {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(cacheTsKey, String(Date.now()));
          }
        })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      setZones(null);
      setLoading(false);
    }
  }, [mapboxToken, cacheKey, cacheTsKey, orgCenters, minutes, empreinte, aDesCentres]);

  return { zones, isLoading, error, invalidate };
}

export default useMapZones;
