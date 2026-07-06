// scripts/autoconso-engine.test.mjs
// Tests du moteur horaire d'autoconsommation (src/apps/solaire/lib/autoconsoEngine.js).
// Run : node --test scripts/autoconso-engine.test.mjs
// RÈGLE : le surplus n'est JAMAIS valorisé en € (comme pvEngine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOURS_PER_YEAR, hourToDate } from '../src/apps/solaire/lib/autoconsoEngine.js';

test('hourToDate — bornes mois / heure de journée (année 365 j)', () => {
  assert.equal(HOURS_PER_YEAR, 8760);
  assert.deepEqual(hourToDate(0), { month: 0, hourOfDay: 0, dayOfYear: 0 });
  assert.deepEqual(hourToDate(23), { month: 0, hourOfDay: 23, dayOfYear: 0 });
  assert.deepEqual(hourToDate(744), { month: 1, hourOfDay: 0, dayOfYear: 31 }); // 1er févr. (31×24)
  assert.deepEqual(hourToDate(8759), { month: 11, hourOfDay: 23, dayOfYear: 364 });
});
