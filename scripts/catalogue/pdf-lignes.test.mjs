// node --test scripts/catalogue/pdf-lignes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { lignesDepuisMots, nombreFR, nombreEN, dateFR, centimes } from './pdf-lignes.js';
import { ligne, ligneEspacee } from './mots-fixture.mjs';

test('lignesDepuisMots regroupe par ligne de base et trie de gauche à droite', () => {
  const mots = [...ligne(100, [300, 'b'], [10, 'a']), ...ligne(101.5, [500, 'c']), ...ligne(120, [10, 'd'])];
  const lignes = lignesDepuisMots(mots, { toleranceY: 3.2 });
  assert.equal(lignes.length, 2);
  assert.deepEqual(lignes[0].tokens.map((t) => t.t), ['a', 'b', 'c']);
  assert.deepEqual(lignes[1].tokens.map((t) => t.t), ['d']);
});

test('les caractères isolés sont recollés en mots, les mots normaux jamais', () => {
  const mots = [...ligneEspacee(200, [17, '4467946'], [65, 'MONOSPLIT MURAO'], [462, '9,44']), ...ligne(300, [10, 'Conditions'], [52, 'générales'])];
  const [a, b] = lignesDepuisMots(mots, { toleranceY: 2.5, gapLettres: 9 });
  assert.deepEqual(a.tokens.map((t) => t.t), ['4467946', 'MONOSPLIT', 'MURAO', '9,44']);
  assert.deepEqual(b.tokens.map((t) => t.t), ['Conditions', 'générales']);
});

test('sans gapLettres, rien n’est recollé', () => {
  const [l] = lignesDepuisMots(ligneEspacee(10, [17, '12']), {});
  assert.deepEqual(l.tokens.map((t) => t.t), ['1', '2']);
});

test('nombres français et anglo-saxons, dates, centimes', () => {
  assert.equal(nombreFR('1.102,90'), 1102.9);
  assert.equal(nombreFR('9,33'), 9.33);
  assert.equal(nombreFR('50,00'), 50);
  assert.equal(nombreFR('100'), 100);
  assert.equal(nombreFR('1058.2000'), null);
  assert.equal(nombreFR('BL'), null);
  assert.equal(nombreEN('1058.2000'), 1058.2);
  assert.equal(nombreEN('16.00'), 16);
  assert.equal(nombreEN('9,33'), null);
  assert.equal(dateFR('31/08/26'), '2026-08-31');
  assert.equal(dateFR('1/07/26'), '2026-07-01');
  assert.equal(dateFR('31/07/2026'), '2026-07-31');
  assert.equal(dateFR('TOTAL'), null);
  assert.equal(centimes(0.1 + 0.2), 0.3);
});
