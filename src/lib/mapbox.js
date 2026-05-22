/**
 * mapbox.js
 * Configuration Mapbox GL pour le module Territoire
 */

import { getOrgHeadquarters } from './territoire-config';

// Centre géographique de la France métropolitaine (Bourges).
// Utilisé seulement si l'org n'a ni map_default_center ni siège configuré.
const NEUTRAL_FRANCE_CENTER = [2.5, 46.5];

export const MAPBOX_CONFIG = {
  accessToken: import.meta.env.VITE_MAPBOX_TOKEN || '',
  style: 'mapbox://styles/mapbox/outdoors-v12',
  defaultCenter: NEUTRAL_FRANCE_CENTER,  // utilisé seulement en dernier recours
  defaultZoom: 9,
  maxBounds: [
    [0.3, 42.9],  // SW (TODO multi-tenant : à dériver des départements de couverture)
    [2.9, 44.4],  // NE
  ],
};

/**
 * Centre par défaut de la Mapbox, par ordre de priorité :
 *   1. settings.map_default_center (override explicite, cas rare)
 *   2. position du siège (settings.territoire_centers[0])
 *   3. fallback centre France neutre
 *
 * Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §9.2
 */
export function getMapDefaultCenter(settings) {
  const c = settings?.map_default_center;
  if (Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
    return c;
  }
  const hq = getOrgHeadquarters(settings);
  if (hq) return [hq.lng, hq.lat];
  return NEUTRAL_FRANCE_CENTER;
}

export default MAPBOX_CONFIG;
