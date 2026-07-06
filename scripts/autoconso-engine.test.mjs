// scripts/autoconso-engine.test.mjs
// Tests du moteur horaire d'autoconsommation (src/apps/solaire/lib/autoconsoEngine.js).
// Run : node --test scripts/autoconso-engine.test.mjs
// RÈGLE : le surplus n'est JAMAIS valorisé en € (comme pvEngine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOURS_PER_YEAR, hourToDate, computeSelfConsumption, distributeDeviceLoad } from '../src/apps/solaire/lib/autoconsoEngine.js';

test('hourToDate — bornes mois / heure de journée (année 365 j)', () => {
  assert.equal(HOURS_PER_YEAR, 8760);
  assert.deepEqual(hourToDate(0), { month: 0, hourOfDay: 0, dayOfYear: 0 });
  assert.deepEqual(hourToDate(23), { month: 0, hourOfDay: 23, dayOfYear: 0 });
  assert.deepEqual(hourToDate(744), { month: 1, hourOfDay: 0, dayOfYear: 31 }); // 1er févr. (31×24)
  assert.deepEqual(hourToDate(8759), { month: 11, hourOfDay: 23, dayOfYear: 364 });
});

test('computeSelfConsumption — Σ min(prod, conso), export, import', () => {
  const prod  = [0, 2, 4, 0];
  const conso = [1, 1, 1, 3];
  const r = computeSelfConsumption({ prodHourly: prod, consoHourly: conso });
  assert.equal(r.prodKwh, 6);
  assert.equal(r.consoKwh, 6);
  assert.equal(r.selfConsumedKwh, 2);   // 0 + 1 + 1 + 0
  assert.equal(r.exportedKwh, 4);       // (2-1) + (4-1)
  assert.equal(r.importedKwh, 4);       // (1-0) + (3-0)
  assert.ok(Math.abs(r.autoconsoRate - 2 / 6) < 1e-9);
  assert.ok(Math.abs(r.autoproductionRate - 2 / 6) < 1e-9);
});

test('distributeDeviceLoad — VE nuit : énergie annuelle conservée, jour à zéro', () => {
  const hourOfDayWeights = Array.from({ length: 24 }, (_, h) => (h < 6 ? 1 : 0)); // 0h-5h
  const monthWeights = Array(12).fill(1);
  const curve = distributeDeviceLoad({ annualKwh: 3650, hourOfDayWeights, monthWeights });
  assert.equal(curve.length, 8760);
  const sum = curve.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 3650) < 1e-6);            // énergie conservée
  // une heure de nuit (h=2) est chargée, une heure de jour (h=12) est nulle
  assert.ok(curve[2] > 0);
  assert.equal(curve[12], 0);
  // poids nuls → tableau de zéros
  const zero = distributeDeviceLoad({ annualKwh: 1000, hourOfDayWeights: Array(24).fill(0), monthWeights });
  assert.equal(zero.reduce((a, b) => a + b, 0), 0);
});
