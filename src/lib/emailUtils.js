// src/lib/emailUtils.js
// Adresses e-mail saisies sur une fiche lead ou client — module PUR, testé (scripts/email-utils.test.mjs).
// Plus strict que le type="email" des champs, qui ne protège pas : les fiches s'enregistrent par un bouton hors
// formulaire, et un `…@gmail..com` faisait refuser le client par Pennylane (422, 2026-11-04).

const EMAIL_RE = /^[a-z0-9_%+'-]+(\.[a-z0-9_%+'-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export const EMAIL_INVALIDE_MESSAGE = 'Adresse e-mail invalide : corrigez-la ou videz le champ';

/**
 * Adresses d'une saisie e-mail : une fiche peut en porter plusieurs (« a@x.fr, b@x.fr »).
 * @param {string|null|undefined} saisie
 * @returns {string[]}
 */
export function adressesEmail(saisie) {
  return String(saisie || '').split(/[\s,;]+/).filter(Boolean);
}

/**
 * Toutes les adresses de la saisie sont-elles bien formées ? Vide = oui (e-mail facultatif).
 * @param {string|null|undefined} saisie
 * @returns {boolean}
 */
export function emailsValides(saisie) {
  return adressesEmail(saisie).every((a) => EMAIL_RE.test(a));
}

/**
 * Faut-il refuser d'enregistrer cette saisie ? Une adresse invalide déjà en base et non modifiée passe : on ne
 * bloque pas la correction d'un téléphone sur une fiche ancienne.
 * @param {string|null|undefined} saisie
 * @param {string|null|undefined} [enregistre] valeur actuellement en base
 * @returns {boolean}
 */
export function emailRefuse(saisie, enregistre = null) {
  return !emailsValides(saisie) && String(saisie).trim() !== String(enregistre ?? '').trim();
}
