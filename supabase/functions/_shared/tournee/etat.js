// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/tournee/etat.js — ne pas éditer.
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
 * Secteur déduit d'une journée : **le premier entretien posé sur la journée
 * vierge fixe le secteur** (décision Eric, 2026-09-30) — celui du plus ancien
 * entretien / SAV non annulé (`created_at`) qui porte un grand secteur. Une
 * journée qui porte un entretien à Castres EST une journée Castres ; la machine
 * ne choisit un secteur que pour une journée entièrement vide. Ceux qui
 * s'ajoutent ensuite ne le changent pas (l'ancienne règle « secteur
 * majoritaire » tranchait les égalités par ordre alphabétique). Sans date de
 * création, l'heure du RDV départage, puis le nom — toujours déterministe.
 *
 * @param {Array<{ appointment_type?: string, status?: string, grand_secteur?: string|null, created_at?: string|null, scheduled_start?: string|null }>|null|undefined} rdvs
 * @returns {string|null} nom du grand secteur, ou null si aucun entretien localisé
 */
export function deduireSecteur(rdvs) {
  const localises = [];
  for (const r of rdvs || []) {
    if (!TYPES_ENTRETIEN.has(r.appointment_type)) continue;
    if (STATUTS_EXCLUS.has(r.status)) continue;
    const s = typeof r.grand_secteur === 'string' ? r.grand_secteur.trim() : '';
    if (!s) continue;
    localises.push({ secteur: s, pose: String(r.created_at || ''), heure: String(r.scheduled_start || '') });
  }
  if (localises.length === 0) return null;
  // '' (date inconnue) passe APRÈS toute date connue : un RDV daté fait foi.
  const ordre = (a, b) => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a < b ? -1 : 1);
  localises.sort((a, b) => ordre(a.pose, b.pose) || ordre(a.heure, b.heure) || a.secteur.localeCompare(b.secteur, 'fr'));
  return localises[0].secteur;
}

/**
 * Les heures de la journée sont-elles toutes communiquées ? Vrai quand elle
 * porte au moins un entretien / SAV actif et que chacun a son heure confirmée.
 * @param {Array<{ appointment_type?: string, hour_confirmed_at?: string|null }>} actifs
 */
function heuresToutesCommuniquees(actifs) {
  const entretiens = actifs.filter((r) => TYPES_ENTRETIEN.has(r.appointment_type));
  return entretiens.length > 0 && entretiens.every((r) => !!r.hour_confirmed_at);
}

/**
 * État d'une journée à partir du verdict du moteur (`verdictJournee` de
 * plein.js), de la trace de figeage et de l'étiquette de secteur.
 *
 * - figée (trace en base) prime sur tout : les heures sont définitives ;
 * - aucun RDV actif et aucune étiquette → vide ; étiquetée → ouverte ;
 * - `a_arbitrer` / `figeable` (= pleine) viennent du moteur ;
 * - journée SANS RDV adaptable (`sans_adaptable`) : le moteur n'a rien à y
 *   ordonnancer, mais elle n'est pas « ouverte » pour autant. Pleine (`pleine`,
 *   le `remplissage.pleine` du verdict) → **figée** si toutes ses heures
 *   d'entretien sont communiquées (journée figée avant que la trace existe, ou
 *   RDV par RDV), sinon **pleine** (une installation qui occupe le jour) ;
 * - tout le reste (`non_pleine`, `sans_adaptable` avec de la place, verdict absent) → ouverte.
 *
 * @param {{ rdvs: Array<{ status?: string, appointment_type?: string, hour_confirmed_at?: string|null }>|null|undefined, verdict: string|null|undefined, figeeAt: string|null|undefined, etiquette: string|null|undefined, pleine?: boolean|null }} p
 * @returns {EtatJournee}
 */
export function etatJournee({ rdvs, verdict, figeeAt, etiquette, pleine = false }) {
  if (figeeAt) return 'figee';
  const actifs = (rdvs || []).filter((r) => !STATUTS_EXCLUS.has(r.status));
  if (actifs.length === 0) return etiquette ? 'ouverte' : 'vide';
  if (verdict === 'a_arbitrer') return 'a_arbitrer';
  if (verdict === 'figeable') return 'pleine';
  if (verdict === 'sans_adaptable' && pleine) return heuresToutesCommuniquees(actifs) ? 'figee' : 'pleine';
  return 'ouverte';
}
