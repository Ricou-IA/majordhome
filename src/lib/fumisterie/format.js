// src/lib/fumisterie/format.js
// Affichage des quantités et des cotes du métré (module PUR) : virgule décimale, unité lisible.
// Recette du 2026-11-28 : « 6.5 » sans unité dans la liste de pièces.

const nombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const UNITES = { m: 'm', ml: 'm', metre: 'm', mètre: 'm', 'm²': 'm²', kg: 'kg' };

/**
 * « 6,5 m », « 3 », « 2,25 m² ». Une pièce ne porte pas d'unité. Espaces insécables normalisés (le PDF Helvetica
 * ne connaît pas U+202F).
 * @param {unknown} q @param {string|null|undefined} unite @returns {string}
 */
export function formatQuantite(q, unite) {
  const v = Number(q);
  if (q == null || q === '' || !Number.isFinite(v)) return '—';
  const u = UNITES[String(unite || '').trim().toLowerCase()];
  return `${nombre.format(v).replace(/\s/g, ' ')}${u ? ` ${u}` : ''}`;
}
