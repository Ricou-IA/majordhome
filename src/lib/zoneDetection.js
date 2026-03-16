/**
 * zoneDetection.js
 * Détection de zone tarifaire par temps de trajet Mapbox
 * Utilise l'API Directions pour calculer le temps de conduite
 * depuis l'adresse client jusqu'au siège de Gaillac.
 *
 * 3 zones :
 *   - Zone 1 (< 30 min)
 *   - Zone 2 (30–60 min)
 *   - Hors Zone (≥ 60 min)
 */

import { MAPBOX_CONFIG } from '@/lib/mapbox';
import { geocodeAddress } from '@/shared/services/geocoding.service';
import { detectZoneFromPostalCode } from '@/shared/services/pricing.service';

// Coordonnées du siège (Gaillac)
const HQ_LNG = MAPBOX_CONFIG.defaultCenter[0]; // 1.8898
const HQ_LAT = MAPBOX_CONFIG.defaultCenter[1]; // 43.9119

// Cache module-level pour éviter les appels Mapbox redondants
const _drivingCache = new Map();

/**
 * Calcule le temps de trajet en voiture entre des coordonnées et Gaillac
 * @param {number} lat - Latitude client
 * @param {number} lng - Longitude client
 * @returns {Promise<{ durationMinutes: number, distanceKm: number } | null>}
 */
export async function getDrivingDuration(lat, lng) {
  const token = MAPBOX_CONFIG.accessToken;
  if (!token) {
    console.warn('[zoneDetection] Mapbox token non configuré');
    return null;
  }

  // Clé de cache arrondie à ~100m
  const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
  if (_drivingCache.has(cacheKey)) {
    return _drivingCache.get(cacheKey);
  }

  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng},${lat};${HQ_LNG},${HQ_LAT}?overview=false&access_token=${token}`;
    const res = await fetch(url);

    if (!res.ok) {
      console.warn('[zoneDetection] Mapbox Directions error:', res.status);
      return null;
    }

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) {
      console.warn('[zoneDetection] Aucune route trouvée');
      return null;
    }

    const result = {
      durationMinutes: Math.round(route.duration / 60),
      distanceKm: Math.round(route.distance / 1000),
    };

    _drivingCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('[zoneDetection] Erreur Mapbox Directions:', error);
    return null;
  }
}

/**
 * Trouve la zone tarifaire correspondant à un temps de trajet
 * @param {number} durationMinutes
 * @param {Array} zones - Zones depuis pricing_zones (avec min/max_driving_minutes)
 * @returns {object|null} Zone correspondante
 */
export function detectZoneByDuration(durationMinutes, zones) {
  if (!zones?.length || durationMinutes == null) return null;

  const matched = zones.find(
    (z) =>
      z.is_active &&
      z.min_driving_minutes != null &&
      z.max_driving_minutes != null &&
      durationMinutes >= z.min_driving_minutes &&
      durationMinutes < z.max_driving_minutes
  );

  if (matched) return matched;

  // Fallback : zone par défaut
  return zones.find((z) => z.is_default && z.is_active) || null;
}

/**
 * Détecte la zone tarifaire à partir d'une adresse complète
 * Compose : géocodage (api-adresse.data.gouv.fr) + temps trajet (Mapbox) + matching zone
 *
 * @param {string} address - Rue
 * @param {string} postalCode - Code postal
 * @param {string} city - Ville
 * @param {Array} zones - Zones depuis pricing_zones
 * @returns {Promise<{ zone: object|null, durationMinutes: number|null, coords: {lat,lng}|null }>}
 */
export async function detectZoneForAddress(address, postalCode, city, zones) {
  const empty = { zone: null, durationMinutes: null, coords: null };

  if (!postalCode && !city) return empty;

  try {
    // 1. Géocoder l'adresse (API gratuite data.gouv.fr)
    const coords = await geocodeAddress(address, postalCode, city);
    if (!coords) {
      // Fallback département si géocodage échoue
      const fallback = detectZoneFromPostalCode(postalCode, zones);
      return { zone: fallback, durationMinutes: null, coords: null };
    }

    // 2. Temps de trajet Mapbox
    const driving = await getDrivingDuration(coords.lat, coords.lng);
    if (!driving) {
      // Fallback département si Mapbox échoue
      const fallback = detectZoneFromPostalCode(postalCode, zones);
      return { zone: fallback, durationMinutes: null, coords };
    }

    // 3. Matcher la zone par durée
    const zone = detectZoneByDuration(driving.durationMinutes, zones);

    return {
      zone,
      durationMinutes: driving.durationMinutes,
      coords,
    };
  } catch (error) {
    console.error('[zoneDetection] Erreur detectZoneForAddress:', error);
    const fallback = detectZoneFromPostalCode(postalCode, zones);
    return { zone: fallback, durationMinutes: null, coords: null };
  }
}
