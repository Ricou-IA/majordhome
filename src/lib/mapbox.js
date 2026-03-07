/**
 * mapbox.js
 * Configuration Mapbox GL pour le module Territoire
 */

export const MAPBOX_CONFIG = {
  accessToken: import.meta.env.VITE_MAPBOX_TOKEN || '',
  style: 'mapbox://styles/mapbox/outdoors-v12',
  defaultCenter: [1.8898, 43.9119], // Gaillac
  defaultZoom: 9,
  maxBounds: [
    [0.3, 42.9],  // SW
    [2.9, 44.4],  // NE
  ],
};

export default MAPBOX_CONFIG;
