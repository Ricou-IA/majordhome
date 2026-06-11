// scripts/pv-engine.test.mjs
// Tests du moteur de calcul PV (src/apps/solaire/lib/) — runner natif Node.
// Run : node --test scripts/pv-engine.test.mjs
// Valeurs attendues : spec docs/superpowers/specs/2026-06-10-app-solaire-pv-design.md §8-§9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentToDegrees, orientationToAspect, maxPowerKwc, panelsCount,
  spreadAnnualToMonthly, evMonthlyConsumption, simultaneityCoeff, costFromGrid,
  computeMonthly, yearlyEconomy, monthlyPayment,
  buildYearlyTable, optimize, buildScenarios,
} from '../src/apps/solaire/lib/pvEngine.js';
import { buildPvConfig, PV_DEFAULTS } from '../src/apps/solaire/lib/pvConfig.js';

test('percentToDegrees', () => {
  assert.ok(Math.abs(percentToDegrees(18) - 10.204) < 0.01);
  assert.equal(percentToDegrees(100), 45);
});

test('orientationToAspect — 8 directions + passthrough numérique', () => {
  const map = { S: 0, SE: -45, E: -90, NE: -135, N: 180, NO: 135, O: 90, SO: 45 };
  for (const [dir, aspect] of Object.entries(map)) assert.equal(orientationToAspect(dir), aspect);
  assert.equal(orientationToAspect(12), 12);
});

test('maxPowerKwc / panelsCount', () => {
  // 40 m², panneau 2,26 m² / 500 Wc → floor(17,69)=17 panneaux → 8,5 kWc
  assert.equal(maxPowerKwc(40, 2.26, 500), 8.5);
  assert.equal(panelsCount(8.5, 500), 17);
});

test('spreadAnnualToMonthly — profil résidentiel, somme exacte', () => {
  const months = spreadAnnualToMonthly(12000);
  assert.equal(months.length, 12);
  assert.equal(months[0], 1440); // janvier 12 %
  assert.equal(months[5], 720);  // juin 6 %
  assert.ok(Math.abs(months.reduce((a, b) => a + b, 0) - 12000) < 0.001);
});

test('evMonthlyConsumption', () => {
  // 20 000 km × 20 kWh/100 km × 95 % = 3 800 kWh/an → 316,67 kWh/mois
  const m = evMonthlyConsumption({ kmPerYear: 20000, kwhPer100km: 20, homeChargeShare: 0.95 });
  assert.ok(Math.abs(m - 316.667) < 0.01);
});

test('simultaneityCoeff — presets, bonus, plafond', () => {
  const profiles = PV_DEFAULTS.simultaneity;
  assert.equal(simultaneityCoeff({ preset: 'absent_journee', ecsBonus: false, evBonus: false }, profiles), 0.45);
  assert.equal(simultaneityCoeff({ preset: 'presence_partielle', ecsBonus: true, evBonus: false }, profiles), 0.65);
  // 0,70 + 0,10 + 0,10 = 0,90 → plafonné 0,85
  assert.equal(simultaneityCoeff({ preset: 'presence_journee', ecsBonus: true, evBonus: true }, profiles), 0.85);
});

test('costFromGrid — exact, interpolation, hors bornes, vide', () => {
  const grid = [{ kwc: 6, prix_ttc: 14000 }, { kwc: 3, prix_ttc: 9000 }]; // volontairement non trié
  assert.equal(costFromGrid(grid, 3), 9000);
  assert.equal(costFromGrid(grid, 4.5), 11500); // 9000 + 5000 × (1,5/3)
  assert.equal(costFromGrid(grid, 6), 14000);
  assert.equal(costFromGrid(grid, 2), null);   // sous le min → saisie manuelle
  assert.equal(costFromGrid(grid, 7), null);   // au-dessus du max → saisie manuelle
  assert.equal(costFromGrid([], 4), null);
});

test('buildPvConfig — merge profond settings.pv sur les défauts', () => {
  const cfg = buildPvConfig({ pv: { default_price_kwh: 0.25, ev: { charger_price: 1500 } } });
  assert.equal(cfg.default_price_kwh, 0.25);          // overridé
  assert.equal(cfg.inflation_rate, 0.03);             // défaut conservé
  assert.equal(cfg.ev.charger_price, 1500);           // override imbriqué
  assert.equal(cfg.ev.home_charge_share, 0.95);       // défaut imbriqué conservé
  assert.deepEqual(buildPvConfig(undefined).cost_grid, []);
});

test('computeMonthly — autoconso, surplus, taux', () => {
  const eM1kwc = Array(12).fill(100);              // 1200 kWh/kWc/an (flat synthétique)
  const consoMonthly = Array(12).fill(250);        // 3000 kWh/an
  const r = computeMonthly({ eM1kwc, powerKwc: 2, consoMonthly, coeff: 0.7 });
  assert.equal(r.prod[0], 200);
  assert.equal(r.autoconso[0], 140);               // min(200,250) × 0,7
  assert.equal(r.surplus[0], 60);
  assert.equal(r.totals.prod, 2400);
  assert.equal(r.totals.autoconso, 1680);
  assert.ok(Math.abs(r.totals.tauxAutoconso - 0.7) < 1e-9);
  assert.ok(Math.abs(r.totals.tauxAutoproduction - 0.56) < 1e-9);  // 1680 / 3000
});

