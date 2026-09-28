// Gabarit G1 — création intérieure verticale (CFG-24/28/32). Géométrie PURE portée de la
// maquette maquette_metre_ptr30.html (compute()). Règles PROVISOIRES : l'encombrement des
// coudes est ignoré (cf. MAQUETTE_metre_svg.md §5). Unités : mètres, degrés, mm pour les tronçons.
import { composer } from '../compose.js';

const rad = (d) => (d * Math.PI) / 180;

/**
 * @param {{diametre:number, finition:string, hBuse:number, hsp1:number, epPl:number, nbEtages:number, hsp2:number,
 *   hCombles:number, pente:number, epToit:number, dFaitage:number, angle:number, decal:number, hSortie:number}} r relevé
 * @param {ReturnType<import('../config.js').buildFumisterieConfig>} cfg
 * @returns {{planchers:number, yC:number, dec:number, yRoofTop:number, yRidge:number, flat:boolean, yReq:number,
 *   reqAbove:number, vg:number, obl:number, yDevS:number, yDevE:number, devOK:boolean, Lsp:number, Lint:number,
 *   troncons: { raccordement_sp: {longueur_mm:number, composition:object}, conduit_interieur: {longueur_mm:number, composition:object},
 *     sortie_toit: {longueur_mm:number, composition:object} }, topAct:number, hAct:number, minSortie:number}}
 */
export function geometrieG1(r, cfg) {
  const planchers = 1 + (r.nbEtages ? 1 : 0);
  const yC = r.hsp1 + r.epPl + (r.nbEtages ? r.hsp2 + r.epPl : 0);
  const dec = r.angle > 0 ? r.decal : 0;
  const yRoofTop = yC + r.hCombles + r.epToit;
  const yRidge = yRoofTop + r.dFaitage * Math.tan(rad(r.pente));
  const flat = r.pente <= cfg.zone1.pente_plat_deg;
  const reqAbove = flat ? cfg.zone1.plat_m : cfg.zone1.pente_m;
  const yReq = (flat ? yRoofTop : yRidge) + reqAbove;
  const vg = r.angle > 0 ? dec / Math.tan(rad(r.angle)) : 0;
  const obl = r.angle > 0 ? dec / Math.sin(rad(r.angle)) : 0;
  const yDevS = yC + 0.30;
  const yDevE = yDevS + vg;
  const devOK = r.angle === 0 || yDevE <= yRoofTop - r.epToit - cfg.marge_combles_m;
  const Lsp = Math.max(0, r.hsp1 - r.hBuse);
  const Lint = (yRoofTop - r.hsp1) - vg + obl;
  const base = { longueurs: cfg.longueurs_elements_mm, reglable: cfg.reglable };
  const troncons = {
    raccordement_sp: { longueur_mm: Math.round(Lsp * 1000), composition: composer(Lsp * 1000, { ...base, avecReglable: false }) },
    conduit_interieur: { longueur_mm: Math.round(Lint * 1000), composition: composer(Lint * 1000, { ...base, avecReglable: cfg.reglable_interieur }) },
    sortie_toit: { longueur_mm: Math.round(r.hSortie * 1000), composition: composer(r.hSortie * 1000, { ...base, avecReglable: cfg.reglable_exterieur }) },
  };
  const topAct = yRoofTop + troncons.sortie_toit.composition.total / 1000 + troncons.conduit_interieur.composition.surlongueur / 1000;
  return { planchers, yC, dec, yRoofTop, yRidge, flat, yReq, reqAbove, vg, obl, yDevS, yDevE, devOK, Lsp, Lint, troncons,
    topAct, hAct: topAct - yRoofTop, minSortie: yReq - yRoofTop };
}

/**
 * Hauteur de sortie minimale (arrondie aux 5 cm) qui respecte la zone, surlongueur intérieure comprise.
 * @param {Parameters<typeof geometrieG1>[0]} r relevé
 * @param {Parameters<typeof geometrieG1>[1]} cfg config Fumisterie
 * @returns {number} hauteur de sortie minimale en mètres, arrondie aux 5 cm
 */
export function hauteurSortieMinimale(r, cfg) {
  const g0 = geometrieG1(r, cfg);
  let h = Math.ceil((g0.minSortie - g0.troncons.conduit_interieur.composition.surlongueur / 1000) * 20 - 1e-9) / 20;
  for (let k = 0; k < 12; k++) {
    const g = geometrieG1({ ...r, hSortie: h }, cfg);
    if (g.topAct >= g.yReq - 1e-6) break;
    h += 0.05;
  }
  return Math.round(h * 100) / 100;
}
