/**
 * feuilleDeRoute.js — Feuille de route d'une journée de technicien (module PUR).
 * ============================================================================
 * La liste des interventions du jour dans l'ordre horaire et l'itinéraire
 * dépôt → arrêts → dépôt, avec le trajet avant chaque arrêt et les totaux.
 * Source unique de l'écran (panneau journée du Planning) ET du PDF imprimé en
 * vue Jour : le PDF ne recalcule rien, il lit `buildFeuilleDeRoute`.
 *
 * Règles :
 *   - L'ordre est celui du PLANNING (heure de début), jamais un ordre « optimal »
 *     recalculé : la feuille dit ce qui est posé, pas ce qu'on aurait pu poser.
 *   - Congés, annulés et absents exclus (rien à visiter).
 *   - Un arrêt sans coordonnées reste dans la liste (`localise: false`) mais ne
 *     participe pas à l'itinéraire : le dire, jamais le retirer en silence.
 *   - Trajets Mapbox (Directions) ; à défaut, estimation à vol d'oiseau signalée
 *     (`estime: true`) — même facteur que le moteur de tournées.
 *
 * Testé : node --test scripts/feuille-de-route.test.mjs
 * ============================================================================
 */

import { haversineKm } from './sectorClustering.js';
import { estimerParVolDOiseau } from './tournee/matrice.js';
import { formatItem } from './planningPrintModel.js';

const FACTEUR_ROUTE = 1.4; // même rallonge route / vol d'oiseau que tournee/matrice.js
const MAX_POINTS_DIRECTIONS = 25; // plafond Mapbox Directions
const ARRET_COLOR = '#2563EB';
const DEPOT_COLOR = '#334155';

const LONG_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function coordValide(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  return lat != null && lng != null && Number.isFinite(a) && Number.isFinite(b) && !(a === 0 && b === 0);
}

/**
 * RDV à visiter d'une personne pour la journée, dans l'ordre du planning.
 * @param {Array} rdvs  lignes RDV du jour (avec `technician_ids`)
 * @param {Iterable<string>} memberIds  ids de la personne (team_members.id, et commercials.id le cas échéant)
 * @returns {Array} RDV filtrés, dédupliqués, triés par heure de début
 */
export function arretsDeLaJournee(rdvs = [], memberIds = []) {
  const ids = new Set(memberIds);
  const seen = new Set();
  return rdvs
    .filter((r) => {
      if (!r || seen.has(r.id)) return false;
      if (r.status === 'cancelled' || r.status === 'no_show' || r.appointment_type === 'leave') return false;
      const aLui = (r.technician_ids || []).some((id) => ids.has(id))
        || (r.assigned_commercial_id && ids.has(r.assigned_commercial_id));
      if (aLui) seen.add(r.id);
      return aLui;
    })
    .sort((a, b) => String(a.scheduled_start || '').localeCompare(String(b.scheduled_start || '')));
}

/**
 * Points de l'itinéraire : dépôt, arrêts localisés, dépôt.
 * @param {{ lat: number, lng: number }|null} depot
 * @param {Array} arrets  sortie de `arretsDeLaJournee`, avec `lat`/`lng` éventuels
 * @returns {Array<{ lat: number, lng: number, rdvId: string|null }>} vide si pas de dépôt ou aucun arrêt localisé
 */
export function pointsItineraire(depot, arrets = []) {
  if (!depot || !coordValide(depot.lat, depot.lng)) return [];
  const stops = arrets
    .filter((a) => coordValide(a.lat, a.lng))
    .map((a) => ({ lat: Number(a.lat), lng: Number(a.lng), rdvId: a.id }));
  if (stops.length === 0) return [];
  const d = { lat: Number(depot.lat), lng: Number(depot.lng), rdvId: null };
  return [d, ...stops, d];
}

/** Clé stable d'un itinéraire (cache des trajets). */
export function cleItineraire(points = []) {
  return points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
}

/**
 * URL Mapbox Directions (un seul appel pour toute la journée).
 * @returns {string|null} null si moins de 2 points, trop de points ou pas de token
 */
export function urlDirections(points = [], token = '') {
  if (!token || points.length < 2 || points.length > MAX_POINTS_DIRECTIONS) return null;
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  return `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}`
    + `?overview=simplified&geometries=polyline&access_token=${token}`;
}

/**
 * Réponse Directions → tronçons. `null` si la forme est inattendue (l'appelant
 * bascule alors sur l'estimation, signalée).
 * @returns {{ troncons: Array<{ minutes: number, km: number }>, geometry: string|null }|null}
 */
export function lireDirections(json, nbPoints) {
  const route = json?.routes?.[0];
  const legs = route?.legs;
  if (!Array.isArray(legs) || legs.length !== nbPoints - 1) return null;
  return {
    troncons: legs.map((l) => ({
      minutes: Math.round((Number(l.duration) || 0) / 60),
      km: Math.round(((Number(l.distance) || 0) / 1000) * 10) / 10,
    })),
    geometry: typeof route.geometry === 'string' ? route.geometry : null,
  };
}

