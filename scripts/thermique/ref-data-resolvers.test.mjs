// scripts/thermique/ref-data-resolvers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePeriode, uDefautPour } from '../../src/apps/thermique/lib/refDataResolvers.js';

const uDefauts = JSON.parse(readFileSync('src/apps/thermique/data/u-defauts.json', 'utf8'));

test('resolvePeriode : bornes réelles des périodes 3CL', () => {
  assert.equal(resolvePeriode(1960), 'avant 1974');
  assert.equal(resolvePeriode(1974), 'avant 1974');
  assert.equal(resolvePeriode(1975), '1975-1977');
  assert.equal(resolvePeriode(1980), '1978-1982');
  assert.equal(resolvePeriode(1995), '1989-2000');
  assert.equal(resolvePeriode(2013), 'après 2012');
  assert.equal(resolvePeriode(2024), 'après 2012');
  // année inconnue → « avant 1974 » (sémantique 3CL « avant 1974 ou inconnu »)
  assert.equal(resolvePeriode(null), 'avant 1974');
  assert.equal(resolvePeriode(undefined), 'avant 1974');
});

test('uDefautPour : lit la vraie table du plan 1', () => {
  assert.equal(uDefautPour(uDefauts, 'mur', 1960), 2.5);
  assert.equal(uDefautPour(uDefauts, 'mur', 2015), 0.23);
  assert.equal(uDefautPour(uDefauts, 'plancherBas', 1995), 0.5);
  assert.equal(uDefautPour(uDefauts, 'plafond', 2008), 0.2);
  assert.equal(uDefautPour(uDefauts, 'fenetre', 1990), null); // pas de table fenêtre (plan 1)
  assert.throws(() => uDefautPour(uDefauts, 'toiture', 1990), /thermique/); // type inconnu ≠ type sans table
});
