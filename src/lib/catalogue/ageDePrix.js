// src/lib/catalogue/ageDePrix.js
// Âge et fraîcheur d'un prix d'achat fournisseur (supplier_products.purchase_price_at) — module PUR, testé
// (scripts/catalogue/age-de-prix.test.mjs). Spec articles Majord'home § 5.4 : un prix de moins de 30 jours est
// « frais » ; au-delà il reste affiché avec son âge mais n'est jamais proposé d'office au devis.

/** Âge au-delà duquel un prix n'est plus proposé d'office (jours). */
export const SEUIL_FRAICHEUR_JOURS = 30;

const JOUR_MS = 86400000;

/** @param {string|Date|null|undefined} d @returns {Date|null} */
function parseDate(d) {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Âge du prix en jours entiers (0 le jour même) ; null si la date est absente ou invalide.
 * @param {string|Date|null|undefined} prixDate
 * @param {Date|string} [now]
 * @returns {number|null}
 */
export function ageJours(prixDate, now = new Date()) {
  const d = parseDate(prixDate);
  const n = parseDate(now);
  if (!d || !n) return null;
  return Math.max(0, Math.floor((n.getTime() - d.getTime()) / JOUR_MS));
}

/**
 * Vrai si le prix a strictement moins de `seuilJours` jours. Une date absente ou invalide n'est jamais fraîche.
 * @param {string|Date|null|undefined} prixDate
 * @param {Date|string} [now]
 * @param {number} [seuilJours]
 * @returns {boolean}
 */
export function estFrais(prixDate, now = new Date(), seuilJours = SEUIL_FRAICHEUR_JOURS) {
  const d = parseDate(prixDate);
  const n = parseDate(now);
  if (!d || !n) return false;
  return n.getTime() - d.getTime() < seuilJours * JOUR_MS;
}

/**
 * Libellé français de l'âge d'un prix : « relevé aujourd’hui », « relevé hier », « il y a 23 jours »,
 * « il y a 3 mois », « il y a plus d’un an », « jamais ».
 * @param {string|Date|null|undefined} prixDate
 * @param {Date|string} [now]
 * @returns {string}
 */
export function libelleAge(prixDate, now = new Date()) {
  const age = ageJours(prixDate, now);
  if (age == null) return 'jamais';
  if (age === 0) return 'relevé aujourd’hui';
  if (age === 1) return 'relevé hier';
  if (age < 31) return `il y a ${age} jours`;
  if (age < 365) return `il y a ${Math.max(1, Math.round(age / 30.44))} mois`;
  return 'il y a plus d’un an';
}
