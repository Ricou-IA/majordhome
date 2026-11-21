/**
 * useMapZones.js
 * Hook pour calculer et cacher les zones isochrones territoriales
 * Utilise l'API Mapbox Isochrone + Matrix + contours CP + Turf.js
 *
 * Deux périmètres par centre (siège, antennes) : intervention (où l'entreprise intervient) et
 * commercial (où son commercial se déplace, borné au périmètre d'intervention de l'entreprise).
 * Les zones commerciales ne se recouvrent pas : une partie commune va au centre le plus proche (par
 * code postal et temps de trajet là où l'on a les contours, à vol d'oiseau ailleurs).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import * as turf from '@turf/turf';
import { TERRITOIRE_CONFIG, getTerritoireCenters, centresValides, empreinteCentres, dureeTerritoire, dureeDuCentre, interventionDuCentre, demiPlanProche } from '@/lib/territoire-config';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { logger } from '@lib/logger';

// P1.9 — clés localStorage suffixées par orgId pour éviter fuite cross-org
// au switch d'organisation (multi-tenant futur).
const CACHE_KEY_BASE = 'territoire-zones-v11';
const CACHE_TS_KEY_BASE = 'territoire-zones-v11-at';
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

const fc = (features) => turf.featureCollection(features);
const intersecter = (a, b) => { try { return turf.intersect(fc([a, b])); } catch { return null; } };
const retirer = (a, b) => { try { return turf.difference(fc([a, b])); } catch { return a; } };
const reunir = (morceaux) => morceaux.filter(Boolean).reduce((acc, m) => {
  if (!acc) return m;
  try { return turf.union(fc([acc, m])); } catch { return acc; }
}, null);

// En dessous, un reste hors contours de codes postaux n'est qu'un liseré de bord : on l'ignore.
const RESTE_MIN_M2 = 1_000_000;

/** Partage à vol d'oiseau : la partie de `commun` plus proche de l'antenne que du siège. */
function partAuPlusProche(commun, siege, antenne) {
  const cote = demiPlanProche(siege, antenne);
  return cote ? intersecter(commun, cote) : null;
}

/**
 * Part de l'antenne dans la partie COMMUNE à sa zone et à celle du siège (les zones ne se
 * recouvrent pas : chaque morceau va au centre le plus proche).
 *   - là où l'on a les contours des codes postaux : code postal par code postal, au centre le plus
 *     rapide en voiture (à égalité ou sans réponse : le siège) ;
 *   - ailleurs : à vol d'oiseau, de part et d'autre de la médiatrice des deux centres.
 * @returns {Promise<Feature|null>}
 */
async function partDAntenneDansLeCommun(commun, siege, antenne, token) {
  const cpData = await fetchPostalCodeContours();
  if (!cpData?.features?.length) return partAuPlusProche(commun, siege, antenne);

  // Codes postaux qui touchent la partie commune
  const cps = [];
  for (const cpFeature of cpData.features) {
    const inter = intersecter(commun, cpFeature);
    if (inter && turf.area(inter) > 1000) { // > 1000 m² pour filtrer le bruit
      cps.push({ clipped: inter, centroid: turf.centroid(cpFeature).geometry.coordinates });
    }
  }
  if (cps.length === 0) return partAuPlusProche(commun, siege, antenne);

  // Temps de trajet de chaque code postal vers le siège et vers l'antenne
  const durations = await fetchDrivingTimesMatrix(
    cps.map((cp) => cp.centroid),
    [[siege.lng, siege.lat], [antenne.lng, antenne.lat]],
    token,
  );
  const morceaux = cps
    .filter((_, i) => (durations[i]?.[1] ?? Infinity) < (durations[i]?.[0] ?? Infinity))
    .map((cp) => cp.clipped);

  // Reste de la partie commune, hors des contours connus : à vol d'oiseau
  const couvert = reunir(cps.map((cp) => cp.clipped));
  const reste = couvert ? retirer(commun, couvert) : null;
  if (reste && turf.area(reste) > RESTE_MIN_M2) {
    const part = partAuPlusProche(reste, siege, antenne);
    if (part) morceaux.push(part);
  }
  return reunir(morceaux);
}

/**
 * Zone d'une antenne : son territoire propre (ce que le siège n'atteint pas) + sa part de la partie
 * commune avec le siège. Une antenne hors de portée du siège garde toute sa zone.
 */
async function zoneDAntenne(isoSiege, isoAntenne, siege, antenne, token) {
  const commun = intersecter(isoAntenne, isoSiege);
  if (!commun) return isoAntenne; // rien de commun avec le siège : un territoire à part

  let propre = retirer(isoAntenne, isoSiege);
  if (propre && turf.area(propre) < RESTE_MIN_M2) propre = null; // liseré de bord
  let part = null;
  try {
    part = await partDAntenneDansLeCommun(commun, siege, antenne, token);
  } catch (e) {
    logger.warn('[useMapZones] Partage par codes postaux échoué, partage à vol d\'oiseau:', e);
    part = partAuPlusProche(commun, siege, antenne);
  }
  const zone = reunir([propre, part]);
  if (!zone || turf.area(zone) < RESTE_MIN_M2) return null; // rien, ou un liseré de bord
  // Lissage du contour (les codes postaux laissent des morceaux). Pas de découpe sur l'isochrone de
  // l'antenne : ses bords se confondent avec ceux de la zone et la découpe la vidait. Un lissage qui
  // perd de la surface est écarté : mieux vaut un contour en morceaux qu'une zone amputée.
  const lissee = cleanupZone(zone, null);
  return lissee && turf.area(lissee) >= turf.area(zone) * 0.95 ? lissee : zone;
}

