// scripts/thermique/thermal-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculeUParoi, RSI_RSE, transmissionPiece, POSTES } from '../../src/apps/thermique/lib/thermalEngine.js';

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
  assert.throws(() => calculeUParoi([null], 'mur'), /thermique/);
});

test('transmissionPiece : séjour cas de référence (ΔUtb isolé en poste pontsThermiques)', () => {
  // θint 20, θe −5 → ΔT 25.
  // Mur ext :      10 m² × U 0.5 × b 1 × 25 = 125 W ; ΔUtb 0.1 → 10 × 0.1 × 1 × 25 = 25 W
  // Fenêtre :       2 m² × U 1.3 × b 1 × 25 =  65 W ; ΔUtb 0.1 →  2 × 0.1 × 1 × 25 =  5 W
  // Mur garage :    8 m² × U 0.5 × b 0.5 × 25 = 50 W ; ΔUtb 0.1 → 8 × 0.1 × 0.5 × 25 = 10 W
  // Mitoyen même θ (b=0) : 12 m² × 2.0 × 0 = 0 W
  // parPoste: murs 175, menuiseries 65, pontsThermiques 40 — total 280
  const r = transmissionPiece({
    thetaInt: 20, thetaExt: -5,
    parois: [
      { surface: 10, u: 0.5, b: 1, deltaUtb: 0.1, poste: 'murs' },
      { surface: 2, u: 1.3, b: 1, deltaUtb: 0.1, poste: 'menuiseries' },
      { surface: 8, u: 0.5, b: 0.5, deltaUtb: 0.1, poste: 'murs' },
      { surface: 12, u: 2.0, b: 0, deltaUtb: 0, poste: 'murs' },
    ],
  });
  assert.equal(r.total, 280);
  assert.equal(r.parPoste.murs, 175);
  assert.equal(r.parPoste.menuiseries, 65);
  assert.equal(r.parPoste.pontsThermiques, 40);
});

test('transmissionPiece : ΔT interne (thetaAdjacente) — gain compté négatif, b ignoré', () => {
  // 5 m² × 2.0 × (20−24) = −40 W
  const r = transmissionPiece({
    thetaInt: 20, thetaExt: -5,
    parois: [{ surface: 5, u: 2.0, thetaAdjacente: 24, deltaUtb: 0, poste: 'murs' }],
  });
  assert.equal(r.total, -40);
  assert.equal(r.parPoste.pontsThermiques ?? 0, 0); // pas de clé pontsThermiques si ΔUtb nul partout
});

test('transmissionPiece : erreurs propres', () => {
  const base = { thetaInt: 20, thetaExt: -5 };
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 0, u: 1, b: 1, deltaUtb: 0, poste: 'murs' }] }), /thermique/);
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: -1, b: 1, deltaUtb: 0, poste: 'murs' }] }), /thermique/);
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, deltaUtb: 0, poste: 'murs' }] }), /thermique/); // ni b ni thetaAdjacente
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, b: 1, poste: 'murs' }] }), /thermique/);        // deltaUtb absent
  assert.throws(() => transmissionPiece({ thetaInt: NaN, thetaExt: -5, parois: [] }), /thermique/);
  assert.throws(() => transmissionPiece({ ...base, parois: [{ surface: 1, u: 1, b: 1, deltaUtb: 0, poste: 'toiture' }] }), /thermique/); // poste hors POSTES
});

test('POSTES : liste canonique des postes du rapport', () => {
  assert.deepEqual(POSTES, ['murs', 'menuiseries', 'plancherBas', 'plafondToiture', 'pontsThermiques', 'ventilation']);
});
