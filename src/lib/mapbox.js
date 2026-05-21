/**
 * mapbox.js
 * Configuration Mapbox GL pour le module Territoire
 */

export const MAPBOX_CONFIG = {
  accessToken: import.meta.env.VITE_MAPBOX_TOKEN || '',
  style: 'mapbox://styles/mapbox/outdoors-v12',
  defaultCenter: [1.8898, 43.9119], // Gaillac (fallback Mayer)
  defaultZoom: 9,
  maxBounds: [
    [0.3, 42.9],  // SW
    [2.9, 44.4],  // NE
  ],
};

/**
 * P0.19 — Multi-tenant : retourne le centre de carte par défaut depuis les
 * settings de l'organisation. Fallback Mayer si non configuré.
 */
export function getMapDefaultCenter(settings) {
  const c = settings?.map_default_center;
  if (Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
    return c;
  }
  return MAPBOX_CONFIG.defaultCenter;
}

export default MAPBOX_CONFIG;
