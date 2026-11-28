// src/lib/cee/barTh112.js
// Module PUR (aucun import React / Supabase / alias) : verdict CEE BAR-TH-112 « Appareil indépendant de chauffage au
// bois » d'un poêle, à partir de `specs.canonical` de l'article (clés du schéma poêle, groupe « Performances CEE »).
// Source : fiche d'opération standardisée BAR-TH-112, version A46.3, lue le 2026-11-28 sur ecologie.gouv.fr
// (abrogée au 1er octobre 2027). Valeurs en mg/Nm³ à 13 % d'O2. Un appareil Flamme Verte est réputé satisfaire les
// conditions d'émissions : elles ne sont alors ni exigées ni jugées (Etas et norme le restent).
// JAMAIS BLOQUANT : ce verdict s'affiche sur la fiche article, aucun enregistrement n'en dépend.
// Testé : node --test scripts/cee-bar-th-112.test.mjs

/** Seuils de la fiche, par combustible. */
export const SEUILS_BAR_TH_112 = Object.freeze({
  bois: Object.freeze({ etas_min: 66, pm_max: 40, cog_max: 120, co_max: 1500, nox_max: 200 }),
  granules: Object.freeze({ etas_min: 80, pm_max: 20, cog_max: 60, co_max: 300, nox_max: 200 }),
});

const EMISSIONS = [
  ['pm_mg_nm3', 'pm_max'],
  ['cog_mgc_nm3', 'cog_max'],
  ['co_mg_nm3', 'co_max'],
  ['nox_mg_nm3', 'nox_max'],
];

/** @param {unknown} v @returns {number | null} */
function nombre(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Verdict BAR-TH-112 d'un poêle.
 * Priorité : hors_seuil > incomplet > conforme ; combustible autre que bois / granulés (hybride, absent) ⇒ inconnu.
 * @param {Record<string, unknown> | null | undefined} canonical
 * @returns {{ statut: 'conforme'|'hors_seuil'|'incomplet'|'inconnu', manquants: string[], depassements: Array<{ cle: string, valeur: number, seuil: number }>, remarques: string[] }}
 */
export function verdictBarTh112(canonical) {
  const c = canonical || {};
  if (c.fuel_type !== 'bois' && c.fuel_type !== 'granules') {
    return { statut: 'inconnu', manquants: [], depassements: [], remarques: [] };
  }
  const seuils = SEUILS_BAR_TH_112[c.fuel_type];
  const manquants = [];
  const depassements = [];
  const remarques = [];

  const etas = nombre(c.etas_pct);
  if (etas === null) manquants.push('etas_pct');
  else if (etas < seuils.etas_min) depassements.push({ cle: 'etas_pct', valeur: etas, seuil: seuils.etas_min });

  if (c.flamme_verte !== true) {
    for (const [cle, seuil] of EMISSIONS) {
      const v = nombre(c[cle]);
      if (v === null) manquants.push(cle);
      else if (v > seuils[seuil]) depassements.push({ cle, valeur: v, seuil: seuils[seuil] });
    }
  }

  const norme = typeof c.norme_mesure === 'string' ? c.norme_mesure.trim() : '';
  if (!norme) manquants.push('norme_mesure');
  else if (norme === 'EN 16510-1') remarques.push('norme EN 16510-1 : à faire accepter par l\'obligé');

  const statut = depassements.length ? 'hors_seuil' : manquants.length ? 'incomplet' : 'conforme';
  return { statut, manquants, depassements, remarques };
}
