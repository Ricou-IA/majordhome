// scripts/plane-fit.test.mjs — tests de l'ajustement de plan (src/apps/solaire/lib/planeFit.js).
// Plans synthétiques de pente/orientation connues. Run : node --test scripts/plane-fit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitPlane, fitRoofPlane } from '../src/apps/solaire/lib/planeFit.js';

// Grille 7×7 (x=Est, y=Nord en m), z fourni par fn.
function grid(fn) {
  const pts = [];
  for (let x = 0; x <= 6; x++) for (let y = 0; y <= 6; y++) pts.push({ x, y, z: fn(x, y) });
  return pts;
}
const t30 = Math.tan((30 * Math.PI) / 180);
const t20 = Math.tan((20 * Math.PI) / 180);

test('plan plat → pente 0', () => {
  const r = fitRoofPlane(grid(() => 100));
  assert.ok(r.pitchDeg < 1e-6, `pitch=${r.pitchDeg}`);
});

test('plan descendant vers le SUD → pente 30°, aspect 0 (Sud)', () => {
  // z augmente vers le nord (y+) → le pan descend vers le sud
  const r = fitRoofPlane(grid((x, y) => 100 + t30 * y));
  assert.ok(Math.abs(r.pitchDeg - 30) < 0.01, `pitch=${r.pitchDeg}`);
  assert.ok(Math.abs(r.aspectPvgis - 0) < 0.01, `aspect=${r.aspectPvgis}`);
});

test('plan descendant vers l’EST → pente 20°, aspect -90', () => {
  const r = fitRoofPlane(grid((x) => 100 - t20 * x));
  assert.ok(Math.abs(r.pitchDeg - 20) < 0.01, `pitch=${r.pitchDeg}`);
  assert.ok(Math.abs(r.aspectPvgis - (-90)) < 0.01, `aspect=${r.aspectPvgis}`);
});

test('plan descendant vers l’OUEST → aspect +90', () => {
  const r = fitRoofPlane(grid((x) => 100 + t20 * x));
  assert.ok(Math.abs(r.aspectPvgis - 90) < 0.01, `aspect=${r.aspectPvgis}`);
});

test('plan descendant vers le NORD → aspect ±180', () => {
  const r = fitRoofPlane(grid((x, y) => 100 - t30 * y));
  assert.ok(Math.abs(Math.abs(r.aspectPvgis) - 180) < 0.01, `aspect=${r.aspectPvgis}`);
});

test('plan descendant SUD-EST → aspect ~ -45 (entre Sud 0 et Est -90)', () => {
  const r = fitRoofPlane(grid((x, y) => 100 + t30 * y - t30 * x));
  assert.ok(r.aspectPvgis < 0 && r.aspectPvgis > -90, `aspect=${r.aspectPvgis}`);
  assert.ok(Math.abs(r.aspectPvgis - (-45)) < 0.5, `aspect=${r.aspectPvgis}`);
});

test('rejet d’outlier : une cheminée ne casse pas la pente', () => {
  const pts = grid((x, y) => 100 + t30 * y);
  pts.push({ x: 3, y: 3, z: 108 }); // cheminée +8 m
  const r = fitRoofPlane(pts);
  assert.ok(Math.abs(r.pitchDeg - 30) < 1, `pitch=${r.pitchDeg}`);
});

test('fitPlane : < 3 points → null', () => {
  assert.equal(fitPlane([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]), null);
});
