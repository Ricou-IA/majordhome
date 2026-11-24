import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireJoursOuverture, joursMasques, basculerJour, JOURS_SEMAINE } from '../src/lib/joursOuverture.js';

test('absent, illisible ou vide : du lundi au vendredi', () => {
  assert.deepEqual(lireJoursOuverture(null), [1, 2, 3, 4, 5]);
  assert.deepEqual(lireJoursOuverture({ jours_ouverture: 'lun-ven' }), [1, 2, 3, 4, 5]);
  assert.deepEqual(lireJoursOuverture({ jours_ouverture: [] }), [1, 2, 3, 4, 5]);
  assert.deepEqual(lireJoursOuverture({ jours_ouverture: [9, 'x'] }), [1, 2, 3, 4, 5]);
});

test('réglage lu, trié, sans doublon', () => {
  assert.deepEqual(lireJoursOuverture({ jours_ouverture: [6, 1, 2, 2, '3', 4, 5] }), [1, 2, 3, 4, 5, 6]);
});

test('jours masqués = complément', () => {
  assert.deepEqual(joursMasques([1, 2, 3, 4, 5]), [0, 6]);
  assert.deepEqual(joursMasques([1, 2, 3, 4, 5, 6]), [0]);
  assert.deepEqual(joursMasques([0, 1, 2, 3, 4, 5, 6]), []);
});

test('basculer un jour ; le dernier jour ouvert reste', () => {
  assert.deepEqual(basculerJour([1, 2, 3, 4, 5], 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(basculerJour([1, 2, 3, 4, 5], 3), [1, 2, 4, 5]);
  assert.deepEqual(basculerJour([2], 2), [2]);
  assert.equal(JOURS_SEMAINE[0].libelle, 'Lundi');
});
