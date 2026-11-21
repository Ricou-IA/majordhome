/**
 * territoire-config.js
 * Configuration des centres territoriaux et paramètres isochrones
 */

// Paramètres du calcul des zones, communs à toutes les organisations. Les CENTRES (siège, antennes)
// ne sont pas ici : ils se saisissent dans Paramètres → Organisation → Territoire
// (`settings.territoire_centers`, 1er = siège).
export const TERRITOIRE_CONFIG = {
  // Étendue par défaut d'un centre. Chaque centre (siège, antenne) règle ses DEUX périmètres dans
  // Paramètres → Organisation → Territoire : commercial (`territoire_centers[clé].minutes`, lu par
  // `dureeDuCentre`) et intervention (`.intervention_minutes`, lu par `interventionDuCentre`).
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

/** Périmètres d'intervention proposés : 0 = aucun (agence commerciale seulement), sinon comme le commercial. */
export const DUREES_INTERVENTION = Object.freeze([0, ...DUREES_TERRITOIRE]);

/**
 * Périmètre d'INTERVENTION d'un centre, en minutes de voiture : jusqu'où les équipes interviennent
 * depuis ce point. Le périmètre d'intervention de l'entreprise est la réunion de ceux de ses centres.
 *   - valeur du centre (`intervention_minutes`) si elle est proposée ; 0 = le centre n'étend pas le
 *     périmètre (agence commerciale seulement), refusé pour le siège ;
 *   - sinon : le siège intervient aussi loin que son commercial, une antenne n'intervient pas.
 * @param {{ minutes?: number|string, intervention_minutes?: number|string }|null|undefined} centre
 * @param {boolean} estSiege - 1er centre des réglages
 * @param {number} [repli] - étendue commune (dureeTerritoire)
 * @returns {number}
 */
export function interventionDuCentre(centre, estSiege, repli = TERRITOIRE_CONFIG.isochroneMinutes) {
  const brut = centre?.intervention_minutes;
  const minutes = brut === null || brut === undefined || brut === '' ? NaN : Number(brut);
  if (DUREES_INTERVENTION.includes(minutes) && !(estSiege && minutes === 0)) return minutes;
  return estSiege ? dureeDuCentre(centre, repli) : 0;
}

/**
 * Empreinte du territoire (clé, position, ordre et périmètres des centres) : change dès qu'un centre
 * est ajouté, retiré ou déplacé, ou qu'un de ses deux périmètres change. Chaîne vide = aucun centre
 * exploitable.
 * @param {Object|null|undefined} centers
 * @param {number} [repli] - étendue commune (dureeTerritoire)
 * @returns {string}
 */
export function empreinteCentres(centers, repli = TERRITOIRE_CONFIG.isochroneMinutes) {
  return centresValides(centers)
    .map((c, i) => `${c.key}:${c.lat},${c.lng}@${dureeDuCentre(c, repli)}/${interventionDuCentre(c, i === 0, repli)}`)
    .join('|');
}

/** Valeur de `leads.zone` d'un lead situé hors du périmètre d'intervention de l'entreprise. */
export const ZONE_HORS = 'hors_zone';

/** Un lead géocodé hors du périmètre d'intervention (à signaler : l'entreprise n'y intervient pas). */
export function estHorsZone(lead) {
  return lead?.zone === ZONE_HORS;
}

/**
 * Zone d'un point d'après les zones calculées (useMapZones) :
 *   - la clé du centre dont la zone commerciale contient le point (antennes d'abord, siège ensuite) ;
 *   - `ZONE_HORS` s'il est hors du périmètre d'intervention de l'entreprise (`zone_principale`) ;
 *   - `null` s'il est dans le périmètre mais dans la zone d'aucun commercial, ou si les zones sont inconnues.
 * @param {{ zones?: Object, ordre?: string[], zone_principale?: Object }|null} zones
 * @param {(zone: Object) => boolean} contient - le point est-il dans cette zone (GeoJSON) ?
 * @returns {string|null}
 */
export function zoneDuPoint(zones, contient) {
  if (!zones?.zones) return null;
  // Le périmètre d'intervention d'abord : le contour lissé d'une zone commerciale peut en déborder un peu.
  if (zones.zone_principale && !contient(zones.zone_principale)) return ZONE_HORS;
  const [siege, ...antennes] = zones.ordre || [];
  for (const key of [...antennes, siege]) {
    const zone = key ? zones.zones[key] : null;
    if (zone && contient(zone)) return key;
  }
  return null;
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
