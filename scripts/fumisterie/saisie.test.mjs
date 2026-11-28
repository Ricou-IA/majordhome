// Saisie d'une mesure du métré : la virgule et le point valent la même chose, quelle que soit la langue du navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNombre, formaterSaisie } from '../../src/lib/fumisterie/saisie.js';

test('virgule et point décimaux', () => {
  assert.equal(parseNombre('1,05').valeur, 1.05);
  assert.equal(parseNombre('1.05').valeur, 1.05);
  assert.equal(parseNombre('1,5').valeur, 1.5);
  assert.equal(parseNombre(' 2,50 ').valeur, 2.5);
  assert.equal(parseNombre(',5').valeur, 0.5);
});

test('espaces entre groupes de trois chiffres', () => {
  assert.equal(parseNombre('1 050').valeur, 1050);
  assert.equal(parseNombre('1\u00a0050').valeur, 1050);
  assert.equal(parseNombre('1\u202f050,5').valeur, 1050.5);
  assert.equal(parseNombre('1 05').etat, 'invalide');
});

test('signe moins', () => {
  assert.equal(parseNombre('-0,5').valeur, -0.5);
  assert.equal(parseNombre('\u22120,5').valeur, -0.5);
});

test('saisie en cours, vide, invalide', () => {
  assert.deepEqual(parseNombre('1,'), { valeur: null, etat: 'en_cours' });
  assert.deepEqual(parseNombre('1.'), { valeur: null, etat: 'en_cours' });
  assert.deepEqual(parseNombre('-'), { valeur: null, etat: 'en_cours' });
  assert.deepEqual(parseNombre(''), { valeur: null, etat: 'vide' });
  assert.deepEqual(parseNombre('  '), { valeur: null, etat: 'vide' });
  assert.equal(parseNombre('abc').etat, 'invalide');
  assert.equal(parseNombre('1,2,3').etat, 'invalide');
  assert.equal(parseNombre('1.2,3').etat, 'invalide');
  assert.equal(parseNombre('1e3').etat, 'invalide');
  assert.equal(parseNombre(null).etat, 'vide');
});

test('formaterSaisie écrit à la française', () => {
  assert.equal(formaterSaisie(1.05), '1,05');
  assert.equal(formaterSaisie(2), '2');
  assert.equal(formaterSaisie(1050), '1050');
  assert.equal(formaterSaisie(-0.5), '-0,5');
  assert.equal(formaterSaisie(0.1 + 0.2), '0,3');
  assert.equal(formaterSaisie(null), '');
  assert.equal(formaterSaisie(''), '');
  assert.equal(formaterSaisie(NaN), '');
});

test('aller-retour', () => {
  for (const n of [0, 0.3, 1.05, 2.5, 12, 1050.25]) assert.equal(parseNombre(formaterSaisie(n)).valeur, n);
});
