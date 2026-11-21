/**
 * territoire-config.js
 * Configuration des centres territoriaux et paramètres isochrones
 */

// Paramètres du calcul des zones, communs à toutes les organisations. Les CENTRES (siège, antennes)
// ne sont pas ici : ils se saisissent dans Paramètres → Organisation → Territoire
// (`settings.territoire_centers`, 1er = siège).
export const TERRITOIRE_CONFIG = {
  // Étendue par défaut d'un centre ; chaque centre (siège, antenne) règle la sienne
  // (`territoire_centers[clé].minutes`, Paramètres → Organisation → Territoire), lue par `dureeDuCentre`.
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

/** Étendues proposées, en minutes de voiture depuis un centre (60 = maximum de l'API d'isochrones). */
export const DUREES_TERRITOIRE = Object.freeze([15, 20, 30, 45, 60]);

/**
 * Étendue commune de l'organisation, en minutes de voiture : `settings.territoire_minutes` s'il est
 * une des durées proposées, sinon la valeur par défaut. Ne sert plus que de repli à un centre qui
 * n'a pas sa propre étendue (réglage écrit le 2026-11-21, avant l'étendue par centre).
 * @param {Object|null|undefined} settings - core.organizations.settings
 * @returns {number}
 */
export function dureeTerritoire(settings) {
  const minutes = Number(settings?.territoire_minutes);
  return DUREES_TERRITOIRE.includes(minutes) ? minutes : TERRITOIRE_CONFIG.isochroneMinutes;
}

/**
 * Étendue d'un centre (siège ou antenne), en minutes de voiture autour de lui : la sienne
 * (`centre.minutes`) si elle est une des durées proposées, sinon le repli.
 * @param {{ minutes?: number|string }|null|undefined} centre
 * @param {number} [repli] - étendue commune (dureeTerritoire)
 * @returns {number}
 */
export function dureeDuCentre(centre, repli = TERRITOIRE_CONFIG.isochroneMinutes) {
  const minutes = Number(centre?.minutes);
  return DUREES_TERRITOIRE.includes(minutes) ? minutes : repli;
}

/**
 * Empreinte du territoire (clé, position, ordre et étendue des centres) : change dès qu'un centre
 * est ajouté, retiré ou déplacé, ou que son étendue change. Chaîne vide = aucun centre exploitable.
 * L'étendue par défaut n'est pas écrite : les zones déjà calculées restent valables.
 * @param {Object|null|undefined} centers
 * @param {number} [repli] - étendue commune (dureeTerritoire)
 * @returns {string}
 */
export function empreinteCentres(centers, repli = TERRITOIRE_CONFIG.isochroneMinutes) {
  return centresValides(centers).map((c) => {
    const minutes = dureeDuCentre(c, repli);
    return `${c.key}:${c.lat},${c.lng}${minutes === TERRITOIRE_CONFIG.isochroneMinutes ? '' : `@${minutes}`}`;
  }).join('|');
}

/**
 * Côté de `proche` : polygone (GeoJSON) des points plus proches de `proche` que de `autre`, à vol
 * d'oiseau — le demi-plan borné par la médiatrice des deux centres. Sert à partager la partie
 * commune de deux zones quand on n'a pas mieux (contours de codes postaux absents).
 * Calcul plan local (longitudes ramenées à l'échelle des latitudes), suffisant à l'échelle d'une région.
 * @param {{ lat: number, lng: number }} autre
 * @param {{ lat: number, lng: number }} proche
 * @param {number} [portee] - étendue du polygone, en degrés
 * @returns {{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: number[][][] } }|null}
 *   null si les deux centres sont au même endroit
 */
export function demiPlanProche(autre, proche, portee = 8) {
  const k = Math.cos((((autre.lat + proche.lat) / 2) * Math.PI) / 180) || 1;
  const ax = autre.lng * k; const ay = autre.lat;
  const bx = proche.lng * k; const by = proche.lat;
  const dx = bx - ax; const dy = by - ay;
  const n = Math.hypot(dx, dy);
  if (!n) return null;
  const ux = dx / n; const uy = dy / n; // vers `proche`
  const px = -uy; const py = ux; // le long de la médiatrice
  const mx = (ax + bx) / 2; const my = (ay + by) / 2;
  const coin = (s, t) => [(mx + px * s + ux * t) / k, my + py * s + uy * t];
  const anneau = [coin(-portee, 0), coin(portee, 0), coin(portee, portee), coin(-portee, portee), coin(-portee, 0)];
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [anneau] } };
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
