/**
 * masquage.js — afficher une donnée sensible sans la livrer (module pur).
 * ============================================================================
 * IBAN de l'entreprise et identifiant de l'agent téléphonique ne s'affichent plus en clair
 * au chargement d'une page de réglages (brief UX P0-12 / P0-13) : on montre de quoi les
 * reconnaître (pays, derniers caractères), l'administrateur clique « Afficher » pour le reste.
 * Testé : scripts/masquage.test.mjs.
 * ============================================================================
 */

const POINTS = '••••';

/**
 * « FR76 3000 6000 0112 3456 7890 189 » → « FR76 •••• •••• 0189 » : pays + clé, puis les
 * quatre derniers caractères. Vide ⇒ ''. Trop court pour être un IBAN ⇒ tout masqué.
 */
export function masquerIban(iban) {
  const compact = String(iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (!compact) return '';
  if (compact.length < 12) return `${POINTS} ${POINTS}`;
  return `${compact.slice(0, 4)} ${POINTS} ${POINTS} ${compact.slice(-4)}`;
}

/** « agent_3101m42037pbepbvh52d81h8nn8w » → « agent_•••• 8nn8w » ; vide ⇒ ''. */
export function masquerIdentifiant(valeur, { garder = 5 } = {}) {
  const texte = String(valeur ?? '').trim();
  if (!texte) return '';
  if (texte.length <= garder + 2) return POINTS;
  const prefixe = texte.includes('_') ? `${texte.slice(0, texte.indexOf('_') + 1)}` : '';
  return `${prefixe}${POINTS} ${texte.slice(-garder)}`;
}
