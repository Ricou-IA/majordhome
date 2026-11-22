// src/lib/envoiEnCours.js
// ============================================================================
// Envois de campagne en cours dans CET onglet — registre au niveau du module, qui survit à la page.
// Une vague demandée à `mailing-send` continue côté serveur (jusqu'à ~150 s) même si la page est quittée ;
// `mailing-send` n'a pas de verrou et n'écrit chaque destinataire au journal qu'après l'envoi : relancer
// pendant cette vague écrirait de nouveau à ceux qu'elle n'a pas encore journalisés. Tant qu'une clé
// (organisation + nom de campagne, `cleEnvoi` de `mailPage.js`) est ici, ni essai ni envoi ne repart.
//
// Limite : un seul onglet. Deux onglets, ou deux personnes, peuvent encore lancer la même campagne au même
// moment — le vrai correctif est un verrou serveur dans `mailing-send` (hors de ce chantier).
// Module PUR (aucun import), testé `scripts/envoi-en-cours.test.mjs`.
// ============================================================================

/** @type {Map<string, Promise<void>>} */
const enVol = new Map();
/** @type {Set<() => void>} */
const abonnes = new Set();

const prevenir = () => { for (const fn of [...abonnes]) fn(); };

/**
 * Inscrit un envoi. Refusé (false) si la clé est vide ou déjà occupée. L'entrée disparaît quand la promesse
 * se termine, qu'elle réussisse ou échoue.
 * @param {string} cle
 * @param {Promise<unknown>} promesse
 * @returns {boolean}
 */
export function demarrer(cle, promesse) {
  if (!cle || enVol.has(cle)) return false;
  const suivi = Promise.resolve(promesse).then(() => undefined, () => undefined).finally(() => {
    if (enVol.get(cle) === suivi) enVol.delete(cle);
    prevenir();
  });
  enVol.set(cle, suivi);
  prevenir();
  return true;
}

/** @param {string} cle @returns {boolean} */
export function enCours(cle) {
  return !!cle && enVol.has(cle);
}

/**
 * Résout quand l'envoi de cette clé est terminé (tout de suite s'il n'y en a pas). Ne rejette jamais.
 * @param {string} cle
 * @returns {Promise<void>}
 */
export function attendre(cle) {
  return enVol.get(cle) ?? Promise.resolve();
}

/**
 * Appelé à chaque départ et à chaque fin d'envoi. Rend la fonction de désabonnement.
 * @param {() => void} fn
 * @returns {() => void}
 */
export function abonner(fn) {
  abonnes.add(fn);
  return () => { abonnes.delete(fn); };
}

/** Tests seulement : remet le registre à zéro. */
export function _vider() {
  enVol.clear();
  abonnes.clear();
}
