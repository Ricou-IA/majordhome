// scripts/pv-engine.test.mjs
// Tests du moteur de calcul PV (src/apps/solaire/lib/) — runner natif Node.
// Run : node --test scripts/pv-engine.test.mjs
// Valeurs attendues : spec docs/superpowers/specs/2026-06-10-app-solaire-pv-design.md §8-§9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentToDegrees, orientationToAspect, maxPowerKwc, panelsCount,
  spreadAnnualToMonthly, evMonthlyConsumption, simultaneityCoeff, costFromGrid,
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
