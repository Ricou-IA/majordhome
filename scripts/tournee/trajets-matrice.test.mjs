// scripts/tournee/trajets-matrice.test.mjs
// Run : node --test scripts/tournee/trajets-matrice.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireMatrice, estimerParVolDOiseau, trajetLocal } from '../../src/lib/tournee/matrice.js';

test('construireMatrice — lookup symétrique par clés', () => {
  const trajet = construireMatrice(new Map([['A|B', 12], ['B|A', 13]]));
  assert.equal(trajet('A', 'B'), 12);
  assert.equal(trajet('B', 'A'), 13);
});

test('construireMatrice — même point = 0', () => {
  const trajet = construireMatrice(new Map());
  assert.equal(trajet('A', 'A'), 0);
});

test('construireMatrice — paire absente : repli explicite, jamais 0', () => {
  const trajet = construireMatrice(new Map(), { defautMinutes: 45 });
  assert.equal(trajet('A', 'B'), 45,
    'une paire inconnue doit couter cher, sinon le moteur croit le trajet gratuit');
});

test('estimerParVolDOiseau — 20 km → ~34 min (facteur route 1,4 à 50 km/h)', () => {
  const min = estimerParVolDOiseau(20);
  assert.ok(min > 30 && min < 38, `attendu ~34, obtenu ${min}`);
});

test('trajetLocal — même clé = 0, sans même parser', () => {
  assert.equal(trajetLocal('43.900,1.900', '43.900,1.900'), 0);
});

test('trajetLocal — clé manquante : repli explicite, jamais 0 ni exception', () => {
  assert.equal(trajetLocal(null, '43.900,1.900'), 60);
  assert.equal(trajetLocal('43.900,1.900', null), 60);
  assert.equal(trajetLocal(null, null), 60);
});

test('trajetLocal — cohérent avec estimerParVolDOiseau + haversine sur deux points distincts', () => {
  // Gaillac (~43.9027,1.8973) -> Albi (~43.9298,2.1480), ~20 km à vol d'oiseau.
  const min = trajetLocal('43.9027,1.8973', '43.9298,2.1480');
  assert.ok(min > 30 && min < 38, `attendu ~34 (même ordre de grandeur qu'estimerParVolDOiseau(20)), obtenu ${min}`);
});

test('trajetLocal — symétrique (ordre des points sans effet)', () => {
  const aVersB = trajetLocal('43.9027,1.8973', '43.9298,2.1480');
  const bVersA = trajetLocal('43.9298,2.1480', '43.9027,1.8973');
  assert.equal(aVersB, bVersA);
});

test('construireMatrice — le repli comble une paire absente avant le forfait', () => {
  // Le classement ne demande a Mapbox que depot/arrets <-> candidat : les paires
  // candidat<->candidat n'y sont jamais. Sans repli, l'apercu d'une selection
  // multiple leur appliquait 60 min forfaitaires ; en basculant TOUT en vol
  // d'oiseau, il affichait une heure differente de la liste pour le meme client.
  const paires = new Map([['A|B', 12]]);
  const repli = (from, to) => (from === 'B' && to === 'C' ? 7 : 99);
  const trajet = construireMatrice(paires, { repli });

  assert.equal(trajet('A', 'B'), 12, 'la valeur reelle prime toujours sur le repli');
  assert.equal(trajet('B', 'C'), 7, 'la paire absente passe par le repli');
  assert.equal(trajet('A', 'A'), 0, 'meme point, toujours zero');
});

test('construireMatrice — un repli qui ne sait pas répondre retombe sur le forfait', () => {
  const trajet = construireMatrice(new Map(), { repli: () => undefined, defautMinutes: 42 });
  assert.equal(trajet('X', 'Y'), 42, 'jamais 0 : un trajet gratuit serait un echec silencieux');
});
