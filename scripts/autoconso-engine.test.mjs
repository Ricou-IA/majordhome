// scripts/autoconso-engine.test.mjs
// Tests du moteur horaire d'autoconsommation (src/apps/solaire/lib/autoconsoEngine.js).
// Run : node --test scripts/autoconso-engine.test.mjs
// RÈGLE : le surplus n'est JAMAIS valorisé en € (comme pvEngine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOURS_PER_YEAR, hourToDate, computeSelfConsumption, distributeDeviceLoad, reconcileMonthly, buildLoadCurve, simulateBattery } from '../src/apps/solaire/lib/autoconsoEngine.js';

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

test('reconcileMonthly — chaque mois calé sur sa cible', () => {
  const shape = new Array(8760).fill(1); // forme plate
  // cible = 2 kWh par heure du mois → target[m] = heures_du_mois × 2
  const HOURS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((d) => d * 24);
  const targets = HOURS_IN_MONTH.map((h) => h * 2);
  const out = reconcileMonthly({ hourlyShape: shape, monthlyTargets: targets });
  assert.ok(Math.abs(out[0] - 2) < 1e-9);      // janvier : plat → 2/h
  assert.ok(Math.abs(out[8000] - 2) < 1e-9);   // décembre : idem
  // somme du mois de janvier = cible de janvier
  const janSum = out.slice(0, HOURS_IN_MONTH[0]).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(janSum - targets[0]) < 1e-6);
});

test('reconcileMonthly — mois de forme nulle mais cible > 0 → répartition uniforme', () => {
  const shape = new Array(8760).fill(0);
  const targets = Array(12).fill(0);
  targets[0] = 744; // janvier = 744 h → 1/h attendu
  const out = reconcileMonthly({ hourlyShape: shape, monthlyTargets: targets });
  assert.ok(Math.abs(out[0] - 1) < 1e-9);
  assert.equal(out[8000], 0); // décembre cible 0 → 0
});

test('buildLoadCurve — talon + device, énergie totale et ancres mensuelles respectées', () => {
  const monthlyConsoTotals = Array(12).fill(1000);          // 12 000 kWh/an
  const baseShape = new Array(8760).fill(1);                // talon plat
  const hourOfDayWeights = Array.from({ length: 24 }, (_, h) => (h < 6 ? 1 : 0));
  const devices = [{ name: 've', annualKwh: 2400, hourOfDayWeights, monthWeights: Array(12).fill(1) }];
  const { hourly, byDevice, residualMonthly, warnings } = buildLoadCurve({ monthlyConsoTotals, baseShape, devices });

  assert.equal(hourly.length, 8760);
  assert.equal(warnings.length, 0);
  const total = hourly.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 12000) < 1e-3);                // conso totale conservée
  // somme de janvier ≈ ancre de janvier (1000)
  const janSum = hourly.slice(0, 31 * 24).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(janSum - 1000) < 1e-3);
  // le device VE représente 2400 kWh, exposé séparément
  assert.ok(Math.abs(byDevice.ve.reduce((a, b) => a + b, 0) - 2400) < 1e-6);
  // résidu mensuel = total − énergie VE du mois. Le VE est réparti à l'heure sur
  // les heures de nuit : janvier (31 j × 6 h = 186 h actives sur 2190 h/an)
  // porte 2400 × 186/2190 kWh, PAS 200 (les mois n'ont pas le même nb de jours).
  const janVE = 2400 * (31 * 6) / (365 * 6);
  assert.ok(Math.abs(residualMonthly[0] - (1000 - janVE)) < 1e-6);
  // résidu annuel total = conso totale − VE total
  assert.ok(Math.abs(residualMonthly.reduce((a, b) => a + b, 0) - (12000 - 2400)) < 1e-6);
});

test('buildLoadCurve — usages > conso du mois → warning + talon ramené à 0', () => {
  const monthlyConsoTotals = Array(12).fill(100);
  const baseShape = new Array(8760).fill(1);
  const devices = [{ name: 've', annualKwh: 6000, hourOfDayWeights: Array(24).fill(1), monthWeights: Array(12).fill(1) }];
  const { residualMonthly, warnings } = buildLoadCurve({ monthlyConsoTotals, baseShape, devices });
  assert.ok(warnings.length >= 1);
  assert.equal(residualMonthly[0], 0);
});

test('simulateBattery — capacité 0 ≡ autoconso directe', () => {
  const prod  = [0, 2, 4, 0];
  const conso = [1, 1, 1, 3];
  const r = simulateBattery({ prodHourly: prod, consoHourly: conso, capacityKwh: 0 });
  assert.equal(r.selfConsumedKwh, 2);
  assert.equal(r.exportedKwh, 4);
  assert.equal(r.importedKwh, 4);
  assert.equal(r.selfConsumedFromBatteryKwh, 0);
});

test('simulateBattery — rendement 100 % : le tampon récupère tout le surplus utile', () => {
  // Surplus PLACÉ AVANT les déficits (simulation linéaire, sans report cyclique
  // fin d'année→début d'année) : sinon un déficit initial ne peut jamais être
  // couvert par une batterie vide (soc=0 en h0). Écart signalé au plan (§Task 7).
  const prod  = [4, 0, 0, 0];
  const conso = [0, 1, 2, 1];
  const r = simulateBattery({ prodHourly: prod, consoHourly: conso, capacityKwh: 10, roundTripEfficiency: 1 });
  assert.ok(Math.abs(r.selfConsumedFromBatteryKwh - 4) < 1e-9); // 1 + 2 + 1 restitués
  assert.ok(Math.abs(r.selfConsumedKwh - 4) < 1e-9);
  assert.ok(Math.abs(r.exportedKwh - 0) < 1e-9);
  assert.ok(Math.abs(r.importedKwh - 0) < 1e-9);
  assert.ok(Math.abs(r.autoconsoRate - 1) < 1e-9);
});

test('simulateBattery — rendement 90 % : pertes reportées sur l\'import', () => {
  const prod  = [10, 0];
  const conso = [0, 10];
  const r = simulateBattery({ prodHourly: prod, consoHourly: conso, capacityKwh: 10, roundTripEfficiency: 0.9 });
  // charge 10 → décharge tirée 10, restitué 9 ; besoin 10 → import 1
  assert.ok(Math.abs(r.selfConsumedFromBatteryKwh - 9) < 1e-9);
  assert.ok(Math.abs(r.importedKwh - 1) < 1e-9);
  assert.ok(Math.abs(r.exportedKwh - 0) < 1e-9);
});
