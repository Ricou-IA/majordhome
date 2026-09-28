import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composer } from '../../src/lib/fumisterie/compose.js';
import { buildFumisterieConfig, DEFAULTS_FUMISTERIE } from '../../src/lib/fumisterie/config.js';

const R = { longueurs: [1000, 500, 250], reglable: { min: 320, max: 500 } };

test('4807 mm : 5 × 1000, surlongueur 193 (reste 807 hors plage réglable)', () => {
  const c = composer(4807, { ...R, avecReglable: true });
  assert.deepEqual(c.elements, { 1000: 5, 500: 0, 250: 0 });
  assert.equal(c.reglable, null);
  assert.equal(c.total, 5000); assert.equal(c.surlongueur, 193); assert.equal(c.nb, 5);
});
test('1600 mm : 1000 + 500 + 250, 3 emboîtements, surlongueur 150', () => {
  const c = composer(1600, { ...R, avecReglable: true });
  assert.deepEqual(c.elements, { 1000: 1, 500: 1, 250: 1 });
  assert.equal(c.nb, 3); assert.equal(c.surlongueur, 150);
});
test('1450 mm sans réglable : 1000 + 500, surlongueur 50', () => {
  const c = composer(1450, { ...R, avecReglable: false });
  assert.deepEqual(c.elements, { 1000: 1, 500: 1, 250: 0 }); assert.equal(c.surlongueur, 50);
});
test('1400 mm avec réglable : 1000 + réglable 400, surlongueur 0', () => {
  const c = composer(1400, { ...R, avecReglable: true });
  assert.deepEqual(c.elements, { 1000: 1, 500: 0, 250: 0 });
  assert.deepEqual(c.reglable, { n: 1, longueur: 400 }); assert.equal(c.surlongueur, 0); assert.equal(c.nb, 2);
});
test('1900 mm avec réglable : 1000 + 500 + réglable 400', () => {
  const c = composer(1900, { ...R, avecReglable: true });
  assert.deepEqual(c.elements, { 1000: 1, 500: 1, 250: 0 }); assert.deepEqual(c.reglable, { n: 1, longueur: 400 });
});
test('longueur nulle ou négative : rien', () => {
  assert.equal(composer(0, R).nb, 0); assert.equal(composer(-30, R).nb, 0);
});
test('config : défauts complets et surcharge par settings', () => {
  const c = buildFumisterieConfig({ fumisterie: { finition_defaut: 'inox', zone1: { pente_m: 0.5 } } });
  assert.equal(c.finition_defaut, 'inox');
  assert.equal(c.zone1.pente_m, 0.5); assert.equal(c.zone1.plat_m, DEFAULTS_FUMISTERIE.zone1.plat_m);
  assert.deepEqual(buildFumisterieConfig(null).longueurs_elements_mm, [1000, 500, 250]);
});
