// scripts/catalogue/age-de-prix.test.mjs
// Âge et fraîcheur d'un prix d'achat (src/lib/catalogue/ageDePrix.js) — module PUR.
// Run : node --test scripts/catalogue/age-de-prix.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageJours, estFrais, libelleAge, SEUIL_FRAICHEUR_JOURS } from '../../src/lib/catalogue/ageDePrix.js';

const now = new Date('2026-10-24T10:00:00Z');

test('seuil de fraîcheur = 30 jours (spec § 5.4)', () => {
  assert.equal(SEUIL_FRAICHEUR_JOURS, 30);
});

test('estFrais : moins de 30 jours vrai, plus de 30 jours faux, inconnu faux', () => {
  assert.equal(estFrais('2026-10-01T04:00:00Z', now), true);
  assert.equal(estFrais('2026-09-24T10:00:01Z', now), true, 'juste sous 30 jours');
  assert.equal(estFrais('2026-09-01T00:00:00Z', now), false);
  assert.equal(estFrais('2026-09-24T09:59:59Z', now), false, 'juste au-delà de 30 jours');
  assert.equal(estFrais(null, now), false);
  assert.equal(estFrais(undefined, now), false);
  assert.equal(estFrais('pas une date', now), false);
  assert.equal(estFrais('2026-10-01', now, 10), false, 'seuil surchargé');
});

test('ageJours : entier, 0 le jour même, null si inconnu', () => {
  assert.equal(ageJours('2026-10-24T04:00:00Z', now), 0);
  assert.equal(ageJours('2026-10-23T04:00:00Z', now), 1);
  assert.equal(ageJours('2026-10-01T04:00:00Z', now), 23);
  assert.equal(ageJours(null, now), null);
});

test('libelleAge : aujourd\'hui, hier, jours, mois, jamais', () => {
  assert.equal(libelleAge('2026-10-24T04:00:00Z', now), 'relevé aujourd’hui');
  assert.equal(libelleAge('2026-10-23T04:00:00Z', now), 'relevé hier');
  assert.equal(libelleAge('2026-10-01T04:00:00Z', now), 'il y a 23 jours');
  assert.equal(libelleAge('2026-07-20T04:00:00Z', now), 'il y a 3 mois');
  assert.equal(libelleAge('2025-06-01T04:00:00Z', now), 'il y a plus d’un an');
  assert.equal(libelleAge(null, now), 'jamais');
});
