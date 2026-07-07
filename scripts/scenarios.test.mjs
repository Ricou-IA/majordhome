// scripts/scenarios.test.mjs
// Tests des scénarios d'optimisation (src/apps/solaire/lib/scenarios.js).
// Run : node --test scripts/scenarios.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySolarShift, absorbSurplusWithLoad } from '../src/apps/solaire/lib/scenarios.js';
import { computeSelfConsumption } from '../src/apps/solaire/lib/autoconsoEngine.js';

test('applySolarShift — déplace l\'usage vers le surplus, énergie conservée', () => {
  // usage de 10 kWh à h2 (nuit, pas de prod) ; prod à h1 (soleil).
  const conso = [0, 0, 10];
  const prod  = [0, 10, 0];
  const usage = [0, 0, 10];
  const out = applySolarShift(conso, prod, usage, { fraction: 1 });
  // le 10 passe de h2 (nuit) à h1 (soleil)
  assert.ok(Math.abs(out[2] - 0) < 1e-9);
  assert.ok(Math.abs(out[1] - 10) < 1e-9);
  // énergie totale conservée
  assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) - 10) < 1e-9);
  // autoconso : 0 avant → 10 après
  assert.equal(computeSelfConsumption({ prodHourly: prod, consoHourly: conso }).selfConsumedKwh, 0);
  assert.ok(Math.abs(computeSelfConsumption({ prodHourly: prod, consoHourly: out }).selfConsumedKwh - 10) < 1e-9);
});

test('applySolarShift — aucun surplus disponible → conso inchangée', () => {
  const conso = [5, 5];
  const prod  = [0, 0]; // pas de soleil
  const usage = [5, 0];
  const out = applySolarShift(conso, prod, usage, { fraction: 1 });
  assert.deepEqual(out, [5, 5]); // pas de déphasage bénéfique
});

test('applySolarShift — surplus insuffisant : sature le surplus, conserve l\'énergie', () => {
  // usage 10 à h1 (nuit) ; surplus dispo seulement 4 à h0.
  const conso = [0, 10];
  const prod  = [4, 0];
  const usage = [0, 10];
  const out = applySolarShift(conso, prod, usage, { fraction: 1 });
  assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) - 10) < 1e-9); // énergie conservée
  // le surplus (4) est autoconsommé, le reste (6) reste en import à h0
  const r = computeSelfConsumption({ prodHourly: prod, consoHourly: out });
  assert.ok(Math.abs(r.selfConsumedKwh - 4) < 1e-9);
});

test('absorbSurplusWithLoad — la PAC piscine mange le surplus de midi', () => {
  const conso = [0, 1, 0];
  const prod  = [0, 5, 0];
  const hw = new Array(24).fill(0); hw[1] = 1; // charge active à l'heure-de-journée 1
  const { consoHourly: out, absorbedKwh } = absorbSurplusWithLoad(conso, prod, { hourWeights: hw, maxKwhPerHour: 10 });
  assert.ok(Math.abs(absorbedKwh - 4) < 1e-9);       // surplus dispo = 5 − 1 = 4
  assert.ok(Math.abs(out[1] - 5) < 1e-9);            // conso montée à 5
  // export converti en autoconso (confort) : 4 → 0 d'export
  assert.ok(Math.abs(computeSelfConsumption({ prodHourly: prod, consoHourly: out }).exportedKwh - 0) < 1e-9);
});

test('absorbSurplusWithLoad — plafond maxKwhPerHour respecté', () => {
  const conso = [0, 0];
  const prod  = [0, 10];
  const hw = new Array(24).fill(0); hw[1] = 1;
  const { absorbedKwh } = absorbSurplusWithLoad(conso, prod, { hourWeights: hw, maxKwhPerHour: 3 });
  assert.ok(Math.abs(absorbedKwh - 3) < 1e-9); // plafonné à 3 malgré 10 de surplus
});
