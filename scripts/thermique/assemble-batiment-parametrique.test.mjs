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

import { resoudUFamille } from '../../src/apps/thermique/lib/assembleBatimentParametrique.js';
import { readFileSync } from 'node:fs';
const U_DEFAUTS = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/u-defauts.json', import.meta.url), 'utf8'));

const compos = {
  familles: {
    murs: { mode: 'valeur', u: 0.5 }, plancherBas: { mode: 'defaut', u: null },
    plafondToiture: { mode: 'defaut', u: null },
    fenetre: { u: 1.3 }, porteFenetre: { u: 1.4 }, porte: { u: 3.5 },
  },
  exceptions: { parois: { 'sej:murs': { u: 0.25 } }, ouvertures: {} },
};

test('resoudUFamille : valeur famille murs = 0.5', () => {
  assert.equal(resoudUFamille(compos, 'murs', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 }), 0.5);
});
test('resoudUFamille : exception pièce×famille prioritaire', () => {
  assert.equal(resoudUFamille(compos, 'murs', 'sej', { uDefauts: U_DEFAUTS, annee: 2010 }), 0.25);
});
test('resoudUFamille : mode défaut plancherBas résout via u-defauts par année', () => {
  const u = resoudUFamille(compos, 'plancherBas', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 });
  assert.ok(Number.isFinite(u) && u > 0);
});
test('resoudUFamille : menuiserie fenetre = 1.3', () => {
  assert.equal(resoudUFamille(compos, 'fenetre', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 }), 1.3);
});
test('resoudUFamille : U absent → null', () => {
  const c = { familles: { murs: { mode: 'valeur', u: null } }, exceptions: { parois: {}, ouvertures: {} } };
  assert.equal(resoudUFamille(c, 'murs', 'ch1', { uDefauts: U_DEFAUTS, annee: 2010 }), null);
});
