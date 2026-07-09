// scripts/thermique/assemble-batiment-parametrique.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empriseDerives } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';

const rect = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

test('empriseDerives : rectangle 500×400 cm → 20 m² / 18 m', () => {
  const d = empriseDerives({ polygone: rect(0, 0, 500, 400) });
  assert.equal(d.surfaceSol, 20);   // 5 m × 4 m
  assert.equal(d.perimetre, 18);    // 2×(5+4)
});

test('empriseDerives : polygone vide → { surfaceSol: 0, perimetre: 0 }', () => {
  const d = empriseDerives({ polygone: [] });
  assert.equal(d.surfaceSol, 0);
  assert.equal(d.perimetre, 0);
});

test('empriseDerives : emprise absente → { 0, 0 } (jamais throw)', () => {
  assert.deepEqual(empriseDerives(undefined), { surfaceSol: 0, perimetre: 0 });
});
