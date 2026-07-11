// src/apps/solaire/lib/pvgis.js
// Accès externes de l'app Solaire : edge function pvgis-proxy (PVGIS 1 kWc),
// géocodage data.gouv (CORS OK, direct), géolocalisation device.
import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';

/**
 * Production mensuelle à 1 kWc pour un lieu/toiture donnés.
 * → { data: { e_m: number[12], e_y, params }, error }
 */
export async function fetchPvgis1kwc({ lat, lon, loss, angleDeg, aspect }) {
  try {
    const { data, error } = await supabase.functions.invoke('pvgis-proxy', {
      body: { lat, lon, loss, angle: angleDeg, aspect },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return { data, error: null };
  } catch (err) {
    logger.error('[pvgis] fetchPvgis1kwc', err);
    return { data: null, error: err };
  }
}

/** Autocomplétion adresse via api-adresse.data.gouv.fr → [{ label, lat, lon, city, postcode }]. */
export async function searchAddress(query) {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`api-adresse ${res.status}`);
    const json = await res.json();
    const results = (json.features ?? []).map((f) => ({
      label: f.properties.label,
      city: f.properties.city,
      postcode: f.properties.postcode,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
    return { data: results, error: null };
  } catch (err) {
    logger.error('[pvgis] searchAddress', err);
    return { data: [], error: err };
  }
}

/**
 * Géocodage inverse (lon/lat → adresse) via api-adresse.data.gouv.fr (CORS OK, direct).
 * Sert à renseigner l'adresse après une localisation GPS (le CERFA/terrain en a besoin).
 * → { data: { label, city, postcode } | null, error }
 */
export async function reverseGeocode(lon, lat) {
  try {
    const url = `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`api-adresse reverse ${res.status}`);
    const json = await res.json();
    const f = json.features?.[0];
    if (!f) return { data: null, error: null };
    return {
      data: { label: f.properties.label, city: f.properties.city, postcode: f.properties.postcode },
      error: null,
    };
  } catch (err) {
    logger.error('[pvgis] reverseGeocode', err);
    return { data: null, error: err };
  }
}

/** Position GPS du device → Promise<{ lat, lon, accuracy }>. Rejette si refus/indispo. */
export function getDevicePosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Géolocalisation non disponible sur cet appareil'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => reject(new Error(
        err.code === 1 ? 'Géolocalisation refusée — saisissez une adresse' : 'Position introuvable — saisissez une adresse',
      )),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
