/**
 * confirmationSaisie.js — règle de la confirmation par saisie d'un nom (module pur).
 * ============================================================================
 * Une suppression définitive se confirme en retapant le nom affiché (client, demande).
 * La comparaison ignore casse, accents et espaces en trop : le but est d'obliger à
 * LIRE ce qu'on supprime, pas de piéger sur un accent. Un nom attendu vide (inconnu)
 * ne demande aucune saisie : on ne bloque pas une suppression sur une donnée absente.
 * Testé : scripts/confirmation-saisie.test.mjs.
 * ============================================================================
 */

/** Forme comparable d'un texte : sans accents, minuscules, espaces réduits. */
export function formeComparable(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le nom attendu demande-t-il une saisie ? */
export function saisieDemandee(attendu) {
  return formeComparable(attendu) !== '';
}

/** La saisie correspond-elle au nom attendu ? Vrai d'office quand rien n'est attendu. */
export function saisieConforme(saisie, attendu) {
  if (!saisieDemandee(attendu)) return true;
  return formeComparable(saisie) === formeComparable(attendu);
}
