/**
 * territoire-config.js
 * Configuration des centres territoriaux et paramètres isochrones
 */

export const TERRITOIRE_CONFIG = {
  centers: {
    gaillac: {
      lng: 1.8898,
      lat: 43.9119,
      label: 'Gaillac',
      description: 'Siège Mayer Énergie',
      color: '#f97316', // orange-500
      emoji: '🏢',
    },
    pechbonnieu: {
      lng: 1.4561,
      lat: 43.7111,
      label: 'Pechbonnieu',
      description: 'Michel Rieutord — Commercial',
      color: '#ef4444', // red-500
      emoji: '📍',
    },
  },
  isochroneMinutes: 60,
  departements: ['31', '81', '82'],
  postalCodesUrl: '/data/codes-postaux-31-81-82.geojson',
  matrixBatchSize: 23, // 23 sources + 2 destinations = 25 coords (Mapbox max)
};

/**
 * Types de points CRM avec styles visuels
 * Note : les contrats sont un sous-ensemble des clients (même type, couleur distincte)
 */
export const CRM_POINT_TYPES = {
  client: {
    color: '#10b981', // emerald-500
    label: 'Client',
    icon: 'users',
  },
  lead: {
    color: '#3b82f6', // blue-500
    label: 'Lead',
    icon: 'target',
  },
};

/** Couleur des clients avec contrat actif (distinction visuelle dans la même catégorie) */
export const CONTRACT_COLOR = '#8b5cf6'; // violet-500

export default TERRITOIRE_CONFIG;
