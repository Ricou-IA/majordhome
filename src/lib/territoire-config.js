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
};

/**
 * Types de points CRM avec styles visuels
 */
export const CRM_POINT_TYPES = {
  client: {
    color: '#10b981', // emerald-500
    label: 'Client',
    icon: 'users',
  },
  client_contrat: {
    color: '#8b5cf6', // violet-500
    label: 'Contrat actif',
    icon: 'file-check',
  },
  lead: {
    color: '#3b82f6', // blue-500
    label: 'Lead',
    icon: 'target',
  },
  intervention: {
    color: '#f97316', // orange-500
    label: 'Intervention',
    icon: 'wrench',
  },
  devis: {
    color: '#eab308', // yellow-500
    label: 'Devis',
    icon: 'file-text',
  },
};

export default TERRITOIRE_CONFIG;
