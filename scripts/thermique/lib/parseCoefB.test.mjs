import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoefB } from './parseCoefB.js';

const SRC = [
  '"Pièce"',
  '"0.40 Avec seulement 1 mur extérieur"',
  '"0.50 Avec seulement 2 murs extérieurs sans portes extérieures"',
  '""',
  '"Sous-sol"',
  '"0.50 Sans fenêtre ni porte extérieure"',
  '""',
].join('\n');

test('parse catégories et valeurs b', () => {
  const cats = parseCoefB(SRC);
  assert.equal(cats.length, 2);
  assert.equal(cats[0].categorie, 'Pièce');
  assert.deepEqual(cats[0].valeurs[0], { b: 0.4, description: 'Avec seulement 1 mur extérieur' });
  assert.equal(cats[1].categorie, 'Sous-sol');
  assert.equal(cats[1].valeurs.length, 1);
});

// La source réelle contient des catégories dont l'unique valeur n'a AUCUNE description
// (ex. "Paroi donnant directement sur l'extérieur" -> "1.00" seul sur la ligne).
const SRC_SANS_DESCRIPTION = [
  '"Paroi donnant directement sur l\'extérieur"',
  '"1.00"',
  '""',
  '"Paroi donnant sur un local chauffée à la même température"',
  '"0.00"',
].join('\n');

test('parse une valeur b sans description (ligne = nombre seul)', () => {
  const cats = parseCoefB(SRC_SANS_DESCRIPTION);
  assert.equal(cats.length, 2);
  assert.equal(cats[0].categorie, "Paroi donnant directement sur l'extérieur");
  assert.deepEqual(cats[0].valeurs, [{ b: 1, description: null }]);
  assert.equal(cats[1].categorie, 'Paroi donnant sur un local chauffée à la même température');
  assert.deepEqual(cats[1].valeurs, [{ b: 0, description: null }]);
});

// Le fichier source ne se termine pas forcément par une ligne vide : la dernière
// catégorie doit quand même être capturée (flush implicite en fin de texte).
test('capture la dernière catégorie même sans ligne vide finale', () => {
  const cats = parseCoefB('"Cat"\n"1.00"');
  assert.equal(cats.length, 1);
  assert.deepEqual(cats[0].valeurs, [{ b: 1, description: null }]);
});
