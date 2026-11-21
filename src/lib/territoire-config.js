/**
 * territoire-config.js
 * Configuration des centres territoriaux et paramètres isochrones
 */

// Paramètres du calcul des zones, communs à toutes les organisations. Les CENTRES (siège, antennes)
// ne sont pas ici : ils se saisissent dans Paramètres → Organisation → Territoire
// (`settings.territoire_centers`, 1er = siège).
export const TERRITOIRE_CONFIG = {
  isochroneMinutes: 60,
  // Contours des codes postaux connus (partage fin d'une zone commune entre siège et antenne).
  // Ailleurs, le partage se fait par les isochrones seules.
  postalCodesUrl: '/data/codes-postaux-31-81-82.geojson',
  matrixBatchSize: 23, // 23 sources + 2 destinations = 25 coords (Mapbox max)
};

/**
 * Centres exploitables d'une organisation, dans l'ordre des réglages (le 1er est le siège) :
 * seuls ceux qui ont des coordonnées. Chaque entrée porte sa clé.
 * @param {Object|null|undefined} centers - `settings.territoire_centers`
 * @returns {Array<{ key: string, lat: number, lng: number, label?: string, color?: string }>}
 */
export function centresValides(centers) {
  if (!centers || typeof centers !== 'object') return [];
  return Object.entries(centers)
    .filter(([, c]) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map(([key, c]) => ({ ...c, key }));
}

/**
 * Empreinte des centres (clé, position, ordre) : change dès qu'un centre est ajouté, retiré ou
 * déplacé. Chaîne vide = aucun centre exploitable.
 * @param {Object|null|undefined} centers
 * @returns {string}
 */
export function empreinteCentres(centers) {
  return centresValides(centers).map((c) => `${c.key}:${c.lat},${c.lng}`).join('|');
}

/**
 * P0.19 — Multi-tenant : retourne les centres territoriaux depuis les settings
 * de l'organisation.
 *
 * Pas de fallback Mayer : si l'org n'a pas configuré ses centres, on retourne
 * un objet vide. Le composant TerritoireMap n'affiche alors aucune zone
 * (et aucun marker de centre). Évite la fuite cross-org où Cimaj voyait les
 * zones d'une autre entreprise (bug 2026-05-21).
 *
 * Mayer a ses centres backfillés dans `core.organizations.settings.territoire_centers`
 * depuis la migration P0.13.
 *
 * @param {Object|null} settings - core.organizations.settings
 * @returns {Object} Map des centres ({} si non configurés)
 */
export function getTerritoireCenters(settings) {
  const custom = settings?.territoire_centers;
  if (custom && typeof custom === 'object' && Object.keys(custom).length > 0) {
    return custom;
  }
  return {};
}

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

/**
 * P0.19 — Retourne les coordonnées + label du siège de l'org pour les calculs
 * de temps de trajet (zoneDetection, ChantierModal "X min · Y km depuis Z").
 *
 * Heuristique : 1ᵉʳ centre dans `settings.territoire_centers` (en pratique,
 * le siège est listé en 1ᵉʳ). Si pas de centres
 * configurés, retourne null → l'UI doit cacher l'affichage "depuis X".
 *
 * @param {Object|null} settings - core.organizations.settings
 * @returns {{ lat: number, lng: number, label: string } | null}
 */
export function getOrgHeadquarters(settings) {
  const centers = settings?.territoire_centers;
  if (!centers || typeof centers !== 'object') return null;
  const first = Object.values(centers)[0];
  if (!first || typeof first.lat !== 'number' || typeof first.lng !== 'number') return null;
  return {
    lat: first.lat,
    lng: first.lng,
    label: first.label || 'siège',
  };
}

export default TERRITOIRE_CONFIG;