/**
 * Calcule les zones du territoire à partir des centres des réglages de l'organisation
 * (`settings.territoire_centers`) : le 1er est le siège, les suivants des antennes. Chaque centre a
 * DEUX périmètres (minutes de voiture) :
 *   - intervention : jusqu'où les équipes interviennent depuis ce point. Leur réunion est le
 *     périmètre d'intervention de l'entreprise (`zone_principale`) ; au-delà, un lead est hors zone.
 *     Une agence commerciale seule (0) ne l'étend pas ;
 *   - commercial : jusqu'où son commercial se déplace, BORNÉ au périmètre d'intervention.
 * Les zones commerciales ne se recouvrent pas : ce qu'une antenne partage avec le siège va au plus
 * proche des deux (dans l'ordre des réglages entre antennes), le siège garde le reste.
 *
 * @returns {Promise<{ zones: Object<string, Feature>, ordre: string[], zone_principale: Feature, metadata: Object }|null>}
 */
export async function calculateZones(token, centers, minutesParDefaut = TERRITOIRE_CONFIG.isochroneMinutes) {
  const entrees = centresValides(centers);
  if (entrees.length === 0) return null;
  const [siege, ...antennes] = entrees;
  const commercial = entrees.map((c) => dureeDuCentre(c, minutesParDefaut));
  const intervention = entrees.map((c, i) => interventionDuCentre(c, i === 0, minutesParDefaut));

  // 1. Isochrones, en parallèle (cercle approximatif si l'API ne répond pas). Un centre dont les
  //    deux périmètres sont égaux n'en demande qu'une.
  let usedFallback = false;
  const isochrone = async (c, minutes) => {
    const iso = await fetchIsochrone(c.lng, c.lat, minutes, token);
    if (iso) return iso;
    usedFallback = true;
    return createFallbackCircle(c.lng, c.lat, minutes);
  };
  const isosCommerciales = await Promise.all(entrees.map((c, i) => isochrone(c, commercial[i])));
  const isosIntervention = await Promise.all(entrees.map((c, i) => {
    if (intervention[i] === 0) return null;
    return intervention[i] === commercial[i] ? isosCommerciales[i] : isochrone(c, intervention[i]);
  }));

  // 2. Périmètre d'intervention de l'entreprise
  const perimetre = reunir(isosIntervention);
  if (!perimetre) return null;

  // 3. Périmètre commercial de chaque centre, borné au périmètre d'intervention. Un centre qui
  //    intervient au moins aussi loin que son commercial y est déjà tout entier.
  const isos = isosCommerciales.map((iso, i) => (
    intervention[i] >= commercial[i] ? iso : intersecter(iso, perimetre)
  ));
  const isoSiege = isos[0];

  // 4. Chaque antenne prend sa part, sans recouvrir celles déjà attribuées
  const zones = {};
  let prises = null;
  for (let i = 0; i < antennes.length; i++) {
    if (!isos[i + 1]) continue; // agence hors du périmètre d'intervention : aucune zone
    let zone = isoSiege
      ? await zoneDAntenne(isoSiege, isos[i + 1], siege, antennes[i], token)
      : isos[i + 1];
    if (zone && prises) zone = retirer(zone, prises); // null : antenne entièrement couverte
    if (!zone) continue;
    zones[antennes[i].key] = zone;
    prises = reunir([prises, zone]);
  }

  // 5. Le siège garde le reste de son périmètre commercial
  if (isoSiege) zones[siege.key] = (prises ? retirer(isoSiege, prises) : isoSiege) || isoSiege;

  return {
    zones,
    ordre: entrees.map((c) => c.key),
    zone_principale: perimetre, // contour pointillé : périmètre d'intervention de l'entreprise
    metadata: {
      computed_at: new Date().toISOString(),
      isochrone_minutes: intervention[0],
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
      return calculateZones(mapboxToken, orgCenters, minutes)
        .then(data => {
          if (data) data.metadata.centres = empreinte;
          setZones(data);
          if (data) {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(cacheTsKey, String(Date.now()));
          }
          return data;
        })
        .catch(e => { setError(e.message); return null; })
        .finally(() => setLoading(false));
    }
    setZones(null);
    setLoading(false);
    return Promise.resolve(null);
  }, [mapboxToken, cacheKey, cacheTsKey, orgCenters, minutes, empreinte, aDesCentres]);

  return { zones, isLoading, error, invalidate };
}

export default useMapZones;
