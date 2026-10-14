// src/lib/tournee/extremites.js
// ============================================================================
// Départ / retour d'une journée de technicien. Module PUR (copié pour Deno).
// Priorité, par extrémité : exception du jour > point personnel > siège.
// Testé : node --test scripts/tournee/extremites.test.mjs
// Spec : docs/superpowers/specs/2026-10-14-depart-retour-technicien-design.md
// ============================================================================
import { cleCoord } from './geo.js';

/**
 * @typedef {{ lat: number, lng: number, label: string, address: string|null, source: 'agence'|'perso' }} Point
 */

/** @param {any} p @returns {boolean} */
export function pointValide(p) {
  if (!p) return false;
  const ok = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
  return ok(p.lat) && ok(p.lng);
}

function communeDe(address) {
  const m = /\b\d{5}\s+(.+)$/.exec(String(address || '').trim());
  return m ? m[1].trim() : null;
}

/** @param {any} siege @returns {Point|null} */
function pointAgence(siege) {
  if (!pointValide(siege)) return null;
  return { lat: Number(siege.lat), lng: Number(siege.lng), label: siege.label || 'Agence', address: siege.address ?? null, source: 'agence' };
}

/** @param {any} p @returns {Point|null} */
function pointPerso(p) {
  if (!pointValide(p)) return null;
  const base = (p.label || 'Domicile').trim();
  const commune = communeDe(p.address);
  return {
    lat: Number(p.lat), lng: Number(p.lng),
    label: commune && !base.includes(commune) ? `${base} (${commune})` : base,
    address: p.address ?? null, source: 'perso',
  };
}

/**
 * @param {{ siege: any, membre?: { depart_point?: any, retour_point?: any }|null, exception?: { depart?: string|null, retour?: string|null }|null }} p
 * @returns {{ depart: Point|null, retour: Point|null }}
 */
export function resoudreExtremites({ siege, membre = null, exception = null }) {
  const agence = pointAgence(siege);
  const un = (choix, perso) => {
    if (choix === 'agence') return agence ?? pointPerso(perso);
    return pointPerso(perso) ?? agence;
  };
  return {
    depart: un(exception?.depart ?? null, membre?.depart_point),
    retour: un(exception?.retour ?? null, membre?.retour_point),
  };
}

/**
 * Points effectifs d'une journée du moteur (`journee.depart/retour` posés par
 * chargerJournees), siège en repli.
 * @param {{ depart?: any, retour?: any }|null} journee
 * @param {{ lat: number, lng: number }|null} depot
 * @returns {{ depart: any, retour: any, depotKey: string, retourKey: string }}
 */
export function pointsDeJournee(journee, depot) {
  const depart = journee?.depart ?? depot ?? null;
  const retour = journee?.retour ?? depart;
  const depotKey = cleCoord(depart) ?? '';
  return { depart, retour, depotKey, retourKey: cleCoord(retour) ?? depotKey };
}
