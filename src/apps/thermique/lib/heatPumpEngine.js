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

/**
 * Courbe de charge : droite (θbase, Φtotal)→(θnc, 0), 0 au-delà de θnc, prolongée linéairement sous θbase.
 * phiTotal = le total de calculeBatiment (relance incluse — puissance de dimensionnement) ; ne pas
 * passer gv×ΔT.
 */
export function courbeCharge({ phiTotal, thetaBase, thetaNC }) {
  if (!Number.isFinite(phiTotal) || phiTotal <= 0) throw new Error(`thermique: phiTotal invalide (${phiTotal})`);
  if (!Number.isFinite(thetaBase) || !Number.isFinite(thetaNC) || thetaNC <= thetaBase) throw new Error('thermique: θnc doit être > θbase');
  return (theta) => Math.max(0, (phiTotal * (thetaNC - theta)) / (thetaNC - thetaBase));
}

/** Filtre les points manuels exploitables par le moteur (mêmes règles que verifPointsManuels,
 * SANS throw) — pour l'UI (Task 14 plan 4) : assainir une saisie en cours avant buildEtudeModel
 * (un point incomplet ferait lever pointBivalence pendant la frappe). */
export function pointsManuelsValides(points) {
  return (Array.isArray(points) ? points : [])
    .filter((pt) => pt && Number.isFinite(pt.tExt) && Number.isFinite(pt.pTh) && pt.pTh > 0);
}

function verifPointsManuels(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('thermique: pac manuelle doit avoir ≥ 2 points {tExt, pTh}');
  }
  for (const pt of points) {
    if (!pt || !Number.isFinite(pt.tExt) || !Number.isFinite(pt.pTh) || pt.pTh <= 0) {
      throw new Error('thermique: point manuel invalide (tExt/pTh finis, pTh > 0 attendus)');
    }
  }
}

/** P_th (W) d'une PAC manuelle par interpolation linéaire sur les points constructeur, clampée aux
 * extrêmes. Exportée pour la série PAC du graphe de bivalence (PacSection, Task 14 plan 4) — même
 * interpolation que le moteur, pas de duplication côté UI. */
export function pThManuelle(points, tExt) {
  const tries = [...points].sort((a, b) => a.tExt - b.tExt);
  if (tExt <= tries[0].tExt) return tries[0].pTh;
  const dernier = tries[tries.length - 1];
  if (tExt >= dernier.tExt) return dernier.pTh;
  for (let i = 0; i < tries.length - 1; i += 1) {
    const a = tries[i];
    const b = tries[i + 1];
    if (tExt >= a.tExt && tExt <= b.tExt) {
      const t = (tExt - a.tExt) / (b.tExt - a.tExt);
      return a.pTh + t * (b.pTh - a.pTh);
    }
  }
  return dernier.pTh; // filet théorique, inatteignable si le tri est correct
}

/** P_th (W) d'une PAC (hplib ou manuelle) au point (θext, θdépart). Dispatcher interne. */
function pThDe(pac, tExt, tDepart) {
  if (pac && pac.type === 'manuelle') {
    verifPointsManuels(pac.points);
    return pThManuelle(pac.points, tExt);
  }
  return pThAt(pac, tExt, tDepart);
}

/**
 * Point de bivalence : θ où la puissance PAC croise la charge (bisection sur [θbase, θnc], tolérance 1 W, ~60 itérations max).
 * pac : PAC hplib (coefCop/coefPth/pElRef…) OU manuelle ({type:'manuelle', points}).
 */
export function pointBivalence({ pac, tDepart, charge, thetaBase, thetaNC }) {
  if (typeof charge !== 'function') throw new Error('thermique: charge doit être une fonction');
  if (!Number.isFinite(thetaBase) || !Number.isFinite(thetaNC) || thetaNC <= thetaBase) throw new Error('thermique: θnc doit être > θbase');

  const manuelle = pac && pac.type === 'manuelle';
  if (manuelle) verifPointsManuels(pac.points);

  const pTh = (theta) => pThDe(pac, theta, tDepart);
  const f = (theta) => pTh(theta) - charge(theta);

  let thetaBivalence;
  if (f(thetaBase) >= 0) {
    // La PAC couvre déjà tout le besoin à θbase : pas de bivalence à chercher.
    thetaBivalence = thetaBase;
  } else {
    // Bisection : f(thetaBase) < 0 (pTh insuffisant) et f(thetaNC) = pTh(thetaNC) - 0 > 0 (pTh > 0 toujours).
    let lo = thetaBase;
    let hi = thetaNC;
    let flo = f(lo);
    let mid = lo;
    for (let i = 0; i < 60; i += 1) {
      mid = (lo + hi) / 2;
      const fm = f(mid);
      if (Math.abs(fm) <= 1) break;
      if ((fm < 0) === (flo < 0)) {
        lo = mid;
        flo = fm;
      } else {
        hi = mid;
      }
    }
    thetaBivalence = mid;
  }

  const appointNecessaire = Math.max(0, charge(thetaBase) - pTh(thetaBase));

  // Taux de couverture énergétique : intégration trapèzes (pas 0.5 K) sur [θbase, θnc],
  // distribution de θ supposée UNIFORME entre θbase et θnc (simplification assumée).
  const pas = 0.5;
  let sommeCouverte = 0;
  let sommeCharge = 0;
  const n = Math.round((thetaNC - thetaBase) / pas);
  let prevCharge = charge(thetaBase);
  let prevCouverte = Math.min(prevCharge, pTh(thetaBase));
  for (let i = 1; i <= n; i += 1) {
    const theta = thetaBase + i * pas;
    const chargeTheta = charge(theta);
    const couverteTheta = Math.min(chargeTheta, pTh(theta));
    sommeCharge += (prevCharge + chargeTheta) / 2 * pas;
    sommeCouverte += (prevCouverte + couverteTheta) / 2 * pas;
    prevCharge = chargeTheta;
    prevCouverte = couverteTheta;
  }
  const tauxCouverture = sommeCharge > 0 ? sommeCouverte / sommeCharge : 1;

  return {
    thetaBivalence,
    appointNecessaire,
    tauxCouverture,
    avertissementChargePartielle: !manuelle,
  };
}

