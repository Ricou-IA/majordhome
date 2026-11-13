// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/catalogue/cataloguePieces.js — ne pas éditer.
// src/lib/catalogue/cataloguePieces.js
// Configuration d'un fournisseur « boutique publique, catalogue de pièces » (`suppliers.connector_config`) — module PUR,
// sans import (copié pour Deno par `npm run sync:tournee-engine`, ne jamais éditer la copie). Lu par l'edge
// `supplier-catalog-sync` pour décider du chemin de relevé, et par les écrans qui afficheront l'accord du marchand.
//
// Forme lue (toute autre forme = tout inactif, jamais d'exception) :
//   { public: true, catalogue_pieces: true, accord: { contact: 'M. X', date: '2026-11-12' }, pieces: { remise_pct: 30 } }
// Règle du chantier : AUCUN relevé d'un marchand sans son accord — `accordValide` doit être vrai avant tout appel réseau.

/**
 * Objet simple (ni null, ni tableau).
 * @param {unknown} v
 * @returns {Record<string, any>|null}
 */
function objet(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, any>} */ (v) : null;
}

/**
 * Remise du fournisseur en pourcent : nombre (ou chaîne numérique) dans [0 ; 100[, sinon 0. Même règle que
 * `remiseValide` de woocommercePieces.js et que la saisie (`remisePiecesValide`) : une remise de 100 % ou plus n'a pas
 * de sens (prix d'achat nul) et vaut 0, jamais une valeur ramenée dans la borne.
 * @param {unknown} v
 * @returns {number}
 */
function remiseBornee(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : 0;
}

/**
 * Lecture tolérante de `connector_config`.
 * @param {unknown} connectorConfig
 * @returns {{ public: boolean, pieces: boolean, accord: { contact: string, date: string } | null, remisePct: number }}
 */
export function configCataloguePieces(connectorConfig) {
  const c = objet(connectorConfig);
  if (!c) return { public: false, pieces: false, accord: null, remisePct: 0 };
  const a = objet(c.accord);
  const accord = a && typeof a.contact === 'string' && typeof a.date === 'string'
    ? { contact: a.contact.trim(), date: a.date.trim() }
    : null;
  const p = objet(c.pieces);
  return {
    public: c.public === true,
    pieces: c.catalogue_pieces === true,
    accord,
    remisePct: remiseBornee(p ? p.remise_pct : undefined),
  };
}

/**
 * Date AAAA-MM-JJ qui existe au calendrier (le 2026-02-30 n'existe pas).
 * @param {string} date
 * @returns {boolean}
 */
function dateReelle(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * L'accord du marchand est-il valable : un contact non vide ET une date AAAA-MM-JJ réelle, pas dans le futur ?
 * @param {unknown} connectorConfig
 * @param {string} [aujourdhui] AAAA-MM-JJ (UTC) ; défaut = date du jour UTC (paramètre pour des tests déterministes)
 * @returns {boolean}
 */
export function accordValide(connectorConfig, aujourdhui) {
  const { accord } = configCataloguePieces(connectorConfig);
  if (!accord || !accord.contact || !dateReelle(accord.date)) return false;
  const jour = typeof aujourdhui === 'string' && dateReelle(aujourdhui) ? aujourdhui : new Date().toISOString().slice(0, 10);
  return accord.date <= jour;
}
