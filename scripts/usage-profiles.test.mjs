// scripts/usage-profiles.test.mjs
// Tests de la bibliothèque de sous-profils d'usage (src/apps/solaire/lib/usageProfiles.js).
// Run : node --test scripts/usage-profiles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursMask, ecsDevice, COLD_WATER_TEMP_BY_MONTH, ECS_NIGHT_HOURS, veDevice, VE_NIGHT_HOURS } from '../src/apps/solaire/lib/usageProfiles.js';
import { distributeDeviceLoad, hourToDate } from '../src/apps/solaire/lib/autoconsoEngine.js';

test('hoursMask — 1 sur les heures listées, 0 sinon', () => {
  const m = hoursMask([22, 23, 0, 1]);
  assert.equal(m.length, 24);
  assert.equal(m[0], 1); assert.equal(m[1], 1); assert.equal(m[22], 1); assert.equal(m[23], 1);
  assert.equal(m[12], 0);
});

test('ecsDevice — énergie physique dérivée du nb de personnes', () => {
  const dev = ecsDevice({ persons: 4 }); // défauts : 40 L, 55°C, η 0.9
  assert.equal(dev.name, 'ecs');
  // E_jour(janv) = 4 × 40 × (55 − 10) × 1.163 / 1000 / 0.9
  const eJan = 4 * 40 * (55 - COLD_WATER_TEMP_BY_MONTH[0]) * 1.163 / 1000 / 0.9;
  assert.ok(Math.abs(dev.monthWeights[0] - eJan) < 1e-9);
  // baseline = ballon nuit HC
  assert.deepEqual(dev.hourOfDayWeights, hoursMask(ECS_NIGHT_HOURS));
  // énergie annuelle = Σ E_jour(m) × jours(m) ; l'hiver > l'été
  assert.ok(dev.annualKwh > 0);
  assert.ok(dev.monthWeights[0] > dev.monthWeights[6]); // janvier (eau à 10°C) > juillet (18°C)
});

test('ecsDevice — distributeDeviceLoad reproduit l\'énergie mensuelle de la formule', () => {
  const dev = ecsDevice({ persons: 4 });
  const curve = distributeDeviceLoad(dev);
  // énergie de janvier via la courbe = E_jour(janv) × 31 jours
  let janSum = 0;
  for (let h = 0; h < curve.length; h++) if (hourToDate(h).month === 0) janSum += curve[h];
  const eJanMonth = dev.monthWeights[0] * 31;
  assert.ok(Math.abs(janSum - eJanMonth) < 1e-6);
  // total = annualKwh
  assert.ok(Math.abs(curve.reduce((a, b) => a + b, 0) - dev.annualKwh) < 1e-6);
});

test('ecsDevice — mode solar = fenêtre midi', () => {
  const dev = ecsDevice({ persons: 3, mode: 'solar' });
  assert.equal(dev.hourOfDayWeights[12], 1); // midi actif
  assert.equal(dev.hourOfDayWeights[3], 0);  // nuit inactif
});

test('veDevice — énergie depuis le kilométrage, charge nuit', () => {
  const dev = veDevice({ kmPerYear: 15000 }); // défauts 18 kWh/100km, 90% maison
  assert.equal(dev.name, 've');
  assert.ok(Math.abs(dev.annualKwh - (15000 * 18 / 100) * 0.9) < 1e-9); // 2430
  assert.deepEqual(dev.hourOfDayWeights, hoursMask(VE_NIGHT_HOURS));
  assert.deepEqual(dev.monthWeights, new Array(12).fill(1)); // uniforme
});
