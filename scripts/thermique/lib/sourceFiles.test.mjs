import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unquote, parseFrNumber, stripDiacritics } from './sourceFiles.js';

test('unquote retire les guillemets englobants et trim', () => {
  assert.equal(unquote('"Pièce"'), 'Pièce');
  assert.equal(unquote('  "0.40 Avec 1 mur"  '), '0.40 Avec 1 mur');
  assert.equal(unquote('sans guillemets'), 'sans guillemets');
});

test('parseFrNumber gère virgule, espaces (dont insécables) et vide', () => {
  assert.equal(parseFrNumber('0.60'), 0.6);
  assert.equal(parseFrNumber('0,036'), 0.036);
  assert.equal(parseFrNumber('2 165'), 2165); // espace insécable (DJU)
  assert.equal(parseFrNumber('1 000'), 1000);
  assert.equal(parseFrNumber(''), null);
  assert.equal(parseFrNumber('abc'), null);
});

test('stripDiacritics pour comparaisons de noms', () => {
  assert.equal(stripDiacritics('Bétons'), 'Betons');
});
