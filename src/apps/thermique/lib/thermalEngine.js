// src/apps/thermique/lib/thermalEngine.js
// Moteur de déperditions EN 12831 simplifié — module PUR (aucun import).
// Unités : e en m, lambda en W/(m·K), U en W/(m²·K), surfaces en m², puissances en W, θ en °C.
//
// Vocabulaire des types : ce module utilise mur|plafond|plancher (flux thermique, EN ISO 6946) ;
// refDataResolvers utilise mur|plancherBas|plafond|fenetre (tables U par défaut). Le mapping se
// fait à l'assemblage (Task 6/plan 4) : plancherBas→plancher, fenetre→(pas de Rsi/Rse : U saisi
// directement).

/** Résistances superficielles Rsi+Rse (EN ISO 6946) par type de flux. */
export const RSI_RSE = { mur: 0.17, plafond: 0.14, plancher: 0.21 };

/**
 * U d'une paroi par composition. Couche = { e, lambda } OU { r } (résistance directe), exclusifs :
 * une couche fournissant à la fois r et e/lambda est ambiguë (erreur de saisie) et rejetée.
 * @param {Array<{e?:number, lambda?:number, r?:number}>} couches
 * @param {'mur'|'plafond'|'plancher'} type — pilote Rsi+Rse
 */
export function calculeUParoi(couches, type) {
  const rsirse = RSI_RSE[type];
  if (rsirse === undefined) throw new Error(`thermique: type de paroi « ${type} » inconnu (mur|plafond|plancher)`);
  if (!Array.isArray(couches) || couches.length === 0) throw new Error('thermique: composition vide');
  let r = rsirse;
  for (const c of couches) {
    if (c === null || typeof c !== 'object') throw new Error('thermique: couche invalide (objet attendu)');
    if (c.r !== undefined && (c.e !== undefined || c.lambda !== undefined)) {
      throw new Error(`thermique: couche ambiguë (r et e/lambda fournis): ${JSON.stringify(c)}`);
    }
    if (Number.isFinite(c.r) && c.r > 0) { r += c.r; continue; }
    if (!Number.isFinite(c.e) || !Number.isFinite(c.lambda) || c.e <= 0 || c.lambda <= 0) {
      throw new Error(`thermique: couche invalide ${JSON.stringify(c)} (e>0 et lambda>0, ou r>0)`);
    }
    r += c.e / c.lambda;
  }
  return 1 / r;
}

/** Postes canoniques du rapport de déperditions (ordre d'affichage). */
export const POSTES = ['murs', 'menuiseries', 'plancherBas', 'plafondToiture', 'pontsThermiques', 'ventilation'];

/**
 * Déperditions par transmission d'une pièce : Σ A·U·b·(θint − θréf) + Σ A·ΔUtb·b·(θint − θréf).
 * Paroi : { surface, u, deltaUtb, poste, b } (θréf = θext) OU { …, thetaAdjacente } (θréf explicite, b ignoré).
 * ΔUtb = majoration forfaitaire de ponts thermiques en W/(m²·K) (choix org/UI, plan 4) —
 * sa contribution est isolée dans parPoste.pontsThermiques (transparence du rapport PDF).
 * poste ∈ POSTES (hors 'pontsThermiques'/'ventilation' qui sont calculés, pas déclarés).
 * @returns {{ total:number, parPoste:Record<string,number> }}
 */
export function transmissionPiece({ thetaInt, thetaExt, parois }) {
  if (!Number.isFinite(thetaInt) || !Number.isFinite(thetaExt)) throw new Error('thermique: θint/θext requis');
  if (!Array.isArray(parois)) throw new Error('thermique: parois requis');
  const parPoste = {};
  let total = 0;
  for (const p of parois) {
    if (!POSTES.includes(p.poste) || p.poste === 'pontsThermiques' || p.poste === 'ventilation') {
      throw new Error(`thermique: poste invalide « ${p.poste} »`);
    }
    if (!Number.isFinite(p.surface) || p.surface <= 0) throw new Error(`thermique: surface invalide (${p.surface})`);
    if (!Number.isFinite(p.u) || p.u <= 0) throw new Error(`thermique: U invalide (${p.u})`);
    if (!Number.isFinite(p.deltaUtb) || p.deltaUtb < 0) throw new Error('thermique: deltaUtb requis (0 accepté)');
    let deltaT;
    if (Number.isFinite(p.thetaAdjacente)) {
      deltaT = thetaInt - p.thetaAdjacente;
    } else if (Number.isFinite(p.b)) {
      deltaT = p.b * (thetaInt - thetaExt);
    } else {
      throw new Error('thermique: paroi sans b ni thetaAdjacente');
    }
    const phiU = p.surface * p.u * deltaT;
    const phiTb = p.surface * p.deltaUtb * deltaT;
    parPoste[p.poste] = (parPoste[p.poste] ?? 0) + phiU;
    if (phiTb !== 0) parPoste.pontsThermiques = (parPoste.pontsThermiques ?? 0) + phiTb;
    total += phiU + phiTb;
  }
  return { total, parPoste };
}
