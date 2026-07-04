// src/apps/thermique/lib/heatPumpEngine.js
// Modèle de performance PAC air/eau (hplib, formule vérifiée plan 1 contre hplib.py) — module PUR.
// ⚠ Sémantique du catalogue (pac-catalogue.json) :
//   coefCop = p1..p4 du COP ; coefPth = p1..p4 de P_EL (pas de P_th !) ; P_th = P_el × COP.
//   pElRef/copRef = colonnes BRUTES Keymark (réf −7 °C ext / 52 °C départ) ; null pour les 3 génériques.
// ⚠ P_th des modèles « Regulated » = points certifiés EN 14825 en charge partielle adaptée,
//   PAS la capacité maximale — l'usage en bivalence (Task 8) porte un avertissement dédié.

const T_EXT_MIN = -30, T_EXT_MAX = 45, T_DEPART_MIN = 20, T_DEPART_MAX = 65;

function verifTemp(tExt, tDepart) {
  if (!Number.isFinite(tExt) || tExt < T_EXT_MIN || tExt > T_EXT_MAX) throw new Error(`thermique: tExt hors plage [${T_EXT_MIN}, ${T_EXT_MAX}] (${tExt})`);
  if (!Number.isFinite(tDepart) || tDepart < T_DEPART_MIN || tDepart > T_DEPART_MAX) throw new Error(`thermique: tDépart hors plage [${T_DEPART_MIN}, ${T_DEPART_MAX}] (${tDepart})`);
}

function verifCoefs(coefs, nom) {
  if (!Array.isArray(coefs) || coefs.length !== 4 || !coefs.every(Number.isFinite)) {
    throw new Error(`thermique: ${nom} invalide (4 coefficients finis attendus)`);
  }
}

/** COP au point (θext, θdépart). Plancher physique 1 (le fit linéaire hplib peut diverger aux extrêmes). */
export function copAt(pac, tExt, tDepart) {
  verifTemp(tExt, tDepart);
  verifCoefs(pac.coefCop, 'coefCop');
  const [p1, p2, p3, p4] = pac.coefCop;
  return Math.max(1, p1 * tExt + p2 * tDepart + p3 + p4 * tExt); // Tamb = Tin (air/eau)
}

/** P_el_ref (W) : colonne brute Keymark si présente ; génériques (null) → pthRef / COP_fitté(−7,52) comme hplib. */
export function pElRefDe(pac) {
  if (Number.isFinite(pac.pElRef)) return pac.pElRef;
  if (!Number.isFinite(pac.pthRef)) throw new Error('thermique: pac sans pElRef ni pthRef');
  return pac.pthRef / copAt(pac, -7, 52);
}

/** P_th (W) au point (θext, θdépart) = P_el × COP. ⚠ « Regulated » : point EN 14825 charge partielle, pas capacité max. */
export function pThAt(pac, tExt, tDepart) {
  verifTemp(tExt, tDepart);
  verifCoefs(pac.coefPth, 'coefPth');
  const [q1, q2, q3, q4] = pac.coefPth;
  const pEl = pElRefDe(pac) * (q1 * tExt + q2 * tDepart + q3 + q4 * tExt);
  return Math.max(0, pEl * copAt(pac, tExt, tDepart));
}
