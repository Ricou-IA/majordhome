// src/apps/solaire/lib/pvEngine.js
// Moteur de calcul PV — PUR : aucun import (testable via node --test).
// Formules : spec docs/superpowers/specs/2026-06-10-app-solaire-pv-design.md §8-§9.
// RÈGLE ABSOLUE : le surplus n'est JAMAIS valorisé en € (spec §1).

/** Profil de répartition mensuelle résidentiel standard (% du total annuel, janv→déc, Σ=100). */
export const MONTHLY_PROFILE = [12, 11, 10, 8, 7, 6, 6, 6, 7, 8, 9, 10];

/** Pente toiture % (langage BTP) → degrés PVGIS. */
export function percentToDegrees(percent) {
  return (Math.atan(percent / 100) * 180) / Math.PI;
}

const ASPECT_BY_DIRECTION = { S: 0, SE: -45, E: -90, NE: -135, N: 180, NO: 135, O: 90, SO: 45 };

/** Orientation (8 directions ou degrés) → aspect PVGIS (S=0, E=-90, O=+90, N=±180). */
export function orientationToAspect(orientation) {
  if (typeof orientation === 'number') return orientation;
  return ASPECT_BY_DIRECTION[orientation] ?? 0;
}

/** Normalise un angle en degrés sur l'intervalle demi-ouvert [-180, +180). */
function normalizeDeg(deg) {
  let d = ((deg + 180) % 360 + 360) % 360 - 180; // ramène dans [-180, +180)
  if (Object.is(d, -0)) d = 0;
  return d;
}

/**
 * Azimut Google Solar (0=N, 90=E, 180=S, 270=O ; horaire 0–360)
 * → aspect PVGIS (S=0, E=-90, O=+90, N=±180). Nord = -180 (intervalle demi-ouvert).
 */
export function googleAzimuthToPvgisAspect(azimuthDeg) {
  return normalizeDeg(azimuthDeg - 180);
}

/** Pente en degrés → pente en % (langage BTP). Inverse de percentToDegrees. */
export function degreesToPercent(deg) {
  const pct = Math.tan((deg * Math.PI) / 180) * 100;
  // Math.tan(π/4) renvoie 0,9999999999… → nettoyer le bruit flottant (45° = 100 % exact).
  return Math.round(pct * 1e9) / 1e9;
}

/** Puissance max toiture (kWc) : floor(surface / surface_panneau) × puissance_panneau. */
export function maxPowerKwc(surfaceM2, panelAreaM2, panelPowerWc) {
  return Math.floor(surfaceM2 / panelAreaM2) * (panelPowerWc / 1000);
}

/** Nombre de panneaux pour une puissance donnée. */
export function panelsCount(kwc, panelPowerWc) {
  return Math.round(kwc / (panelPowerWc / 1000));
}

/** Répartit un total annuel kWh sur 12 mois selon MONTHLY_PROFILE. */
export function spreadAnnualToMonthly(totalKwh) {
  return MONTHLY_PROFILE.map((pct) => (totalKwh * pct) / 100);
}

/** Surconsommation VE mensuelle (kWh/mois), linéarisée (spec §8.6). */
export function evMonthlyConsumption({ kmPerYear, kwhPer100km, homeChargeShare }) {
  return (kmPerYear * kwhPer100km / 100 * homeChargeShare) / 12;
}

/** Coefficient de simultanéité : preset + bonus ECS + bonus VE, plafonné (spec §8.2). */
export function simultaneityCoeff({ preset, ecsBonus, evBonus }, profiles) {
  let coeff = profiles[preset] ?? profiles.presence_partielle;
  if (ecsBonus) coeff += profiles.bonus_ecs;
  if (evBonus) coeff += profiles.bonus_ve;
  return Math.min(coeff, profiles.cap);
}

/**
 * Coût installation pour P kWc depuis la grille admin [{ kwc, prix_ttc }].
 * Ligne exacte → prix ; entre 2 lignes → interpolation linéaire ;
 * hors bornes ou grille vide → null (saisie manuelle par le commercial).
 */
