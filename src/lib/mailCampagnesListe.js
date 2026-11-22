// src/lib/mailCampagnesListe.js
// ============================================================================
// Liste des campagnes (Mailing → Campagnes) : ce qu'on peut archiver, restaurer ou supprimer, et ce que
// chaque geste dit avant d'être confirmé (Eric 2026-11-22 : « il faut une possibilité de supprimer des
// campagnes, archivé et supprimé les deux »).
//
// Faits vérifiés avant d'écrire ces règles :
//  - le planificateur (`mail_campaigns_due`) et les edges (`_shared/texteEmail.ts`) ignorent une ligne
//    archivée : une campagne automatique archivée ne part plus ; un e-mail automatique de l'application
//    dont le texte est archivé ou supprimé repart avec son texte PAR DÉFAUT (registre) ;
//  - la boutique (`webshop-process`) n'a pas de repli : sans la ligne, son e-mail ne part plus — ces
//    e-mails, comme tout e-mail « sur évènement » inconnu du registre, ne s'archivent ni ne se suppriment ;
//  - le journal des envois est tenu par le NOM : supprimer une campagne ne supprime pas son historique.
// Module pur (imports relatifs seulement), testé `scripts/mail-campagnes-liste.test.mjs`.
// ============================================================================
import { natureDuMail } from './mailVariables.js';

/**
 * @typedef {{ visible: boolean, possible: boolean, raison: string | null, affiche: boolean }} Geste
 * `visible` : le geste existe pour cette campagne ; `possible` : il est ouvert ; `affiche` : son bouton se
 * montre — un geste fermé par un envoi en cours reste affiché (le clic dit pourquoi), un e-mail protégé n'en a pas.
 */

const RAISON_UTILISE = 'Cet e-mail est envoyé par l’application : sans lui, il ne partirait plus. Modifiez son texte plutôt.';
const RAISON_ENVOI = 'Un envoi de cette campagne est en cours. Attendez qu’il soit terminé.';

/** @param {boolean} visible @param {string | null} raison @returns {Geste} */
const geste = (visible, raison = null) => ({
  visible,
  possible: visible && !raison,
  raison: visible ? raison : null,
  affiche: visible && (!raison || raison === RAISON_ENVOI),
});

/**
 * Gestes proposés sur une campagne de la liste.
 * @param {{ campagne: Record<string, any> | null | undefined, isOrgAdmin: boolean, envoiEnCours?: boolean }} p
 * @returns {{ archiver: Geste, restaurer: Geste, supprimer: Geste }}
 */
export function gestesDeCampagne({ campagne, isOrgAdmin, envoiEnCours = false }) {
  if (!campagne || isOrgAdmin !== true) return { archiver: geste(false), restaurer: geste(false), supprimer: geste(false) };
  const archivee = campagne.is_archived === true;
  // `boutique` couvre les e-mails de la boutique ET tout e-mail « sur évènement » inconnu du registre.
  const utilise = natureDuMail(campagne) === 'boutique';
  const blocage = utilise ? RAISON_UTILISE : (envoiEnCours ? RAISON_ENVOI : null);
  return {
    archiver: geste(!archivee, blocage),
    restaurer: geste(archivee, null),
    // Une ligne archivée d'un e-mail utilisé par l'application ne sert déjà plus : la supprimer ne casse rien.
    supprimer: geste(true, archivee ? (envoiEnCours ? RAISON_ENVOI : null) : blocage),
  };
}

/** Ce que devient l'e-mail une fois sa ligne retirée, selon sa nature. */
function consequence(campagne) {
  switch (natureDuMail(campagne)) {
    case 'automatique':
      return 'Son envoi automatique s’arrête.';
    case 'sequence':
      return 'Cet e-mail ne partira plus vers vos prospects.';
    case 'auto_registre':
      return 'Cet e-mail continuera de partir, avec le texte par défaut de l’application à la place du vôtre.';
    default:
      return 'Elle ne pourra plus être envoyée.';
  }
}

/**
 * Texte de la confirmation d'archivage.
 * @param {Record<string, any>} campagne
 * @returns {{ titre: string, message: string, confirmer: string }}
 */
export function texteArchivage(campagne) {
  return {
    titre: `Archiver « ${campagne?.label ?? ''} » ?`,
    message: `${consequence(campagne)} Elle quitte la liste et reste dans les campagnes archivées, d’où vous pourrez la restaurer.`,
    confirmer: 'Archiver',
  };
}

/**
 * Texte de la confirmation de suppression.
 * @param {Record<string, any>} campagne
 * @param {number | undefined} nbEnvois envois au journal sous ce nom ; `undefined` = inconnu
 * @returns {{ titre: string, message: string, confirmer: string }}
 */
export function texteSuppression(campagne, nbEnvois) {
  let historique = ' L’historique de ses envois reste visible dans les statistiques.';
  if (nbEnvois === 0) historique = '';
  else if (nbEnvois === 1) historique = ' Son envoi reste visible dans les statistiques.';
  else if (typeof nbEnvois === 'number' && nbEnvois > 1) historique = ` Ses ${nbEnvois} envois restent visibles dans les statistiques.`;
  const suite = campagne?.is_archived === true ? '' : `${consequence(campagne)} `;
  return {
    titre: `Supprimer définitivement « ${campagne?.label ?? ''} » ?`,
    message: `${suite}Son texte et ses réglages sont effacés : cette suppression ne se rattrape pas.${historique}`,
    confirmer: 'Supprimer définitivement',
  };
}

/**
 * Ce qu'on écrit pour restaurer une campagne archivée. Une campagne automatique revient ÉTEINTE : elle ne
 * doit pas se remettre à écrire à tout un groupe parce qu'on l'a sortie des archives.
 * @param {Record<string, any>} campagne
 * @returns {{ is_archived: false, is_automated?: false }}
 */
export function champsDeRestauration(campagne) {
  return campagne?.is_automated === true ? { is_archived: false, is_automated: false } : { is_archived: false };
}

/**
 * Message affiché après une restauration.
 * @param {Record<string, any>} campagne
 * @returns {string}
 */
export function messageRestauration(campagne) {
  if (campagne?.is_automated !== true) return 'Campagne restaurée.';
  return natureDuMail(campagne) === 'sequence'
    ? 'E-mail restauré, éteint. Rallumez-le dans Réglages → E-mails & SMS → Séquences.'
    : 'Campagne restaurée, envoi automatique arrêté. Remettez-le en route depuis sa page si vous le voulez.';
}

/**
 * Campagnes de la liste, séparées en actives et archivées (triées par nom).
 * @param {ReadonlyArray<Record<string, any>> | null | undefined} campagnes
 * @returns {{ actives: Record<string, any>[], archivees: Record<string, any>[] }}
 */
export function separerArchivees(campagnes) {
  const liste = Array.isArray(campagnes) ? campagnes : [];
  const parNom = (a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'fr');
  return {
    actives: liste.filter((c) => c.is_archived !== true),
    archivees: liste.filter((c) => c.is_archived === true).sort(parNom),
  };
}
