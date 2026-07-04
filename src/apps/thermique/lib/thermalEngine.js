// src/apps/thermique/lib/thermalEngine.js
// Moteur de déperditions EN 12831 simplifié — module PUR (aucun import).
// Unités : e en m, lambda en W/(m·K), U en W/(m²·K), surfaces en m², puissances en W, θ en °C.

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