/** Tronçons estimés à vol d'oiseau (repli Mapbox indisponible). */
export function estimerTroncons(points = []) {
  const out = [];
  for (let i = 1; i < points.length; i += 1) {
    const km = haversineKm(points[i - 1], points[i]);
    out.push({ minutes: estimerParVolDOiseau(km), km: Math.round(km * FACTEUR_ROUTE * 10) / 10 });
  }
  return out;
}

/**
 * Itinéraire Google Maps multi-arrêts dépôt → arrêts → dépôt (ouvre l'app sur mobile).
 * Les arrêts localisés sont visés par coordonnées, les autres par adresse.
 * @returns {string|null}
 */
export function lienGoogleMapsTournee(depot, arrets = []) {
  if (!depot || !coordValide(depot.lat, depot.lng) || arrets.length === 0) return null;
  const origin = encodeURIComponent(`${depot.lat},${depot.lng}`);
  const waypoints = arrets
    .map((a) => (coordValide(a.lat, a.lng)
      ? `${a.lat},${a.lng}`
      : [a.address, a.postal_code, a.city].filter(Boolean).join(' ')))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('%7C');
  if (!waypoints) return null;
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${origin}&waypoints=${waypoints}&travelmode=driving`;
}

/**
 * Carte statique Mapbox : tracé (si connu) + repère numéroté par arrêt + dépôt.
 * Même image à l'écran et dans le PDF.
 * @returns {string|null}
 */
export function urlCarteStatique({ points = [], geometry = null, token = '', width = 600, height = 320 } = {}) {
  if (!token || points.length < 2) return null;
  const hex = (c) => c.replace('#', '');
  const overlays = [];
  if (geometry) overlays.push(`path-4+${hex(ARRET_COLOR)}-0.75(${encodeURIComponent(geometry)})`);
  const [depot, ...rest] = points;
  overlays.push(`pin-s-home+${hex(DEPOT_COLOR)}(${depot.lng.toFixed(5)},${depot.lat.toFixed(5)})`);
  rest.slice(0, -1).forEach((p, i) => {
    overlays.push(`pin-s-${i + 1}+${hex(ARRET_COLOR)}(${p.lng.toFixed(5)},${p.lat.toFixed(5)})`);
  });
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays.join(',')}`
    + `/auto/${width}x${height}@2x?padding=40&access_token=${token}`;
}

/** 95 → « 1 h 35 », 40 → « 40 min ». */
export function formatDureeRoute(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/** 12.3 → « 12,3 km » (virgule FR, PDF-safe). */
export function formatKm(km) {
  if (!Number.isFinite(km)) return '—';
  return `${String(Math.round(km * 10) / 10).replace('.', ',')} km`;
}

function slug(s) {
  return String(s || 'feuille')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'feuille';
}

/**
 * Modèle complet de la feuille de route.
 *
 * @param {object} p
 * @param {string} p.date                 'YYYY-MM-DD'
 * @param {object} p.person               { displayName, color }
 * @param {object|null} p.depot           { lat, lng, label }
 * @param {Array}  p.arrets               sortie de `arretsDeLaJournee` (avec lat/lng)
 * @param {Array|null} p.troncons         un par paire de `pointsItineraire` (null = pas d'itinéraire)
 * @param {boolean} [p.estime]            trajets estimés à vol d'oiseau
 * @param {object} [p.typeLabels]
 * @param {Map}    [p.equipmentLabelsByClient]
 * @param {Date}   [p.now]
 */
export function buildFeuilleDeRoute({
  date, person, depot = null, arrets = [], troncons = null, estime = false,
  typeLabels = {}, equipmentLabelsByClient = new Map(), now = new Date(),
} = {}) {
  const ctx = { typeLabels, equipmentLabelsByClient, personColor: person?.color };
  const aTroncons = Array.isArray(troncons) && troncons.length > 0;
  let leg = 0;
  let rang = 0;
  const items = arrets.map((a) => {
    const localise = coordValide(a.lat, a.lng);
    const trajetAvant = localise && aTroncons ? troncons[leg] || null : null;
    if (localise && aTroncons) leg += 1;
    rang += 1;
    return { ...formatItem(a, ctx), rang, localise, trajetAvant };
  });
  const retour = aTroncons ? troncons[troncons.length - 1] || null : null;
  const totaux = aTroncons
    ? {
      minutes: troncons.reduce((s, t) => s + (t.minutes || 0), 0),
      km: Math.round(troncons.reduce((s, t) => s + (t.km || 0), 0) * 10) / 10,
    }
    : null;
  const editedTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  return {
    personName: person?.displayName || 'Technicien',
    personColor: person?.color || null,
    date,
    dateLabel: capitalize(LONG_FMT.format(parseISODate(date))),
    depotLabel: depot?.label || 'Dépôt',
    items,
    nbNonLocalises: items.filter((i) => !i.localise).length,
    retour,
    totaux,
    estime: aTroncons && !!estime,
    editedLabel: `Édité le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(now)} à ${editedTime}`,
    filename: `feuille-de-route-${slug(person?.displayName)}-${date}.pdf`,
  };
}
