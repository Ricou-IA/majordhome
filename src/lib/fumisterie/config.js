// Défauts org du module Fumisterie — module PUR. Valeurs org : core.organizations.settings.fumisterie
// (Settings → Entretiens & Contrats → Fumisterie). ⚠ org_update_settings merge niveau 1 → sauver l'objet COMPLET.

/** @type {{
 *   finition_defaut: string,
 *   longueurs_elements_mm: number[],
 *   reglable: { min: number, max: number },
 *   reglable_interieur: boolean,
 *   reglable_exterieur: boolean,
 *   colliers_par_emboitement: number,
 *   marge_combles_m: number,
 *   haubanage_m: number,
 *   zone1: { pente_m: number, plat_m: number, pente_plat_deg: number },
 *   tva_fournitures: number,
 *   tva_pose: number,
 * }}
 */
export const DEFAULTS_FUMISTERIE = Object.freeze({
  finition_defaut: 'noir',              // finition extérieure proposée (noir | inox)
  longueurs_elements_mm: Object.freeze([1000, 500, 250]), // éléments droits, du plus long au plus court
  reglable: Object.freeze({ min: 320, max: 500 }),       // plage de l'élément réglable
  reglable_interieur: true,             // utiliser un réglable pour la partie intérieure
  reglable_exterieur: true,             // idem au-dessus du toit
  colliers_par_emboitement: 1,          // colliers de jonction extérieurs
  marge_combles_m: 0.10,                // marge sous toiture pour le dévoiement
  haubanage_m: 3,                       // conduit libre au-dessus du toit avant haubanage (catalogue p.33)
  zone1: Object.freeze({ pente_m: 0.40, plat_m: 1.20, pente_plat_deg: 15 }), // catalogue p.23
  tva_fournitures: 20,
  tva_pose: 10,
});

/**
 * Construit la config Fumisterie effective pour une org : défauts + surcharge par
 * `settings.fumisterie`. Merge profond niveau 2 (objets `zone1` / `reglable`), tableaux remplacés.
 * @param {{ fumisterie?: object } | null | undefined} settings `core.organizations.settings`
 * @returns {typeof DEFAULTS_FUMISTERIE} config Fumisterie fusionnée
 */
export function buildFumisterieConfig(settings) {
  const s = settings?.fumisterie || {};
  const out = { ...DEFAULTS_FUMISTERIE, ...s };
  out.zone1 = { ...DEFAULTS_FUMISTERIE.zone1, ...(s.zone1 || {}) };
  out.reglable = { ...DEFAULTS_FUMISTERIE.reglable, ...(s.reglable || {}) };
  out.longueurs_elements_mm = [...(s.longueurs_elements_mm || DEFAULTS_FUMISTERIE.longueurs_elements_mm)].sort((a, b) => b - a);
  return out;
}
