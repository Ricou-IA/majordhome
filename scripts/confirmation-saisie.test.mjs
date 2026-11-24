import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formeComparable, saisieDemandee, saisieConforme } from '../src/lib/confirmationSaisie.js';

test('casse, accents et espaces en trop sont ignorés', () => {
  assert.equal(formeComparable('  DUPONT   Élise '), 'dupont elise');
  assert.equal(saisieConforme('dupont elise', 'DUPONT Élise'), true);
  assert.equal(saisieConforme('Dupont  Élise', 'DUPONT Élise'), true);
});

test('une saisie partielle ou différente ne confirme pas', () => {
  assert.equal(saisieConforme('', 'DUPONT Élise'), false);
  assert.equal(saisieConforme('DUPONT', 'DUPONT Élise'), false);
  assert.equal(saisieConforme('DUPONT Elisa', 'DUPONT Élise'), false);
});

test('un nom attendu vide ne demande rien', () => {
  assert.equal(saisieDemandee(''), false);
  assert.equal(saisieDemandee(null), false);
  assert.equal(saisieDemandee('   '), false);
  assert.equal(saisieConforme('', null), true);
  assert.equal(saisieDemandee('X'), true);
});
