// Test de cohérence de src/apps/thermique/data/u-defauts.json
// Source des valeurs : Open3CL/engine (MIT), src/tv.js — tables umur/upb/uph (cf. _meta.note).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('src/apps/thermique/data/u-defauts.json', 'utf8'));

test('structure : 3 types de paroi opaque × périodes, U décroissants dans le temps', () => {
  for (const type of ['mur', 'plancherBas', 'plafond']) {
    const periodes = d[type];
    assert.ok(Array.isArray(periodes) && periodes.length >= 6, type);
    for (const p of periodes) {
      assert.match(p.periode, /^\d{4}|^avant|^après/i, `${type}: libellé de période inattendu "${p.periode}"`);
      assert.ok(p.u > 0.1 && p.u < 6.5, `${type} ${p.periode}: U=${p.u}`);
    }
    assert.ok(periodes.at(-1).u < periodes[0].u, `${type}: U récent doit être meilleur`);
  }
});

test('pas de valeurs fenêtre inventées (Open3CL ne fournit pas de Uw par période)', () => {
  assert.equal(d.fenetre, undefined, "aucune table Open3CL n'associe Uw à une période de construction");
});

test('plausibilité : bornes connues du DPE 3CL', () => {
  assert.equal(d.mur.find((p) => p.periode === 'avant 1974').u, 2.5);
  assert.ok(d.mur.at(-1).u >= 0.2 && d.mur.at(-1).u <= 0.4, 'mur récent ~0.2-0.4');
  assert.ok(d.plancherBas[0].u >= 1.5, 'plancher bas ancien élevé');
  assert.ok(d.plafond[0].u >= 2, 'plafond ancien élevé');
});
