// src/lib/fumisterie/saisie.js
// Saisie d'une mesure du métré (module PUR). Un champ `type="number"` dépend de la langue du navigateur : dans un
// Chrome en anglais, « 1,05 » devenait 105 (recette du 2026-11-28). Ici la virgule et le point valent la même chose,
// les espaces ne sont admis qu'entre groupes de trois chiffres, tout le reste est refusé.

const NOMBRE = /^(-?)(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d*)(?:[.,](\d*))?$/;

/**
 * @param {unknown} texte ce que l'utilisateur a tapé
 * @returns {{ valeur: number|null, etat: 'vide'|'en_cours'|'ok'|'invalide' }}
 *   `en_cours` : saisie pas encore lisible (« 1, », « - ») — on attend la suite, rien n'est écrit dans le relevé.
 */
export function parseNombre(texte) {
  const t = String(texte ?? '').trim().replace(/\u2212/g, '-');
  if (t === '') return { valeur: null, etat: 'vide' };
  const m = NOMBRE.exec(t);
  if (!m) return { valeur: null, etat: 'invalide' };
  const [, signe, entier, decimales] = m;
  const chiffresEntiers = entier.replace(/[ \u00a0\u202f]/g, '');
  if (!chiffresEntiers && !decimales) return { valeur: null, etat: 'en_cours' };
  if (decimales === '') return { valeur: null, etat: 'en_cours' };
  const valeur = Number(`${signe}${chiffresEntiers || '0'}${decimales ? `.${decimales}` : ''}`);
  return Number.isFinite(valeur) ? { valeur, etat: 'ok' } : { valeur: null, etat: 'invalide' };
}

/**
 * Nombre → texte du champ : virgule décimale, pas de séparateur de milliers, pas de zéro inutile.
 * @param {unknown} n
 * @returns {string}
 */
export function formaterSaisie(n) {
  if (n === '' || n == null) return '';
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return String(Number(v.toFixed(6))).replace('.', ',');
}
