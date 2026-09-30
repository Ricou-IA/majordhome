/**
 * chantierSplit.js — règles d'aperçu des gestes Grouper / Détacher d'un chantier.
 * ============================================================================
 * Module PUR (aucun import React / Supabase) : testé par `scripts/chantier-split.test.mjs`
 * (inclus dans `audit:quality`). Les RPC `chantier_detach` / `chantier_group` portent les
 * MÊMES règles côté base ; ce module ne fait que prévenir l'utilisateur avant l'appel.
 *
 * Spec : docs/superpowers/specs/2026-09-30-chantier-entite-par-devis-design.md
 * ============================================================================
 */

/** Ordre des statuts chantier (même rang que majordhome.chantier_status_rank). */
export const STATUT_ORDRE = ['gagne', 'commande_a_faire', 'commande_recue', 'planification', 'realise', 'facture'];

function montantDe(quotes) {
  return Math.round(
    quotes.filter((q) => q?.is_validated).reduce((acc, q) => acc + (Number(q.quote_amount_ht) || 0), 0) * 100,
  ) / 100;
}

function joursDe(appointments) {
  return new Set(appointments.map((a) => a?.scheduled_date).filter(Boolean)).size;
}

/**
 * Aperçu d'un détachement : ce qui reste sur l'origine, ce qui part dans le nouveau chantier.
 * @param {{quotes: Array<{id: string, is_validated?: boolean, quote_amount_ht?: number|string}>, appointments: Array<{id: string, scheduled_date?: string}>, plannedOrder?: {teamSize?: number|null, days?: number|null}|null}} chantier
 * @param {{quoteIds?: string[], appointmentIds?: string[], movePlannedOrder?: boolean}} selection
 * @returns {{origine: {montant: number, jours: number, devis: number}, nouveau: {montant: number, jours: number, devis: number}, erreurs: string[], ok: boolean}}
 */
export function resumeDetachement(chantier, selection) {
  const quotes = Array.isArray(chantier?.quotes) ? chantier.quotes : [];
  const appointments = Array.isArray(chantier?.appointments) ? chantier.appointments : [];
  const quoteIds = new Set(selection?.quoteIds || []);
  const appointmentIds = new Set(selection?.appointmentIds || []);
  const erreurs = [];

  const quotesConnus = new Set(quotes.map((q) => q.id));
  const apptsConnus = new Set(appointments.map((a) => a.id));
  if ([...quoteIds].some((id) => !quotesConnus.has(id))) erreurs.push(`Un devis sélectionné n'appartient pas à ce chantier.`);
  if ([...appointmentIds].some((id) => !apptsConnus.has(id))) erreurs.push(`Un jour sélectionné n'appartient pas à ce chantier.`);

  const partent = quotes.filter((q) => quoteIds.has(q.id));
  const restent = quotes.filter((q) => !quoteIds.has(q.id));
  if (erreurs.length === 0) {
    if (!partent.some((q) => q.is_validated)) erreurs.push('Choisissez au moins un devis validé à détacher.');
    else if (!restent.some((q) => q.is_validated)) erreurs.push(`Le chantier d'origine doit garder au moins un devis validé.`);
  }

  const apptsPartent = appointments.filter((a) => appointmentIds.has(a.id));
  const apptsRestent = appointments.filter((a) => !appointmentIds.has(a.id));
  return {
    origine: { montant: montantDe(restent), jours: joursDe(apptsRestent), devis: restent.length },
    nouveau: { montant: montantDe(partent), jours: joursDe(apptsPartent), devis: partent.length },
    erreurs,
    ok: erreurs.length === 0,
  };
}

/**
 * La commande « personnes × jours » suit par défaut quand les jours sélectionnés valent `planned_days`.
 * @param {{teamSize?: number|null, days?: number|null}|null|undefined} plannedOrder
 * @param {number} joursSelectionnes
 * @returns {boolean}
 */
export function commandeSuitParDefaut(plannedOrder, joursSelectionnes) {
  const days = Number(plannedOrder?.days) || 0;
  return days > 0 && Number(joursSelectionnes) === days;
}

/**
 * Aperçu d'un groupement : cible + sources réunies (mêmes règles que chantier_group).
 * @param {{linked_quotes_amount_ht?: number|string, quotes_count?: number|string, validated_quotes_count?: number|string, chantier_status?: string}} cible
 * @param {Array<typeof cible>} sources
 * @returns {{montant: number, devis: number, devisValides: number, statut: string}}
 */
export function resumeGroupement(cible, sources) {
  const tous = [cible, ...(Array.isArray(sources) ? sources : [])].filter(Boolean);
  const montant = Math.round(tous.reduce((acc, c) => acc + (Number(c.linked_quotes_amount_ht) || 0), 0) * 100) / 100;
  const devis = tous.reduce((acc, c) => acc + (Number(c.quotes_count) || 0), 0);
  const devisValides = tous.reduce((acc, c) => acc + (Number(c.validated_quotes_count) || 0), 0);
  const statut = tous.reduce(
    (best, c) => (STATUT_ORDRE.indexOf(c.chantier_status) > STATUT_ORDRE.indexOf(best) ? c.chantier_status : best),
    cible?.chantier_status || 'gagne',
  );
  return { montant, devis, devisValides, statut };
}
