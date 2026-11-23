import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casseTitre, COLONNES_TRIABLES, triSuivant, champsModifies } from '../src/lib/clientsAffichage.js';

test('casseTitre : majuscules et minuscules d’un nom, à l’affichage seulement', () => {
  assert.equal(casseTitre('FAMILLE DELORME'), 'Famille Delorme');
  assert.equal(casseTitre('jean-pierre DUPONT'), 'Jean-Pierre Dupont');
  assert.equal(casseTitre('MAISON DE LA PIERRE'), 'Maison de la Pierre');
  assert.equal(casseTitre("DE L'ESTANG"), "De l'Estang");
  assert.equal(casseTitre("D'ARTAGNAN PIERRE"), "D'Artagnan Pierre");
  assert.equal(casseTitre('SCI LES TILLEULS'), 'SCI les Tilleuls');
  assert.equal(casseTitre('  ÉLODIE   MARTIN '), 'Élodie Martin');
  assert.equal(casseTitre(''), '');
  assert.equal(casseTitre(null), '');
});

test('COLONNES_TRIABLES : seules les colonnes de la vue majordhome_clients', () => {
  assert.deepEqual(COLONNES_TRIABLES, ['display_name', 'city', 'client_number', 'created_at']);
});

test('triSuivant : même colonne = inverse ; autre colonne = ascendant, sauf la date (récent d’abord)', () => {
  assert.deepEqual(triSuivant({ cle: 'display_name', ascendant: true }, 'display_name'), { cle: 'display_name', ascendant: false });
  assert.deepEqual(triSuivant({ cle: 'display_name', ascendant: false }, 'display_name'), { cle: 'display_name', ascendant: true });
  assert.deepEqual(triSuivant({ cle: 'display_name', ascendant: true }, 'city'), { cle: 'city', ascendant: true });
  assert.deepEqual(triSuivant({ cle: 'city', ascendant: true }, 'created_at'), { cle: 'created_at', ascendant: false });
  assert.equal(triSuivant({ cle: 'city', ascendant: true }, 'phone'), null);
});

test('champsModifies : les clés dont la valeur a changé, espaces ignorés', () => {
  assert.deepEqual(champsModifies({ a: 'x ', b: 1 }, { a: 'x', b: 2 }), ['b']);
  assert.deepEqual(champsModifies({ a: 'x' }, { a: 'x' }), []);
  assert.deepEqual(champsModifies({ a: true }, { a: false, c: 'nouveau' }), ['a', 'c']);
  assert.deepEqual(champsModifies({ a: '' }, { a: null }), []);
  assert.deepEqual(champsModifies({}, {}), []);
});