export function costFromGrid(grid, powerKwc) {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  const sorted = [...grid].sort((a, b) => a.kwc - b.kwc);
  const exact = sorted.find((r) => Math.abs(r.kwc - powerKwc) < 1e-9);
  if (exact) return exact.prix_ttc;
  if (powerKwc < sorted[0].kwc || powerKwc > sorted[sorted.length - 1].kwc) return null;
  const upperIdx = sorted.findIndex((r) => r.kwc > powerKwc);
  const lo = sorted[upperIdx - 1];
  const hi = sorted[upperIdx];
  const t = (powerKwc - lo.kwc) / (hi.kwc - lo.kwc);
  return lo.prix_ttc + (hi.prix_ttc - lo.prix_ttc) * t;
}

/**
 * Production / autoconsommation / surplus mensuels pour P kWc (spec §8.1, §8.3).
 * Le surplus est affiché « perdu » et valorisé 0 € — AUCUNE valorisation ailleurs.
 */
export function computeMonthly({ eM1kwc, powerKwc, consoMonthly, coeff }) {
  const prod = eM1kwc.map((e) => e * powerKwc);
  const autoconso = prod.map((p, m) => Math.min(p, consoMonthly[m]) * coeff);
  const surplus = prod.map((p, m) => p - autoconso[m]);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const totals = {
    prod: sum(prod),
    conso: sum(consoMonthly),
    autoconso: sum(autoconso),
    surplus: sum(surplus),
  };
  totals.tauxAutoconso = totals.prod > 0 ? totals.autoconso / totals.prod : 0;
  totals.tauxAutoproduction = totals.conso > 0 ? totals.autoconso / totals.conso : 0;
  return { prod, autoconso, surplus, totals };
}

/** Économie de l'année N (spec §8.4) : autoconso × dégradation^(N-1) × prix × inflation^(N-1). */
export function yearlyEconomy({ autoconsoAnnual, priceKwh, inflationRate, degradationRate, yearN }) {
  const price = priceKwh * Math.pow(1 + inflationRate, yearN - 1);
  const prodFactor = Math.pow(1 - degradationRate, yearN - 1);
  return autoconsoAnnual * prodFactor * price;
}

/** Mensualité crédit annuités constantes (spec §8.5). Taux 0 → division simple. */
export function monthlyPayment({ capital, annualRate, years }) {
  if (capital <= 0 || years <= 0) return 0;
  if (annualRate === 0) return capital / (12 * years);
  const r = annualRate / 12;
  return (capital * r) / (1 - Math.pow(1 + r, -12 * years));
}

/** Tableau annuel type amortissement + 3 indicateurs de tête (spec §8.7). */
export function buildYearlyTable({
  autoconsoAnnual, priceKwh, inflationRate, degradationRate,
  horizonYears, capital, annualRate, loanYears,
}) {
  const annuity = monthlyPayment({ capital, annualRate, years: loanYears }) * 12;
  const rows = [];
  let cumul = 0;
  for (let n = 1; n <= horizonYears; n++) {
    const economy = yearlyEconomy({ autoconsoAnnual, priceKwh, inflationRate, degradationRate, yearN: n });
    const yearAnnuity = n <= loanYears ? annuity : 0;
    const effortNet = yearAnnuity - economy;       // négatif = le client gagne
    cumul += economy - yearAnnuity;
    rows.push({ year: n, economy, annuity: yearAnnuity, effortNet, cumul });
  }
  const neutralityRow = rows.find((r) => r.effortNet <= 0);
  const loanRows = rows.slice(0, loanYears);
  return {
    rows,
    indicators: {
      avgMonthlyEffortDuringLoan: loanYears > 0
        ? loanRows.reduce((a, r) => a + r.effortNet, 0) / (12 * loanYears)
        : 0,
      neutralityYear: neutralityRow ? neutralityRow.year : null,
      cumulAtLoanEnd: loanYears > 0 && rows[loanYears - 1] ? rows[loanYears - 1].cumul : 0,
      totalGainAtHorizon: rows.length ? rows[rows.length - 1].cumul : 0,
    },
  };
}

/**
 * Optimiseur (spec §9, critère corrigé 2026-06-11) : plus grande puissance
 * (pas stepKwc, de stepKwc à maxKwc) dont le RECOUVREMENT THÉORIQUE annuel
 * Σ min(prod, conso) / Σ prod ≥ threshold — calculé AVANT le coefficient de
 * simultanéité. Le coefficient est volontairement exclu du critère :
 * taux_autoconso = coeff × recouvrement est plafonné par coeff (0,45-0,85),
 * donc un seuil à 0,85 serait inatteignable et l'optimiseur retomberait
 * toujours sur le minimum (bug vu en validation : 22 110 kWh/an → 0,5 kWc).
 * Le coefficient scale toutes les puissances uniformément, il ne déplace pas
 * le point de surdimensionnement. Seuil 0,85 = « au plus 15 % de la production
 * déborde structurellement de la consommation mensuelle ».
 * Aucun appel PVGIS (linéarité). Cas limites : rien ne passe → plus petite
 * puissance ; tout passe → maxKwc.
 */
