/**
 * confirmationRdv.js — un RDV est-il confirmé au client ? (Eric 2026-11-23)
 * ============================================================================
 * Module PUR (aucun import React / Supabase), testé `scripts/confirmation-rdv.test.mjs`.
 * Seule définition de l'état de confirmation lu par la fenêtre du RDV, la vignette du
 * planning et le glisser-déposer.
 *
 * Deux faits distincts sur un RDV :
 *   - `client_confirmed_at` : le client a eu l'heure (appel, message) — posé à la main ;
 *     la base le retire si la date ou l'heure change (trigger, migration 20261123_1) ;
 *   - `hour_confirmed_at`   : l'heure est figée pour le moteur des tournées (une journée
 *     pleine se fige seule la nuit, sans prévenir le client) — ce n'est PAS une confirmation.
 * ============================================================================
 */

/** Un RDV posé depuis plus longtemps que ça et jamais confirmé est signalé « à confirmer ». */
export const SEUIL_A_CONFIRMER_JOURS = 30;

/** Types qui n'ont pas de client à prévenir. */
const SANS_CLIENT = new Set(['leave', 'other']);

/** Types dont le SMS de rappel (`rappel_rdv`) a du sens : son texte parle de l'entretien. */
const TYPES_RAPPEL = new Set(['maintenance', 'service']);

const JOUR_MS = 86_400_000;

/** Date locale `YYYY-MM-DD` (jamais `toISOString`, qui recule d'un jour la nuit). */
function jourLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * État de confirmation d'un RDV.
 * @param {{ appointment_type?: string, status?: string, scheduled_date?: string,
 *   created_at?: string, client_confirmed_at?: (string|null) } | null | undefined} rdv
 * @param {Date} [maintenant]
 * @returns {{ etat: 'sans_objet'|'confirme'|'provisoire'|'a_confirmer', joursDepuisPose: (number|null) }}
 *   `sans_objet` : congés, « Autre », RDV annulé ou terminé ;
 *   `a_confirmer` : à venir, jamais confirmé, posé depuis plus de SEUIL_A_CONFIRMER_JOURS jours.
 */
export function etatConfirmation(rdv, maintenant = new Date()) {
  if (!rdv) return { etat: 'sans_objet', joursDepuisPose: null };
  if (SANS_CLIENT.has(rdv.appointment_type) || ['cancelled', 'completed'].includes(rdv.status)) {
    return { etat: 'sans_objet', joursDepuisPose: null };
  }
  const cree = rdv.created_at ? new Date(rdv.created_at) : null;
  const joursDepuisPose = cree && !Number.isNaN(cree.getTime())
    ? Math.floor((maintenant.getTime() - cree.getTime()) / JOUR_MS)
    : null;
  if (rdv.client_confirmed_at) return { etat: 'confirme', joursDepuisPose };
  const aVenir = !rdv.scheduled_date || rdv.scheduled_date >= jourLocal(maintenant);
  if (aVenir && joursDepuisPose != null && joursDepuisPose > SEUIL_A_CONFIRMER_JOURS) {
    return { etat: 'a_confirmer', joursDepuisPose };
  }
  return { etat: 'provisoire', joursDepuisPose };
}

/**
 * Déplacer ce RDV demande-t-il un accord ? Oui s'il est confirmé au client et pas encore passé :
 * le client a eu une heure, le déplacer oblige à le rappeler (et retire la confirmation).
 * @param {Parameters<typeof etatConfirmation>[0]} rdv
 * @param {Date} [maintenant]
 * @returns {boolean}
 */
export function deplacementDemandeAccord(rdv, maintenant = new Date()) {
  if (etatConfirmation(rdv, maintenant).etat !== 'confirme') return false;
  return !rdv.scheduled_date || rdv.scheduled_date >= jourLocal(maintenant);
}

/**
 * Le bouton « Envoyer un rappel » est-il proposé pour ce RDV ?
 * @param {{ appointment_type?: string, status?: string } | null | undefined} rdv
 * @returns {boolean}
 */
export function rappelPropose(rdv) {
  return !!rdv && TYPES_RAPPEL.has(rdv.appointment_type) && !['cancelled', 'completed'].includes(rdv.status);
}

/**
 * Champs à écrire pour confirmer (ou retirer la confirmation de) un RDV.
 * Confirmer fige aussi l'heure d'un RDV adaptable : le moteur des tournées ne doit plus
 * le décaler seul (ce serait annoncer une heure puis la changer). Retirer la confirmation
 * ne défige rien : c'est un autre geste (souplesse du RDV).
 * @param {{ hour_confirmed_at?: (string|null), time_flex_minutes?: (number|null) }} rdv
 * @param {boolean} confirme
 * @param {{ adaptable: boolean, maintenant?: Date }} options
 * @returns {Record<string, string|number|null>}
 */
export function champsDeConfirmation(rdv, confirme, { adaptable, maintenant = new Date() }) {
  if (!confirme) return { client_confirmed_at: null };
  const iso = maintenant.toISOString();
  const champs = { client_confirmed_at: iso };
  // « Figé » = souplesse 0 + heure figée (même convention que la fenêtre du RDV,
  // qui efface hour_confirmed_at à l'enregistrement dès que la souplesse n'est pas 0).
  if (adaptable && !rdv?.hour_confirmed_at) champs.hour_confirmed_at = iso;
  if (adaptable && rdv?.time_flex_minutes !== 0) champs.time_flex_minutes = 0;
  return champs;
}
