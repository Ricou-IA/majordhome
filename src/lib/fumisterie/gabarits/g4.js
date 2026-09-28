// Gabarit G4 — tubage d'un conduit existant (CFG-26/27/34/35). Géométrie PURE, règles
// PROVISOIRES (spec 2026-09-29-fumisterie-tranche2-g4-tubage-design.md §3). Unités : mètres en
// entrée, mm pour les tronçons composés, mètres pour le flexible vendu au ml.
// Deux codes de gabarit partagent cette géométrie : G4 (flexible) et G4R (rigide PRH).
import { composer } from '../compose.js';

/**
 * @param {{diametre:number, hBuse:number, entree:'plafond'|'mur', hsp1:number, hEntree?:number, lHoriz?:number,
 *   hConduit:number, boisseau:number|string, rigide?:boolean}} r relevé (rigide = posé par le moteur selon le gabarit)
 * @param {ReturnType<import('../config.js').buildFumisterieConfig>} cfg
 * @returns {{rigide:boolean, mur:boolean, yEntree:number, ySouche:number, Lsp_v:number, Lsp_h:number, Lsp:number, Lflex:number,
 *   troncons: { raccordement_sp: {longueur_mm:number, composition:object}, conduit_existant: {longueur_mm:number, composition:object|null, ml:number|null} }}}
 */
export function geometrieG4(r, cfg) {
  const rigide = !!r.rigide;
  const mur = r.entree === 'mur';
  const yEntree = mur ? Number(r.hEntree) : Number(r.hsp1);
  const ySouche = yEntree + Number(r.hConduit);
  const Lsp_v = Math.max(0, yEntree - Number(r.hBuse));
  const Lsp_h = mur ? Math.max(0, Number(r.lHoriz)) : 0;
  const Lsp = Lsp_v + Lsp_h;
  // PRH 6/10 (Ø ≥ 130) se compose en 1000/500/330, PRH 5/10 (Ø 80/100, pellets) en 1000/500/250 : ce sont les
  // longueurs réellement au tarif, sinon la nomenclature sortirait un « Lg 330 Ø80 » introuvable.
  const longueursPrh = Number(r.diametre) <= 100 ? cfg.longueurs_prh_5_10_mm : cfg.longueurs_prh_mm;
  const longueursSp = rigide ? longueursPrh : cfg.longueurs_elements_mm;
  const base = { reglable: cfg.reglable, avecReglable: false };
  const raccordement_sp = { longueur_mm: Math.round(Lsp * 1000), composition: composer(Lsp * 1000, { ...base, longueurs: longueursSp }) };
  let conduit_existant;
  let Lflex = 0;
  if (rigide) {
    conduit_existant = { longueur_mm: Math.round(r.hConduit * 1000), composition: composer(r.hConduit * 1000, { ...base, longueurs: longueursPrh }), ml: null };
  } else {
    const pas = cfg.flexible_arrondi_m > 0 ? cfg.flexible_arrondi_m : 0.5;
    Lflex = Math.ceil((Number(r.hConduit) + cfg.flexible_marge_m) / pas - 1e-9) * pas;
    Lflex = Math.round(Lflex * 100) / 100;
    conduit_existant = { longueur_mm: Math.round(r.hConduit * 1000), composition: null, ml: Lflex };
  }
  return { rigide, mur, yEntree, ySouche, Lsp_v, Lsp_h, Lsp, Lflex, troncons: { raccordement_sp, conduit_existant } };
}
