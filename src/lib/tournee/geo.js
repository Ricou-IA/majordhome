// src/lib/tournee/geo.js
// ============================================================================
// Géométrie du moteur de tournées. Module PUR.
// Testé : node --test scripts/tournee/geo.test.mjs
//
// Premier étage du calcul de distance : le filtre à vol d'oiseau est gratuit et
// instantané, il fait passer ~416 contrats à ~25 candidats avant tout appel
// Mapbox (dont le quota est la vraie ressource rare).
// ============================================================================

import { haversineKm } from '../sectorClustering.js';

export { haversineKm };

const aDesCoords = (p) => {
  if (!p || p.lat == null || p.lng == null) return false;

  const isValidCoord = (val) => {
    // Si déjà un nombre fini
    if (typeof val === 'number') {
      return Number.isFinite(val);
    }
    // Si c'est une chaîne, elle doit être non-vide trimée et convertible en nombre fini
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed) return false;
      return Number.isFinite(Number(trimmed));
    }
    // Tout autre type (booléen, tableau, objet, etc.) : rejeter
    return false;
  };

  return isValidCoord(p.lat) && isValidCoord(p.lng);
};

/**
 * Clé de cache d'un point : 3 décimales ≈ 100 m. Deux clients d'une même rue
 * partagent la même clé, ce qui est exactement l'effet recherché.
 */
export function cleCoord(point) {
  if (!aDesCoords(point)) return null;
  return `${Number(point.lat).toFixed(3)},${Number(point.lng).toFixed(3)}`;
}

/** Barycentre des points géolocalisés. `null` si aucun. */
export function barycentre(points) {
  const valides = (points || []).filter(aDesCoords);
  if (valides.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of valides) {
    lat += Number(p.lat);
    lng += Number(p.lng);
  }
  return { lat: lat / valides.length, lng: lng / valides.length };
}

/**
 * Candidats à ≤ rayonKm du centre. Un candidat sans coordonnées est toujours
 * écarté : sans position, aucun coût de trajet n'est calculable, et le laisser
 * passer produirait une tournée dont la durée est fausse.
 */
export function filtreProximite(candidats, centre, rayonKm) {
  const avecCoords = (candidats || []).filter(aDesCoords);
  if (!aDesCoords(centre)) return avecCoords;
  return avecCoords.filter((c) => haversineKm(centre, c) <= rayonKm);
}
