// src/lib/envoiEnCours.js
// ============================================================================
// Envois de campagne en cours dans CET onglet — registre au niveau du module, qui survit à la page.
// Une vague demandée à `mailing-send` continue côté serveur (jusqu'à ~150 s) même si la page est quittée ;
// `mailing-send` n'a pas de verrou et n'écrit chaque destinataire au journal qu'après l'envoi : relancer
// pendant cette vague écrirait de nouveau à ceux qu'elle n'a pas encore journalisés. Tant qu'une clé
// (organisation + nom de campagne, `cleEnvoi` de `mailPage.js`) est ici, ni essai ni envoi ne repart.
//
// Coupure (la page n'a reçu AUCUNE réponse : réseau coupé, délai dépassé, passerelle) : la vague demandée
// tourne peut-être encore chez le serveur. La clé reste alors prise `DELAI_APRES_COUPURE_MS` (`retenir`), le
// temps qu'elle se termine et journalise chacun ; une réponse du serveur, même un refus, libère tout de suite.
// Recharger la page vide le registre (retenue comprise) : la page le dit avant de partir.
//
// Limite : un seul onglet. Deux onglets, ou deux personnes, peuvent encore lancer la même campagne au même
// moment — le vrai correctif est un verrou serveur dans `mailing-send` (hors de ce chantier).
// Module PUR (aucun import), testé `scripts/envoi-en-cours.test.mjs`.
// ============================================================================

/** @type {Map<string, Promise<void>>} */
const enVol = new Map();
/** Échéance (ms) des clés retenues après une coupure. @type {Map<string, number>} */
const retenues = new Map();
/** @type {Set<() => void>} */
const abonnes = new Set();

/**
 * Attente après une coupure avant qu'un envoi de la même campagne puisse repartir : une vague dure au plus
 * ~150 s chez le serveur (300 envois), arrondi à 3 minutes.
 */
export const DELAI_APRES_COUPURE_MS = 3 * 60 * 1000;

const prevenir = () => { for (const fn of [...abonnes]) fn(); };

/**
 * Inscrit un envoi. Refusé (false) si la clé est vide, déjà occupée ou retenue après une coupure. L'entrée
 * disparaît quand la promesse se termine, qu'elle réussisse ou échoue (une retenue posée entre-temps reste).
 * @param {string} cle
 * @param {Promise<unknown>} promesse
 * @param {number} [maintenant] ms
 * @returns {boolean}
 */
export function demarrer(cle, promesse, maintenant = Date.now()) {
  if (!cle || enCours(cle, maintenant)) return false;
  const suivi = Promise.resolve(promesse).then(() => undefined, () => undefined).finally(() => {
    if (enVol.get(cle) === suivi) enVol.delete(cle);
    prevenir();
  });
  enVol.set(cle, suivi);
  prevenir();
  return true;
}

/**
 * La clé est-elle prise : envoi en vol, ou retenue après une coupure dont le délai court encore ?
 * @param {string} cle
 * @param {number} [maintenant] ms
 * @returns {boolean}
 */
export function enCours(cle, maintenant = Date.now()) {
  return !!cle && (enVol.has(cle) || retenueJusqua(cle, maintenant) !== null);
}

/**
 * Échéance (ms) de la retenue de cette clé, `null` s'il n'y en a pas ou si elle est passée.
 * @param {string} cle
 * @param {number} [maintenant] ms
 * @returns {number | null}
 */
export function retenueJusqua(cle, maintenant = Date.now()) {
  const echeance = retenues.get(cle);
  return typeof echeance === 'number' && echeance > maintenant ? echeance : null;
}

/**
 * Coupure : garde la clé prise `DELAI_APRES_COUPURE_MS`, puis la libère et prévient les abonnés.
 * Horloge injectable (tests) : `maintenant()` et `planifier(fn, ms)`.
 * @param {string} cle
 * @param {{ maintenant?: () => number, planifier?: (fn: () => void, ms: number) => unknown }} [horloge]
 * @returns {number | null} échéance (ms), `null` si la clé est vide
 */
export function retenir(cle, { maintenant = () => Date.now(), planifier = (fn, ms) => setTimeout(fn, ms) } = {}) {
  if (!cle) return null;
  const echeance = maintenant() + DELAI_APRES_COUPURE_MS;
  retenues.set(cle, echeance);
  planifier(() => {
    if (retenues.get(cle) === echeance) retenues.delete(cle);
    prevenir();
  }, DELAI_APRES_COUPURE_MS);
  prevenir();
  return echeance;
}

/**
 * L'échec d'un appel à une fonction du serveur est-il une absence de réponse (la vague tourne peut-être
 * encore) ? Coupure réseau, délai dépassé, relais, ou passerelle (502, 503, 504) : oui. Une réponse du
 * serveur, refus compris : non.
 * @param {unknown} erreur
 * @returns {boolean}
 */
export function sansReponse(erreur) {
  if (!erreur || typeof erreur !== 'object') return false;
  const e = /** @type {{ name?: string, context?: { status?: number } }} */ (erreur);
  if (['FunctionsFetchError', 'FunctionsRelayError', 'AbortError', 'TimeoutError', 'TypeError'].includes(e.name ?? '')) return true;
  const statut = Number(e.context?.status);
  return [502, 503, 504].includes(statut);
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
  retenues.clear();
  abonnes.clear();
}
