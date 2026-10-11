/**
 * itineraire.js — liens d'itinéraire vers une adresse client (module PUR).
 *
 * Sur téléphone et tablette, ces URL universelles ouvrent l'application
 * installée (Google Maps, Waze) directement en mode navigation ; sur PC elles
 * ouvrent le site. Quand la fiche client est géocodée (latitude/longitude),
 * on cible le point exact plutôt que le texte : une adresse mal orthographiée
 * ou un lieu-dit ne fait plus rater la destination.
 *
 * Testé : node --test scripts/itineraire.test.mjs
 */

/**
 * Une adresse postale sur une ligne : « 12 rue des Lilas, 81600 Gaillac ».
 * Les morceaux vides disparaissent (pas de virgule orpheline).
 * @param {{ address?: string, postalCode?: string, city?: string }} parts
 * @returns {string}
 */
export function formaterAdresse({ address, postalCode, city } = {}) {
  const ligne2 = [postalCode, city].map((v) => (v || '').trim()).filter(Boolean).join(' ');
  return [(address || '').trim(), ligne2].filter(Boolean).join(', ');
}

function coordonneesValides(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && !(Number(lat) === 0 && Number(lng) === 0);
}

/**
 * Itinéraire Google Maps (URL universelle « Maps URLs », ouvre l'app sur mobile).
 * @param {{ adresse?: string, lat?: number|string|null, lng?: number|string|null }} dest
 * @returns {string|null} null si rien ne permet de viser une destination
 */
export function lienGoogleMaps({ adresse, lat, lng } = {}) {
  const destination = coordonneesValides(lat, lng) ? `${lat},${lng}` : (adresse || '').trim();
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

/**
 * Itinéraire Waze (deep link universel, `navigate=yes` lance la navigation).
 * @param {{ adresse?: string, lat?: number|string|null, lng?: number|string|null }} dest
 * @returns {string|null}
 */
export function lienWaze({ adresse, lat, lng } = {}) {
  if (coordonneesValides(lat, lng)) return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  const q = (adresse || '').trim();
  if (!q) return null;
  return `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;
}
