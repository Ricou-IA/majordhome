// scripts/thermique/thermal-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculeUParoi, RSI_RSE } from '../../src/apps/thermique/lib/thermalEngine.js';

test('calculeUParoi : mur parpaing + laine de verre + placo', () => {
  // Rsi+Rse mur vertical = 0.13+0.04 = 0.17 (EN ISO 6946)
  // R = 0.20/1.053 (0.18994) + 0.10/0.04 (2.5) + 0.013/0.25 (0.052) = 2.74194
  // U = 1/(0.17+2.74194) = 1/2.91194 = 0.34341
  const u = calculeUParoi([
    { e: 0.20, lambda: 1.053 },
    { e: 0.10, lambda: 0.04 },
    { e: 0.013, lambda: 0.25 },
  ], 'mur');
  assert.ok(Math.abs(u - 0.3434) < 0.0005, `U=${u}`);
});

test('calculeUParoi : résistance R directe acceptée dans une couche (ex. lame d’air R=0.18)', () => {
  // R = 0.18 + 0.10/0.04 = 2.68 ; U = 1/(0.17+2.68) = 1/2.85 = 0.35088
  const u = calculeUParoi([{ r: 0.18 }, { e: 0.10, lambda: 0.04 }], 'mur');
  assert.ok(Math.abs(u - 0.3509) < 0.0005, `U=${u}`);
});

test('calculeUParoi : Rsi/Rse selon le type de paroi (plancher/plafond ≠ mur)', () => {
  assert.equal(RSI_RSE.mur, 0.17);
  assert.equal(RSI_RSE.plafond, 0.14);   // flux ascendant : 0.10 + 0.04
  assert.equal(RSI_RSE.plancher, 0.21);  // flux descendant : 0.17 + 0.04
});

test('calculeUParoi : erreurs propres', () => {
  assert.throws(() => calculeUParoi([], 'mur'), /thermique/);
  assert.throws(() => calculeUParoi([{ e: 0.2 }], 'mur'), /thermique/);          // ni lambda ni r
  assert.throws(() => calculeUParoi([{ e: 0.2, lambda: 0 }], 'mur'), /thermique/);
  assert.throws(() => calculeUParoi([{ e: 0.2, lambda: 1 }], 'toit'), /thermique/); // type inconnu
  // r ET e/lambda dans la même couche : ambigu → échec fort (erreur de saisie)
  assert.throws(() => calculeUParoi([{ r: 0.18, e: 0.1, lambda: 0.04 }], 'mur'), /ambiguë/);
  assert.throws(() => calculeUParoi([{ e: 0.1, lambda: 0.04, r: -1 }], 'mur'), /ambiguë/);
});
