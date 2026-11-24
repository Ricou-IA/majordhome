// src/lib/chapitresCommunication.js
// ============================================================================
// Chapitres de Réglages → E-mails & SMS (/settings/communication), choisis par `?tab=`.
// Seule définition : la page, et tout lien qui y renvoie (page du mail, démarrage), passent par ici.
// Module pur (aucun import), testé `scripts/chapitres-communication.test.mjs`.
// Conception : docs/superpowers/specs/2026-11-22-reglages-emails-chapitres-habillage-enrichi-design.md § 1.
// ============================================================================

export const PAGE_COMMUNICATION = '/settings/communication';

/**
 * @typedef {{ key: string, label: string, communication: boolean }} Chapitre
 * `communication` : le chapitre n'existe que si le module Communication est ouvert.
 */

/** @type {ReadonlyArray<Readonly<Chapitre>>} */
export const CHAPITRES = Object.freeze([
  Object.freeze({ key: 'expediteur', label: 'Expéditeur et domaine', communication: false }),
  Object.freeze({ key: 'habillage', label: 'Apparence des e-mails', communication: true }),
  Object.freeze({ key: 'automatiques', label: 'E-mails automatiques', communication: true }),
  Object.freeze({ key: 'sequences', label: 'Relances automatiques', communication: true }),
  Object.freeze({ key: 'sms', label: 'SMS & WhatsApp', communication: false }),
]);

export const CHAPITRE_PAR_DEFAUT = 'expediteur';

/** Anciennes valeurs de `?tab=` encore présentes dans des liens enregistrés. */
const ANCIENS = Object.freeze({ emails: 'expediteur' });

/**
 * Chapitres proposés à cette entreprise.
 * @param {boolean} communicationOuverte module Communication ouvert
 * @returns {ReadonlyArray<Readonly<Chapitre>>}
 */
export function chapitresOuverts(communicationOuverte) {
  return CHAPITRES.filter((c) => !c.communication || communicationOuverte === true);
}

/**
 * Chapitre à afficher pour la valeur de `?tab=` : celui demandé s'il est proposé, sinon le premier.
 * @param {string | null | undefined} demande
 * @param {ReadonlyArray<Readonly<Chapitre>>} ouverts
 * @returns {string}
 */
export function chapitreActif(demande, ouverts) {
  const cle = ANCIENS[demande] ?? demande;
  return ouverts.some((c) => c.key === cle) ? cle : CHAPITRE_PAR_DEFAUT;
}

/**
 * Paramètres d'adresse d'un chapitre : aucun pour le chapitre par défaut.
 * @param {string} cle
 * @returns {Record<string, string>}
 */
export function parametresDuChapitre(cle) {
  return cle === CHAPITRE_PAR_DEFAUT || !CHAPITRES.some((c) => c.key === cle) ? {} : { tab: cle };
}

/**
 * Adresse d'un chapitre, pour un lien.
 * @param {string} cle
 * @returns {string}
 */
export function lienChapitre(cle) {
  const p = parametresDuChapitre(cle);
  return p.tab ? `${PAGE_COMMUNICATION}?tab=${p.tab}` : PAGE_COMMUNICATION;
}