test('yearlyEconomy — inflation + dégradation', () => {
  const base = { autoconsoAnnual: 3000, priceKwh: 0.20, inflationRate: 0.03, degradationRate: 0.005 };
  assert.ok(Math.abs(yearlyEconomy({ ...base, yearN: 1 }) - 600) < 0.01);
  assert.ok(Math.abs(yearlyEconomy({ ...base, yearN: 2 }) - 614.91) < 0.01); // 3000×0,995×0,206
});

test('monthlyPayment — annuités constantes', () => {
  assert.ok(Math.abs(monthlyPayment({ capital: 12000, annualRate: 0.06, years: 10 }) - 133.22) < 0.05);
  assert.equal(monthlyPayment({ capital: 12000, annualRate: 0, years: 10 }), 100); // taux 0
  assert.equal(monthlyPayment({ capital: 0, annualRate: 0.06, years: 10 }), 0);
});

test('buildYearlyTable — invariants + indicateurs', () => {
  const t = buildYearlyTable({
    autoconsoAnnual: 3000, priceKwh: 0.20, inflationRate: 0.03, degradationRate: 0.005,
    horizonYears: 25, capital: 12000, annualRate: 0.06, loanYears: 10,
  });
  assert.equal(t.rows.length, 25);
  const annuity = monthlyPayment({ capital: 12000, annualRate: 0.06, years: 10 }) * 12;
  // Année 1 : économie 600, effort net = annuité − économie
  assert.ok(Math.abs(t.rows[0].economy - 600) < 0.01);
  assert.ok(Math.abs(t.rows[0].effortNet - (annuity - 600)) < 0.01);
  // Après la fin du crédit : annuité 0, effort net négatif (= gain)
  assert.equal(t.rows[10].annuity, 0);
  assert.ok(t.rows[10].effortNet < 0);
  // Cumul cohérent : cumul[N] − cumul[N−1] = économie[N] − annuité[N]
  for (let i = 1; i < 25; i++) {
    const delta = t.rows[i].cumul - t.rows[i - 1].cumul;
    assert.ok(Math.abs(delta - (t.rows[i].economy - t.rows[i].annuity)) < 0.01);
  }
  // Indicateurs
  assert.equal(t.indicators.neutralityYear, 11); // économie an 10 ≈ 748 € < annuité 1599 € → bascule an 11
  assert.ok(Math.abs(t.indicators.totalGainAtHorizon - t.rows[24].cumul) < 0.001);
  assert.ok(Math.abs(t.indicators.cumulAtLoanEnd - t.rows[9].cumul) < 0.001);
  const expectedAvg = t.rows.slice(0, 10).reduce((a, r) => a + r.effortNet, 0) / 120;
  assert.ok(Math.abs(t.indicators.avgMonthlyEffortDuringLoan - expectedAvg) < 0.001);
});

test('optimize — plus grande puissance avec recouvrement ≥ seuil', () => {
  const eM1kwc = Array(12).fill(100);
  const consoMonthly = Array(12).fill(250);
  // P ≤ 2,5 : prod ≤ conso → recouvrement = 1 ≥ 0,85 ; P = 3 : 3000/3600 = 0,833 < 0,85
  const r = optimize({ eM1kwc, consoMonthly, threshold: 0.85, maxKwc: 6.5, stepKwc: 0.5 });
  assert.equal(r.recommendedKwc, 2.5);
});

test('optimize — cas limites', () => {
  const eM1kwc = Array(12).fill(100);
  // Conso énorme : même le max toiture garde un recouvrement = 1 → recommander le max
  let r = optimize({ eM1kwc, consoMonthly: Array(12).fill(10000), threshold: 0.85, maxKwc: 4, stepKwc: 0.5 });
  assert.equal(r.recommendedKwc, 4);
  // Conso minuscule : aucun palier ne passe → recommander le plus petit (0,5)
  r = optimize({ eM1kwc, consoMonthly: Array(12).fill(10), threshold: 0.85, maxKwc: 4, stepKwc: 0.5 });
  assert.equal(r.recommendedKwc, 0.5);
});

test('buildScenarios — recommandé / sobre / confort, clampés', () => {
  const s = buildScenarios({ recommendedKwc: 2.5, stepKwc: 0.5, maxKwc: 6.5 });
  assert.deepEqual(s.map((x) => x.kwc), [2, 2.5, 3]);
  assert.deepEqual(s.map((x) => x.key), ['sobre', 'recommande', 'confort']);
  // Recommandé au max toiture → pas de confort (2 scénarios)
  const s2 = buildScenarios({ recommendedKwc: 6.5, stepKwc: 0.5, maxKwc: 6.5 });
  assert.deepEqual(s2.map((x) => x.kwc), [6, 6.5]);
});

test('optimize — régression 2026-06-11 : gros consommateur → max toiture (critère pré-coefficient)', () => {
  // Bug vu en validation : 22 110 kWh/an, profil présence partielle (coeff 0,55)
  // → l'ancien critère (taux post-coeff ≤ 0,55 < seuil 0,85) recommandait 0,5 kWc.
  // Critère correct = recouvrement théorique Σ min(prod, conso) / Σ prod ≥ seuil.
  const eM1kwc = [45.8, 60, 92, 110, 128, 138, 150, 142, 112, 82, 52, 40];
  const consoMonthly = Array(12).fill(1842.5); // 22 110 kWh/an
  const r = optimize({ eM1kwc, consoMonthly, threshold: 0.85, maxKwc: 8, stepKwc: 0.5 });
  assert.equal(r.recommendedKwc, 8); // prod max mois (150×8=1200) < conso (1842) → recouvrement = 1
});
