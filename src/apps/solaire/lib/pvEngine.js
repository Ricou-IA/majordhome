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
