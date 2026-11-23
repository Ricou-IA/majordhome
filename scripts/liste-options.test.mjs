import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrerOptions, avecRecherche, libelleDe, SEUIL_RECHERCHE } from '../src/lib/listeOptions.js';

const OPTIONS = [
  { value: '', label: 'Toutes' },
  { value: 'elec', label: 'Électricité' },
  { value: 'plomb', label: 'Plomberie' },
  { value: 2, label: 'Deux' },
];

test('filtrerOptions : sans accent ni casse, sur le libellé', () => {
  assert.deepEqual(filtrerOptions(OPTIONS, 'elec').map((o) => o.label), ['Électricité']);
  assert.deepEqual(filtrerOptions(OPTIONS, 'PLOMB').map((o) => o.label), ['Plomberie']);
  assert.deepEqual(filtrerOptions(OPTIONS, '  ').map((o) => o.label), OPTIONS.map((o) => o.label));
  assert.deepEqual(filtrerOptions(OPTIONS, '').length, 4); // l'option vide reste quand rien n'est saisi
  assert.deepEqual(filtrerOptions(OPTIONS, 'zzz'), []);
  assert.deepEqual(filtrerOptions(null, 'a'), []);
});

test('avecRecherche : à partir de 7 options', () => {
  const liste = (n) => Array.from({ length: n }, (_, i) => ({ value: String(i), label: `O${i}` }));
  assert.equal(SEUIL_RECHERCHE, 7);
  assert.equal(avecRecherche(liste(6)), false);
  assert.equal(avecRecherche(liste(7)), true);
  assert.equal(avecRecherche(undefined), false);
});

test('libelleDe : valeur comparée en chaîne, comme un <select>', () => {
  assert.equal(libelleDe(OPTIONS, '2'), 'Deux');
  assert.equal(libelleDe(OPTIONS, 2), 'Deux');
  assert.equal(libelleDe(OPTIONS, ''), 'Toutes');
  assert.equal(libelleDe(OPTIONS, 'inconnu'), null);
  assert.equal(libelleDe(OPTIONS, null), 'Toutes'); // null se lit comme '' (value={x || ''})
});