const THETA_NON_CHAUFFAGE_DJU = 18; // base conventionnelle des DJU (18 °C), cf. spec Task 10
const THETA_EXT_MOYENNE_MIN = -30, THETA_EXT_MOYENNE_MAX = 18;

/**
 * Consommation annuelle — méthode degrés-jours, simplification assumée (spec « pas de suroptimisation ») :
 *   besoin (kWh) = 24 × DJU × GV / 1000 × facteurAjustement
 *   θext_moyenne_saison = 18 − (DJU × 24 / heuresChauffage)   [DJU base 18 ; heures : climat.heuresChauffage]
 *   COP saisonnier ≈ COP(θext_moyenne_saison, tDépart)         [pas de SCOP EN 14825 complet en v1]
 *   consoElecKwh = besoinKwh / COP ; coutEuros = consoElecKwh × prixKwh
 *   fourchette = { min: round(coutEuros × 0.85), max: round(coutEuros × 1.15) }  [±15 % : la conso cumule les hypothèses]
 * facteurAjustement (défaut 1.0) : apports gratuits/intermittence, éditable org (plan 4), à calibrer en phase A/B.
 * PAC manuelle ({type:'manuelle'}) : COP inconnu → throw 'thermique: conso indisponible pour une PAC manuelle sans COP'
 *   SAUF si un champ scopManuel est fourni ({type:'manuelle', scopManuel: 3.5}) → utilisé directement.
 * @returns {{ besoinKwh, thetaExtMoyenne, consoElecKwh, coutEuros, fourchette }}
 */
export function consoAnnuelle({ gv, dju, heuresChauffage, pac, tDepart, prixKwh, facteurAjustement = 1.0 }) {
  if (!Number.isFinite(gv) || gv <= 0) throw new Error(`thermique: gv invalide (${gv})`);
  if (dju == null || !Number.isFinite(dju)) {
    throw new Error('thermique: DJU manquant ou invalide — un fallback départemental doit être résolu par l’UI avant l’appel');
  }
  if (!Number.isFinite(heuresChauffage) || heuresChauffage < 800 || heuresChauffage > 6000) {
    throw new Error(`thermique: heuresChauffage invalide (${heuresChauffage}), attendu dans [800, 6000]`);
  }
  if (!Number.isFinite(prixKwh) || prixKwh <= 0) throw new Error(`thermique: prixKwh invalide (${prixKwh})`);
  if (!Number.isFinite(facteurAjustement) || facteurAjustement <= 0 || facteurAjustement > 2) {
    throw new Error(`thermique: facteurAjustement invalide (${facteurAjustement}), attendu dans (0, 2]`);
  }

  const besoinKwh = (24 * dju * gv / 1000) * facteurAjustement;
  const thetaExtMoyenne = THETA_NON_CHAUFFAGE_DJU - (dju * 24 / heuresChauffage);
  if (!Number.isFinite(thetaExtMoyenne) || thetaExtMoyenne <= THETA_EXT_MOYENNE_MIN || thetaExtMoyenne >= THETA_EXT_MOYENNE_MAX) {
    throw new Error(`thermique: θext_moyenne incohérente (${thetaExtMoyenne}), attendue dans ]${THETA_EXT_MOYENNE_MIN}, ${THETA_EXT_MOYENNE_MAX}[`);
  }

  const manuelle = pac && pac.type === 'manuelle';
  let cop;
  if (manuelle) {
    if (!Number.isFinite(pac.scopManuel) || pac.scopManuel <= 0) {
      throw new Error('thermique: conso indisponible pour une PAC manuelle sans COP');
    }
    cop = pac.scopManuel;
  } else {
    cop = copAt(pac, thetaExtMoyenne, tDepart);
  }

  const consoElecKwh = besoinKwh / cop;
  const coutEuros = consoElecKwh * prixKwh;

  return {
    besoinKwh,
    thetaExtMoyenne,
    consoElecKwh,
    coutEuros,
    fourchette: { min: Math.round(coutEuros * 0.85), max: Math.round(coutEuros * 1.15) },
  };
}
