/**
 * tonsStatut.js — ton visuel de chaque statut métier (module PUR, testé scripts/tons-statut.test.mjs).
 *
 * Source unique de la correspondance statut → ton (brief UI § 3), consommée par StatusPill.
 * Les clés sont celles STOCKÉES en base (pas les libellés). Le cuivre n'est jamais un ton.
 */

/** @typedef {'neutre'|'info'|'ok'|'attente'|'alerte'} Ton */

/** @type {readonly Ton[]} */
export const TONS = Object.freeze(['neutre', 'info', 'ok', 'attente', 'alerte']);

/** Jours sans relance au-delà desquels un devis envoyé passe en « attente ». */
const SEUIL_RELANCE_JOURS = 21;

// Lead : clés des statuts du pipeline.
const LEAD = Object.freeze({
  nouveau: 'neutre',
  contacte: 'info',
  rdv_planifie: 'info',
  devis_envoye: 'attente',
  gagne: 'ok',
  perdu: 'alerte',
});

// Devis : statuts Pennylane (`quote_status`) + brouillon.
const DEVIS = Object.freeze({
  draft: 'neutre',
  pending: 'info', // « attente » au-delà de SEUIL_RELANCE_JOURS (voir toneFor)
  expired: 'alerte',
  accepted: 'ok',
  invoiced: 'ok',
  refused: 'alerte',
  denied: 'alerte',
  canceled: 'alerte',
});

// Chantier : `CHANTIER_STATUSES` (chantiers.service.js).
const CHANTIER = Object.freeze({
  gagne: 'attente',
  commande_a_faire: 'attente',
  commande_recue: 'attente', // libellé « À planifier »
  planification: 'info', // libellé « Planifié »
  realise: 'ok',
  facture: 'ok',
});

// Contrat : `contracts.status` (active, pending, cancelled, archived), `workflow_status` proposal_sent ;
// `expired` et `a_renouveler` sont des états dérivés (non stockés).
const CONTRAT = Object.freeze({
  active: 'ok',
  a_renouveler: 'attente',
  expired: 'alerte',
  cancelled: 'neutre', // Clos : aucune action attendue
  proposal_sent: 'attente', // proposition envoyée, sans réponse
  pending: 'neutre',
  archived: 'neutre',
});

// Entretien / SAV : `workflow_status` (ENTRETIEN_STATUSES + SAV_STATUSES de sav.service.js).
const ENTRETIEN = Object.freeze({
  demande: 'alerte', // Demande SAV
  urgent: 'alerte',
  devis_envoye: 'attente',
  pieces_commandees: 'attente',
  demande_contrat: 'attente',
  a_planifier: 'info',
  planifie: 'info',
  certificat_a_faire: 'info',
  realise: 'ok',
  facture: 'ok',
});

// Verdict CEE BAR-TH-112 d'un poêle (`verdictBarTh112().statut`, src/lib/cee/barTh112.js).
const CEE = Object.freeze({
  conforme: 'ok',
  hors_seuil: 'alerte',
  incomplet: 'attente',
  inconnu: 'neutre',
});

const TABLES = Object.freeze({
  cee: CEE,
  lead: LEAD,
  devis: DEVIS,
  chantier: CHANTIER,
  contrat: CONTRAT,
  entretien: ENTRETIEN,
});

/**
 * Ton d'un statut. Ne lève jamais : domaine ou valeur inconnus, null, undefined → 'neutre'.
 * @param {'lead'|'devis'|'chantier'|'contrat'|'entretien'} domaine
 * @param {string|null|undefined} valeur clé stockée du statut
 * @param {{ joursSansRelance?: number }} [contexte] devis : jours sans relance
 * @returns {Ton}
 */
export function toneFor(domaine, valeur, contexte) {
  if (valeur === null || valeur === undefined) return 'neutre';
  const table = Object.hasOwn(TABLES, domaine) ? TABLES[domaine] : null;
  if (!table) return 'neutre';
  const cle = String(valeur).trim();
  if (!Object.hasOwn(table, cle)) return 'neutre';
  if (domaine === 'devis' && cle === 'pending' && Number(contexte?.joursSansRelance) > SEUIL_RELANCE_JOURS) {
    return 'attente';
  }
  return table[cle];
}
