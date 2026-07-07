// scripts/autoconso-model.test.mjs
// Tests de l'orchestrateur (src/apps/solaire/lib/autoconsoModel.js).
// Run : node --test scripts/autoconso-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDevices, buildAutoconsoModel, CASCADE_DEFAULTS } from '../src/apps/solaire/lib/autoconsoModel.js';

// Prod PVGIS synthétique : production aux heures 11-14 chaque jour (bell simplifiée).
function midDayProd() {
  const prod = new Array(8760).fill(0);
  for (let h = 0; h < 8760; h++) { const hod = h % 24; if (hod >= 11 && hod <= 14) prod[h] = 1; }
  return prod;
}
const FLAT_TALON = new Array(8760).fill(1);
const MONTHLY = new Array(12).fill(300); // 3600 kWh/an

test('buildDevices — ECS toujours, VE/piscine/PAC conditionnels', () => {
  const only = buildDevices({ persons: 3 });
  assert.deepEqual(only.map((d) => d.name), ['ecs']);
  const full = buildDevices({ persons: 3, veKmPerYear: 12000, pool: {}, pacAnnualKwh: 4000 });
  assert.deepEqual(full.map((d) => d.name), ['ecs', 've', 'piscine', 'pac']);
});

test('buildAutoconsoModel — cascade croissante + courbes client (sans piscine)', () => {
  const m = buildAutoconsoModel({ household: { persons: 2 }, monthlyConsoTotals: MONTHLY, baseShape: FLAT_TALON, prodHourly: midDayProd() });
  assert.equal(m.warnings.length, 0);
  assert.equal(m.cascade[0].key, 'constat');
  assert.equal(m.cascade[0].deltaKwh, 0);
  // autoconso auto-consommée non décroissante le long de la cascade
  for (let i = 1; i < m.cascade.length; i++) {
    assert.ok(m.cascade[i].selfConsumedKwh >= m.cascade[i - 1].selfConsumedKwh - 1e-6);
  }
  // le déphasage améliore vraiment vs le constat (ECS nuit → surplus midi)
  assert.ok(m.cascade[1].selfConsumedKwh > m.cascade[0].selfConsumedKwh);
  // pas de piscine → pas de ligne 'pool', batterie en dernier
  assert.ok(!m.cascade.some((r) => r.key === 'pool'));
  assert.equal(m.cascade[m.cascade.length - 1].key, 'battery');
  // courbes client
  assert.equal(m.annualByMonth.length, 12);
  assert.ok(Math.abs(m.annualByMonth.reduce((a, b) => a + b, 0) - 3600) < 1e-3);
  assert.equal(m.dayTypeWinter.length, 24);
  assert.equal(m.dayTypeSummer.length, 24);
});

test('buildAutoconsoModel — avec piscine : ligne pool + absorbedKwh', () => {
  const m = buildAutoconsoModel({ household: { persons: 2, pool: {} }, monthlyConsoTotals: MONTHLY, baseShape: FLAT_TALON, prodHourly: midDayProd() });
  const pool = m.cascade.find((r) => r.key === 'pool');
  assert.ok(pool, 'ligne pool présente');
  assert.ok(typeof pool.absorbedKwh === 'number' && pool.absorbedKwh >= 0);
  assert.equal(m.cascade[m.cascade.length - 1].key, 'battery');
  // capacité batterie recommandée fait partie des capacités proposées
  assert.ok(CASCADE_DEFAULTS.batteryCapacities.includes(m.battery.recommendedCapacityKwh));
});
