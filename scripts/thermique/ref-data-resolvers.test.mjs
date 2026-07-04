// scripts/thermique/ref-data-resolvers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePeriode, uDefautPour, thetaBasePour, coefficientBPour, chercheCommunes } from '../../src/apps/thermique/lib/refDataResolvers.js';

const uDefauts = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/u-defauts.json', import.meta.url), 'utf8'));
const climat = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/climat.json', import.meta.url), 'utf8'));
const coefB = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/coefficients-b.json', import.meta.url), 'utf8'));

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
  // formulaires HTML : chaînes numériques coercées avant le test de validité
  assert.equal(resolvePeriode('1980'), '1978-1982');
  assert.equal(resolvePeriode(''), 'avant 1974');
  assert.equal(resolvePeriode('abc'), 'avant 1974');
});

test('uDefautPour : lit la vraie table du plan 1', () => {
  assert.equal(uDefautPour(uDefauts, 'mur', 1960), 2.5);
  assert.equal(uDefautPour(uDefauts, 'mur', 2015), 0.23);
  assert.equal(uDefautPour(uDefauts, 'plancherBas', 1995), 0.5);
  assert.equal(uDefautPour(uDefauts, 'plafond', 2008), 0.2);
  assert.equal(uDefautPour(uDefauts, 'fenetre', 1990), null); // pas de table fenêtre (plan 1)
  assert.throws(() => uDefautPour(uDefauts, 'toiture', 1990), /thermique/); // type inconnu ≠ type sans table
});

test('thetaBasePour : valeurs plan 1, sans correction d’altitude (report phase A/B)', () => {
  assert.equal(thetaBasePour(climat, '81', 140).thetaE, -5);
  assert.equal(thetaBasePour(climat, '67', 150).thetaE, -15);
  assert.equal(thetaBasePour(climat, '2A', 50).thetaE, -2);
  assert.equal(thetaBasePour(climat, '81', 140).correctionAltitude, 'non-appliquée');
  assert.throws(() => thetaBasePour(climat, '971', 10), /DOM/);
  assert.throws(() => thetaBasePour(climat, '99', 10), /thermique/);
});

test('coefficientBPour : lit les catégories réelles', () => {
  // valeurs vérifiées plan 1 : Sous-sol[0] = 0.5 ; Espace sous toiture[2] = 0.7 (toiture isolée)
  assert.equal(coefficientBPour(coefB, 'Sous-sol', 0), 0.5);
  assert.equal(coefficientBPour(coefB, 'Espace sous toiture', 2), 0.7);
  assert.throws(() => coefficientBPour(coefB, 'Grenier', 0), /thermique/);
});

test('chercheCommunes : par nom (insensible accents/casse) + dept', () => {
  const communes = [
    { nom: 'Gaillac', insee: '810099', dept: '81', altitude: 134, dju: 1943 },
    { nom: 'Gaillac-Toulza', insee: '310000', dept: '31', altitude: 300, dju: null },
  ];
  const r = chercheCommunes(communes, 'gaillac');
  assert.equal(r.length, 2);
  assert.equal(chercheCommunes(communes, 'gaillac', '81').length, 1);
  assert.equal(chercheCommunes(communes, 'g').length, 0); // < 2 caractères
  assert.equal(chercheCommunes(communes, 'GAILLAC-TOULZA')[0].insee, '310000'); // casse + tiret
});
