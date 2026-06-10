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
 * Optimiseur (spec §9) : plus grande puissance (pas stepKwc, de stepKwc à maxKwc)
 * dont le taux d'autoconso annuel ≥ threshold. Aucun appel PVGIS (linéarité).
 * Cas limites : rien ne passe → plus petite puissance ; tout passe → maxKwc.
 */
export function optimize({ eM1kwc, consoMonthly, coeff, threshold, maxKwc, stepKwc }) {
  const EPS = 1e-9;
  let recommendedKwc = stepKwc;
  for (let p = stepKwc; p <= maxKwc + EPS; p += stepKwc) {
    const kwc = Math.round(p * 100) / 100; // évite la dérive float de l'accumulation
    const { totals } = computeMonthly({ eM1kwc, powerKwc: kwc, consoMonthly, coeff });
    if (totals.tauxAutoconso >= threshold - EPS) recommendedKwc = kwc;
  }
  return { recommendedKwc };
}

/** Scénarios Recommandé / −1 palier (sobre) / +1 palier (confort), clampés [stepKwc, maxKwc]. */
export function buildScenarios({ recommendedKwc, stepKwc, maxKwc }) {
  const candidates = [
    { key: 'sobre', label: 'Sobre', kwc: recommendedKwc - stepKwc },
    { key: 'recommande', label: 'Recommandé', kwc: recommendedKwc },
    { key: 'confort', label: 'Confort', kwc: recommendedKwc + stepKwc },
  ];
  return candidates.filter((c) => c.kwc >= stepKwc - 1e-9 && c.kwc <= maxKwc + 1e-9)
    .map((c) => ({ ...c, kwc: Math.round(c.kwc * 100) / 100 }));
}
