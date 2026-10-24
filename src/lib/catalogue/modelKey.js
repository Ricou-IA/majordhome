// src/lib/catalogue/modelKey.js
// Clé « modèle fabricant » : la seule clé commune entre fournisseurs (aucun EAN publié, références fournisseur
// propres à chaque site). Dérivée des libellés et de la référence fabricant : le jeton le plus spécifique qui
// mêle lettres et chiffres (LUNA2000-7-E1, SUN2000-5K-LB0, HMS-1000-2T), normalisé en majuscules sans
// séparateurs. Module PUR (copié pour Deno), testé scripts/catalogue/model-key.test.mjs.
// Spec : docs/superpowers/specs/2026-10-24-catalogue-photovoltaique-connexion-generique-design.md § 7.
//
// Garde-fous : une unité (13,5kWh, 400Wc, 48V, 230VAC) n'est pas un modèle ; un EAN ou un code purement
// numérique non plus ; un jeton qui est le préfixe d'un autre jeton du même libellé est une FAMILLE (SUN2000
// devant SUN2000-5K-LB0) ; un jeton « lettres puis 3-4 chiffres » seul (LUNA2000, SUN2000) est une famille :
// pas de clé plutôt qu'une clé qui marierait un module 5 kWh avec un système 241 kWh.

// Une unité = un nombre court suivi d'une unité ; une référence longue à lettre finale (1707000-30-L) n'en est pas une.
const RE_UNITE = /^\d{1,5}(KWH|KW|KVA|KWC|KWP|WH|WC|WP|W|VAC|VDC|V|AH|A|MM|CM|M|KG|G|HZ|MPPT|L|ANS?)$/;
const RE_FAMILLE = /^[A-Z]{1,6}\d{3,4}$/;
const LONGUEUR_MIN = 5;

/**
 * Forme normalisée d'un modèle : majuscules, lettres et chiffres seulement. null si vide.
 * @param {unknown} s
 * @returns {string|null}
 */
export function normaliserModele(s) {
  const n = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n || null;
}

/**
 * Jetons candidats d'un texte, normalisés, dans l'ordre d'apparition, familles et préfixes retirés.
 * @param {string} texte
 * @param {string|null} [marque] jeton de marque à ignorer (K2, IQ…)
 * @returns {string[]}
 */
export function jetonsModele(texte, marque = null) {
  const marqueN = normaliserModele(marque);
  const bruts = String(texte || '').split(/[\s()[\],;:|/&]+/).map((t) => t.replace(/^[–\-.]+|[–\-.]+$/g, ''));
  const vus = new Set();
  const candidats = [];
  for (const t of bruts) {
    if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) continue;
    let n = normaliserModele(t);
    // « HUAWEI-LUNA2000-5-E0 » : la marque collée au modèle est retirée pour retrouver la clé commune LUNA20005E0.
    if (marqueN && n && n.length > marqueN.length && n.startsWith(marqueN)) n = n.slice(marqueN.length);
    if (!n || !/[A-Z]/.test(n) || !/\d/.test(n) || n.length < LONGUEUR_MIN || RE_UNITE.test(n) || n === marqueN || vus.has(n)) continue;
    vus.add(n);
    candidats.push(n);
  }
  return candidats
    .filter((n) => !candidats.some((autre) => autre !== n && autre.startsWith(n)))
    .filter((n) => !RE_FAMILLE.test(n));
}

/**
 * Clé modèle d'un article depuis ses textes (libellés, référence fabricant), premier jeton retenu.
 * @param {string|null} marque
 * @param {Array<string|null|undefined>} textes
 * @returns {string|null}
 */
export function calculerModelKey(marque, textes) {
  for (const t of textes || []) {
    const jetons = jetonsModele(t, marque);
    if (jetons.length) return jetons[0];
  }
  return null;
}