export function optimize({ eM1kwc, consoMonthly, threshold, maxKwc, stepKwc }) {
  const EPS = 1e-9;
  let recommendedKwc = stepKwc;
  for (let p = stepKwc; p <= maxKwc + EPS; p += stepKwc) {
    const kwc = Math.round(p * 100) / 100; // évite la dérive float de l'accumulation
    let prodSum = 0;
    let overlapSum = 0;
    for (let m = 0; m < 12; m++) {
      const prod = eM1kwc[m] * kwc;
      prodSum += prod;
      overlapSum += Math.min(prod, consoMonthly[m]);
    }
    const overlapRatio = prodSum > 0 ? overlapSum / prodSum : 0;
    if (overlapRatio >= threshold - EPS) recommendedKwc = kwc;
  }
  return { recommendedKwc };
}

/** Incrément des paliers commerciaux (kWc) : on installe par multiples de 3 (3, 6, 9). */
export const OFFER_INCREMENT_KWC = 3;

/**
 * Scénarios proposés (spec révisée 2026-06-18) : les paliers commerciaux réels
 * (multiples de `increment` : 3, 6, 9 kWc) bornés par maxKwc = min(toiture,
 * plafond offre), PLUS la puissance « Optimisé » calculée par optimize()
 * (`recommendedKwc`, le pas-panneau le mieux dimensionné).
 * - `isOptimum:true` flague l'Optimisé (étoile UI, repère de juste
 *   dimensionnement). `isMultiple:true` flague les paliers commerciaux.
 * - Fusion : si l'Optimisé tombe pile sur un palier (ex. gros consommateur →
 *   optimum = plafond 9 kWc), le palier porte `isOptimum` (pas de carte doublon).
 * - Petite toiture (maxKwc < increment) : aucun palier ne rentre → seule la
 *   carte Optimisé est retournée.
 * Tri croissant par kWc. La sélection par défaut est calculée par
 * `defaultScenarioKwc` (palier le plus proche de l'optimum, décision A).
 */
export function buildScenarios({ recommendedKwc, maxKwc, increment = OFFER_INCREMENT_KWC }) {
  const EPS = 1e-9;
  const round2 = (x) => Math.round(x * 100) / 100;
  const opt = round2(recommendedKwc);

  const byKwc = new Map();
  for (let p = increment; p <= maxKwc + EPS; p += increment) {
    const kwc = round2(p);
    byKwc.set(kwc, { key: `palier_${kwc}`, label: 'Standard', kwc, isOptimum: false, isMultiple: true });
  }

  const existing = byKwc.get(opt);
  if (existing) {
    existing.isOptimum = true;
    existing.label = 'Optimisé';
  } else {
    byKwc.set(opt, { key: 'optimise', label: 'Optimisé', kwc: opt, isOptimum: true, isMultiple: false });
  }

  return [...byKwc.values()].sort((a, b) => a.kwc - b.kwc);
}

/**
 * Palier commercial pré-sélectionné par défaut (décision A, 2026-06-18) : le
 * palier (`isMultiple`) le plus proche de l'optimum ; à égalité de distance, le
 * plus grand (ne pas sous-dimensionner). Aucun palier disponible (petite
 * toiture) → l'optimum lui-même. Le commercial peut ensuite cliquer une autre
 * carte ; l'Optimisé reste le repère affiché (étoile).
 */
export function defaultScenarioKwc({ scenarios, recommendedKwc }) {
  const EPS = 1e-9;
  const paliers = scenarios.filter((s) => s.isMultiple);
  if (paliers.length === 0) return Math.round(recommendedKwc * 100) / 100;
  return paliers.reduce((best, s) => {
    const d = Math.abs(s.kwc - recommendedKwc);
    const bestD = Math.abs(best.kwc - recommendedKwc);
    if (d < bestD - EPS) return s;
    if (Math.abs(d - bestD) < EPS && s.kwc > best.kwc) return s; // égalité → le plus grand
    return best;
  }).kwc;
}
