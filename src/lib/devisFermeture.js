/**
 * devisFermeture.js — fermer la fenêtre de devis sans perdre une saisie (module pur).
 * ============================================================================
 * Échap, clic sur le fond, croix et « Annuler » demandent la fermeture : si une saisie
 * serait perdue, on demande d'abord « Abandonner le devis ? ». Seule une saisie compte :
 * un chapitre vide (posé d'office par la famille) n'est rien à perdre, une ligne avec une
 * désignation ou un prix, ou un objet, l'est. `touche` dit si l'utilisateur a modifié
 * quelque chose : un devis rouvert sans changement se ferme sans question.
 * Testé : scripts/devis-fermeture.test.mjs.
 * ============================================================================
 */

/** Une ligne (hors titre de chapitre) porte-t-elle une saisie ? */
export function ligneSaisie(ligne) {
  if (!ligne || ligne.line_type === 'section_title') return false;
  return String(ligne.designation ?? '').trim() !== '' || Number(ligne.unit_price_ht) > 0;
}

/**
 * Fermer maintenant ferait-il perdre une saisie ?
 * @param {{ touche: boolean, lines: object[], subject?: string }} p
 */
export function saisieDevisAPerdre({ touche, lines = [], subject = '' }) {
  if (!touche) return false;
  return lines.some(ligneSaisie) || String(subject ?? '').trim() !== '';
}
