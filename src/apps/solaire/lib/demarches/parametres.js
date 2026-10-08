// src/apps/solaire/lib/demarches/parametres.js
// Paramètres du module Démarches (délais réglementaires + tarifs DATÉS).
// Source de vérité : core.organizations.settings.pv.demarches, édité dans
// Settings → Solaire → Démarches. PUR : aucun import React/Supabase.
//
// Tarifs = listes `{ date_effet, valeur, valide_jusqu_au?, note?, source? }` :
// la valeur en vigueur à une date = dernière entrée dont date_effet ≤ date.
// Une liste vide ⇒ null (jamais 0) ; le moteur lève `parametre_manquant`.

/** @typedef {{ date_effet: string, valeur: number, valide_jusqu_au?: string, note?: string, source?: string }} EntreeDatee */

export const DEMARCHES_DEFAULTS = {
  delais: {
    depot_dp:           { jours: 7 },
    instruction_dp:     { mois: 1 },
    instruction_dp_abf: { mois: 2 },
    recours_tiers:      { mois: 2 },
    enedis_cacsi:       { mois: 2 },
    enedis_surplus:     { mois: 3 },
    duree_pose:         { jours: 2 },
    consuel:            { jours: 21 },
    mise_en_service:    { jours: 42 },
  },
  tarifs: {
    frais_raccordement_enedis: [
      { date_effet: '2026-01-01', valeur: 50.10, valide_jusqu_au: '2026-10-27', note: 'Nouveau barème au 28/10/2026 à saisir' },
    ],
    tarif_consuel_bleu: [{ date_effet: '2026-01-01', valeur: 195.20, source: 'Consuel 2026' }],
    tarif_consuel_violet: [],
    tarif_oa_surplus_lte_9kwc: [{ date_effet: '2026-06-05', valeur: 1.1, source: 'Arrêté du 01/06/2026' }],
    tarif_oa_surplus_gt_9kwc: [],
    prime_autoconsommation: [{ date_effet: '2026-06-05', valeur: 0, note: 'Supprimée pour toute demande complète déposée à partir du 05/06/2026' }],
  },
  prise_en_charge_defaut: { raccordement_enedis: 'refacture', consuel: 'refacture' },
};

/** Libellés et unités des délais (onglet Settings + hypothèses du planning). */
export const DELAIS_META = {
  depot_dp:           { libelle: 'Dépôt de la DP après le départ', unite: 'jours' },
  instruction_dp:     { libelle: 'Instruction de la DP (hors périmètre ABF)', unite: 'mois' },
  instruction_dp_abf: { libelle: 'Instruction de la DP (périmètre ABF)', unite: 'mois' },
  recours_tiers:      { libelle: 'Recours des tiers après affichage', unite: 'mois' },
  enedis_cacsi:       { libelle: 'Réponse Enedis — convention CACSI', unite: 'mois' },
  enedis_surplus:     { libelle: 'Réponse Enedis — demande complète (surplus)', unite: 'mois' },
  duree_pose:         { libelle: 'Durée de pose', unite: 'jours' },
  consuel:            { libelle: 'Obtention de l’attestation Consuel', unite: 'jours' },
  mise_en_service:    { libelle: 'Mise en service Enedis après Consuel', unite: 'jours' },
};

/** Libellés et unités des tarifs datés. */
export const TARIFS_META = {
  frais_raccordement_enedis: { libelle: 'Frais de raccordement Enedis (surplus, Linky)', unite: '€ TTC' },
  tarif_consuel_bleu:        { libelle: 'Attestation Consuel — visa bleu', unite: '€ TTC' },
  tarif_consuel_violet:      { libelle: 'Attestation Consuel — visa violet (batterie)', unite: '€ TTC' },
  tarif_oa_surplus_lte_9kwc: { libelle: 'Tarif de rachat du surplus ≤ 9 kWc', unite: 'c€/kWh' },
  tarif_oa_surplus_gt_9kwc:  { libelle: 'Tarif de rachat du surplus > 9 kWc', unite: 'c€/kWh' },
  prime_autoconsommation:    { libelle: 'Prime à l’autoconsommation (non affichée)', unite: '€' },
};

/**
 * Valeur en vigueur à une date : dernière entrée dont date_effet ≤ dateIso.
 * @param {EntreeDatee[]|undefined} liste
 * @param {string} dateIso YYYY-MM-DD
 * @returns {{ valeur: number, date_effet: string, valide_jusqu_au: string|null, note: string|null, perimee: boolean } | null}
 */
export function valeurA(liste, dateIso) {
  if (!Array.isArray(liste) || liste.length === 0) return null;
  const enVigueur = liste
    .filter((e) => e && typeof e.date_effet === 'string' && e.date_effet <= dateIso)
    .sort((a, b) => (a.date_effet < b.date_effet ? 1 : a.date_effet > b.date_effet ? -1 : 0))[0];
  if (!enVigueur || typeof enVigueur.valeur !== 'number') return null;
  return {
    valeur: enVigueur.valeur,
    date_effet: enVigueur.date_effet,
    valide_jusqu_au: enVigueur.valide_jusqu_au ?? null,
    note: enVigueur.note ?? null,
    perimee: typeof enVigueur.valide_jusqu_au === 'string' && enVigueur.valide_jusqu_au < dateIso,
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/**
 * Paramètres effectifs = settings.pv.demarches mergés sur les défauts
 * (objets fusionnés clé à clé, listes datées REMPLACÉES).
 * @param {object|undefined} settings core.organizations.settings
 */
export function buildDemarchesParams(settings) {
  return deepMerge(DEMARCHES_DEFAULTS, settings?.pv?.demarches);
}
