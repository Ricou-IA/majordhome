// src/lib/fumisterie/debouche.js
// Hauteur exigée du débouché — module PUR, seule définition (G1, G3). Règle de l'arrêté du 22/10/1969,
// art. 18, à laquelle renvoie le NF DTU 24.1 § 5.4.6 :
//   - 0,40 m au-dessus de toute partie de construction située à moins de 8 m ;
//   - toit de pente inférieure à 15° : 1,20 m au-dessus de la sortie, et 1 m au-dessus d'un acrotère de plus de 0,20 m.
// Le faîtage relevé (`dFaitage`, distance horizontale) est la partie de construction par défaut : à plus de 8 m,
// c'est le point du toit situé à 8 m qui compte. Un obstacle plus haut (complément facultatif) s'y ajoute.
import { lireComplement } from './complements.js';

const rad = (d) => (d * Math.PI) / 180;
const fmtM = (v) => Number(v).toFixed(2).replace('.', ',');

/**
 * @param {{ yToit:number, dFaitage:number, pente:number, releve:object,
 *   cfg:{ zone1:{ pente_m:number, plat_m:number, pente_plat_deg:number, distance_m?:number, acrotere_m?:number, acrotere_seuil_m?:number } } }} p
 *   yToit = altitude du point de sortie du toit (G1) ou de l'égout (G3), même origine que le relevé
 * @returns {{ flat:boolean, yReq:number, reqAbove:number, libelle:string, critere:'faitage'|'toit_8m'|'toit_plat'|'acrotere'|'obstacle' }}
 */
export function exigenceDebouche({ yToit, dFaitage, pente, releve, cfg }) {
  const z = cfg.zone1;
  const D = z.distance_m ?? 8;
  const flat = Number(pente) < z.pente_plat_deg;
  const candidats = [];
  if (flat) {
    candidats.push({ y: yToit + z.plat_m, base: yToit, marge: z.plat_m, critere: 'toit_plat', libelle: `Toit plat : +${fmtM(z.plat_m)} m` });
    const hAcr = lireComplement(releve, 'hAcrotere');
    if (hAcr != null && hAcr > (z.acrotere_seuil_m ?? 0.2)) {
      const m = z.acrotere_m ?? 1;
      candidats.push({ y: yToit + hAcr + m, base: yToit + hAcr, marge: m, critere: 'acrotere', libelle: `Acrotère + ${fmtM(m)} m` });
    }
  } else {
    const dRef = Math.min(Math.max(0, Number(dFaitage)), D);
    const faitage = Number(dFaitage) < D;
    const base = yToit + dRef * Math.tan(rad(Number(pente)));
    candidats.push({ y: base + z.pente_m, base, marge: z.pente_m, critere: faitage ? 'faitage' : 'toit_8m',
      libelle: faitage ? `Faîtage + ${Math.round(z.pente_m * 100)} cm (zone 1)` : `Toit à ${D} m + ${Math.round(z.pente_m * 100)} cm (zone 1)` });
  }
  const dObs = lireComplement(releve, 'obstacleDistance');
  const hObs = lireComplement(releve, 'obstacleHauteur');
  if (dObs != null && hObs != null && dObs < D) {
    candidats.push({ y: yToit + hObs + z.pente_m, base: yToit + hObs, marge: z.pente_m, critere: 'obstacle', libelle: `Obstacle à ${fmtM(dObs)} m + ${Math.round(z.pente_m * 100)} cm` });
  }
  const retenu = candidats.reduce((a, b) => (b.y > a.y ? b : a));
  return { flat, yReq: retenu.y, reqAbove: retenu.marge, libelle: retenu.libelle, critere: retenu.critere };
}
