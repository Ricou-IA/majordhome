// ============================================================================
// État d'une journée de technicien — module PUR (aucun import React / Supabase).
// Une seule définition, partagée par le Planning (bandeau), le Dashboard et,
// plus tard, l'auto-RDV. Spec 2026-09-29 « auto-RDV d'entretien mensuel » § 3.1.
//
// Les cinq états : vide (rien, pas d'étiquette) · ouverte (il reste de la place,
// ou la machine y attend des clients) · pleine (verdict `figeable` du moteur) ·
// figee (heures définitives, trace en base) · a_arbitrer (pleine mais aucun
// ordre ne tient). L'état n'est jamais stocké : il se dérive à la lecture.
// ============================================================================

/** @typedef {'vide'|'ouverte'|'pleine'|'figee'|'a_arbitrer'} EtatJournee */

/** Libellés FR des états, source unique pour l'UI. */
export const LIBELLES_ETAT = Object.freeze({
  vide: 'Vide',
  ouverte: 'Ouverte',
  pleine: 'Pleine',
  figee: 'Figée',
  a_arbitrer: 'À arbitrer',
});

const TYPES_ENTRETIEN = new Set(['maintenance', 'service']);
const STATUTS_EXCLUS = new Set(['cancelled', 'no_show']);

/**
 * Secteur déduit d'une journée : le grand secteur majoritaire de ses entretiens
 * et SAV non annulés. Une journée qui porte un entretien à Castres EST une
 * journée Castres (décision Eric, 2026-09-29) — la machine ne choisit un
 * secteur que pour une journée entièrement vide. Égalité → ordre alphabétique.
 *
 * @param {Array<{ appointment_type?: string, status?: string, grand_secteur?: string|null }>|null|undefined} rdvs
 * @returns {string|null} nom du grand secteur, ou null si aucun entretien localisé
 */
export function deduireSecteur(rdvs) {
  const comptes = new Map();
  for (const r of rdvs || []) {
    if (!TYPES_ENTRETIEN.has(r.appointment_type)) continue;
    if (STATUTS_EXCLUS.has(r.status)) continue;
    const s = typeof r.grand_secteur === 'string' ? r.grand_secteur.trim() : '';
    if (!s) continue;
    comptes.set(s, (comptes.get(s) || 0) + 1);
  }
  if (comptes.size === 0) return null;
  return [...comptes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0][0];
}

/**
 * État d'une journée à partir du verdict du moteur (`verdictJournee` de
 * plein.js), de la trace de figeage et de l'étiquette de secteur.
 *
 * - figée (trace en base) prime sur tout : les heures sont définitives ;
 * - aucun RDV actif et aucune étiquette → vide ; étiquetée → ouverte ;
 * - `a_arbitrer` / `figeable` (= pleine) viennent du moteur ;
 * - tout le reste (`non_pleine`, `sans_adaptable` avec des RDV, verdict absent) → ouverte.
 *
 * @param {{ rdvs: Array<{ status?: string }>|null|undefined, verdict: string|null|undefined, figeeAt: string|null|undefined, etiquette: string|null|undefined }} p
 * @returns {EtatJournee}
 */
export function etatJournee({ rdvs, verdict, figeeAt, etiquette }) {
  if (figeeAt) return 'figee';
  const actifs = (rdvs || []).filter((r) => !STATUTS_EXCLUS.has(r.status));
  if (actifs.length === 0) return etiquette ? 'ouverte' : 'vide';
  if (verdict === 'a_arbitrer') return 'a_arbitrer';
  if (verdict === 'figeable') return 'pleine';
  return 'ouverte';
}
