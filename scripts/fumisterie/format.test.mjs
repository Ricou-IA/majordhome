// Quantités du métré : virgule décimale et unité lisible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatQuantite } from '../../src/lib/fumisterie/format.js';

test('formatQuantite', () => {
  assert.equal(formatQuantite(6.5, 'ml'), '6,5 m');
  assert.equal(formatQuantite(6.5, 'm'), '6,5 m');
  assert.equal(formatQuantite(3, 'pièce'), '3');
  assert.equal(formatQuantite(3, null), '3');
  assert.equal(formatQuantite(1.005, 'm'), '1,01 m');
  assert.equal(formatQuantite(1200, 'pièce'), '1 200');
  assert.equal(formatQuantite(null, 'm'), '—');
  assert.equal(formatQuantite('abc', 'm'), '—');
});
