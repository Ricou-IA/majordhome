// Gabarit G3 — création extérieure en façade (CFG-25 PTR, CFG-33 PLA + PTR). Géométrie PURE, règles
// PROVISOIRES (spec tranche 3). L'appareil est à l'intérieur ; le raccordement sort par le mur à
// `hTraversee`, un té 90° au pied du conduit extérieur, puis le conduit isolé monte le long de la façade
// jusqu'à `hMur + hSortie` (hMur = hauteur de l'égout de toit, hSortie = hauteur visée au-dessus de l'égout).
// Zone 1 : comme G1, le sommet doit dépasser le faîtage de `zone1.pente_m` (ou l'égout de `plat_m` si toit plat).
import { composer } from '../compose.js';

const rad = (d) => (d * Math.PI) / 180;

/**
 * @param {{diametre:number, hBuse:number, hsp1:number, hTraversee:number, lHoriz:number, epMur:number, hMur:number,
 *   pente:number, dFaitage:number, hSortie:number}} r relevé
 * @param {ReturnType<import('../config.js').buildFumisterieConfig>} cfg
 */
export function geometrieG3(r, cfg) {
  const yTe = Number(r.hTraversee);
  const Lsp_v = Math.max(0, yTe - Number(r.hBuse));
  const Lsp_h = Math.max(0, Number(r.lHoriz));
  const Lsp = Lsp_v + Lsp_h;
  const Ltrav = Number(r.epMur) + 0.2; // élément qui traverse le mur jusqu'au té (20 cm de débord)
  const yEgout = Number(r.hMur);
  const flat = Number(r.pente) <= cfg.zone1.pente_plat_deg;
  const yRidge = yEgout + Number(r.dFaitage) * Math.tan(rad(Number(r.pente)));
  const reqAbove = flat ? cfg.zone1.plat_m : cfg.zone1.pente_m;
  const yReq = (flat ? yEgout : yRidge) + reqAbove;
  const Lfac = Math.max(0, yEgout + Number(r.hSortie) - yTe);
  const base = { longueurs: cfg.longueurs_elements_mm, reglable: cfg.reglable };
  const troncons = {
    raccordement_sp: { longueur_mm: Math.round(Lsp * 1000), composition: composer(Lsp * 1000, { ...base, avecReglable: false }) },
    traversee_mur: { longueur_mm: Math.round(Ltrav * 1000), composition: composer(Ltrav * 1000, { ...base, avecReglable: false }) },
    facade: { longueur_mm: Math.round(Lfac * 1000), composition: composer(Lfac * 1000, { ...base, avecReglable: cfg.reglable_exterieur }) },
  };
  const topAct = yTe + troncons.facade.composition.total / 1000;
  return { mur: true, yTe, yEgout, yRidge, flat, reqAbove, yReq, Lsp_v, Lsp_h, Lsp, Ltrav, Lfac, troncons, topAct,
    hAct: topAct - yEgout, minSortie: yReq - yEgout, hLibre: Math.max(0, topAct - yEgout) };
}

/**
 * Hauteur de sortie minimale (au-dessus de l'égout, arrondie aux 5 cm) qui respecte la zone 1.
 * @param {Parameters<typeof geometrieG3>[0]} r
 * @param {Parameters<typeof geometrieG3>[1]} cfg
 * @returns {number}
 */
export function hauteurSortieMinimaleG3(r, cfg) {
  const g0 = geometrieG3(r, cfg);
  let h = Math.ceil(g0.minSortie * 20 - 1e-9) / 20;
  for (let k = 0; k < 12; k++) {
    const g = geometrieG3({ ...r, hSortie: h }, cfg);
    if (g.topAct >= g.yReq - 1e-6) break;
    h += 0.05;
  }
  return Math.round(h * 100) / 100;
}
