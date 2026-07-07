// scripts/scenarios.test.mjs
// Tests des scénarios d'optimisation (src/apps/solaire/lib/scenarios.js).
// Run : node --test scripts/scenarios.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySolarShift, absorbSurplusWithLoad, exportByMonth, poolExtraMonths, runScenarios, applyVeWeekendShift } from '../src/apps/solaire/lib/scenarios.js';
import { computeSelfConsumption } from '../src/apps/solaire/lib/autoconsoEngine.js';

test('applyVeWeekendShift — reporte la charge VE (nuit semaine) → week-end en journée', () => {
  const conso = new Array(168).fill(0); conso[2] = 10;         // charge VE lundi nuit
  const prod = new Array(168).fill(0); prod[5 * 24 + 12] = 10; // soleil samedi midi
  const ve = new Array(168).fill(0); ve[2] = 10;
  const out = applyVeWeekendShift(conso, prod, ve, { fraction: 1 });
  assert.ok(Math.abs(out[2] - 0) < 1e-9);             // retiré de lundi nuit
  assert.ok(Math.abs(out[5 * 24 + 12] - 10) < 1e-9);  // placé samedi midi
  assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) - 10) < 1e-9); // énergie conservée
});

test('applyVeWeekendShift — pas de surplus le week-end → charge inchangée', () => {
  const conso = new Array(168).fill(0); conso[2] = 10;
  const prod = new Array(168).fill(0); // aucun soleil
  const ve = new Array(168).fill(0); ve[2] = 10;
  const out = applyVeWeekendShift(conso, prod, ve, { fraction: 1 });
  assert.ok(Math.abs(out[2] - 10) < 1e-9);
});

test('applySolarShift — borné à la journée : aucun transfert entre jours', () => {
  // 48 h = 2 jours. Jour 0 : usage 10 la nuit (h2), zéro soleil ce jour.
  // Jour 1 : soleil à h37 (13h du lendemain), mais aucun usage.
  const conso = new Array(48).fill(0); conso[2] = 10;
  const prod = new Array(48).fill(0); prod[37] = 10;
  const usage = new Array(48).fill(0); usage[2] = 10;
  const out = applySolarShift(conso, prod, usage, { fraction: 1 });
  // le jour 0 n'a pas de surplus → l'usage reste à sa place (pas reporté à demain)
  assert.ok(Math.abs(out[2] - 10) < 1e-9);
  assert.ok(Math.abs(out[37] - 0) < 1e-9);
  assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) - 10) < 1e-9);
});

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

test('exportByMonth — somme le surplus injecté par mois', () => {
  const prod  = [10, 0, 0]; // 3 premières heures = janvier
  const conso = [0, 0, 0];
  const out = exportByMonth(prod, conso);
  assert.equal(out.length, 12);
  assert.equal(out[0], 10); // janvier
  assert.equal(out[6], 0);
});

test('poolExtraMonths — mois d\'épaule où le surplus couvre le besoin de chauffe', () => {
  const surplus = new Array(12).fill(0);
  const demand  = new Array(12).fill(0);
  surplus[3] = 100; demand[3] = 80; // avril : couvert
  surplus[4] = 50;  demand[4] = 80; // mai : non couvert
  surplus[8] = 90;  demand[8] = 90; // sept : couvert (égalité)
  const r = poolExtraMonths(surplus, demand);
  assert.deepEqual(r.months, [3, 8]);
  assert.equal(r.extraMonths, 2);
});

test('runScenarios — cascade constat → déphasage → batterie, deltas cumulés', () => {
  const baseline = [0, 0, 10]; // usage la nuit
  const prod     = [0, 10, 0]; // soleil à h1
  const usage    = [0, 0, 10];
  const results = runScenarios({
    baselineConso: baseline,
    prodHourly: prod,
    steps: [
      { type: 'shift', key: 'piloted', label: 'Déphasage piloté', usageCurve: usage, fraction: 1 },
      { type: 'battery', key: 'battery', label: 'Batterie', capacityKwh: 0 },
    ],
  });
  assert.equal(results.length, 3); // constat + 2 étapes
  assert.equal(results[0].key, 'constat');
  assert.equal(results[0].selfConsumedKwh, 0);       // rien d'autoconsommé au départ
  assert.ok(Math.abs(results[1].selfConsumedKwh - 10) < 1e-9); // après déphasage
  assert.ok(Math.abs(results[1].deltaKwh - 10) < 1e-9);        // gain du levier
  // batterie capacité 0 ne change rien de plus
  assert.ok(Math.abs(results[2].deltaKwh - 0) < 1e-9);
});

test('runScenarios — étape absorb expose absorbedKwh', () => {
  const baseline = [0, 1, 0];
  const prod     = [0, 5, 0];
  const hw = new Array(24).fill(0); hw[1] = 1;
  const results = runScenarios({
    baselineConso: baseline,
    prodHourly: prod,
    steps: [{ type: 'absorb', key: 'pool', label: 'PAC piscine', hourWeights: hw, maxKwhPerHour: 10 }],
  });
  assert.ok(Math.abs(results[1].absorbedKwh - 4) < 1e-9);
});
