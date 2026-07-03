import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParois } from './parseParois.js';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./fixture-parois.txt', import.meta.url), 'latin1');

test('extrait nom, code, famille et U jour des blocs paroi (mur)', () => {
  const { parois } = parseParois(SRC);
  const brique = parois.find((p) => p.nom.startsWith('ME. Briques G35'));
  assert.ok(brique);
  assert.equal(brique.code, 'A1');
  assert.equal(brique.famille, 'Mur Ext.');
  assert.ok(Math.abs(brique.u - 0.15) < 0.005);
});

test('bloc fenêtre (FE.) : U jour vient du Uw de la ligne "Coefficients de la fenêtre"', () => {
  const { parois } = parseParois(SRC);
  const fenetre = parois.find((p) => p.nom.startsWith('FE. PVC 1.25'));
  assert.ok(fenetre);
  assert.equal(fenetre.code, 'A7');
  assert.equal(fenetre.famille, 'Fen. Porte et Porte-fen.');
  // Uw = 1.25 annoncé dans "Coefficients de la fenêtre, (Uw = 1.25), ..."
  assert.equal(fenetre.u, 1.25);
});

test('aucun U aberrant', () => {
  const { parois } = parseParois(SRC);
  for (const p of parois) assert.ok(p.u > 0.05 && p.u < 6, `${p.nom}: U=${p.u}`);
});

test('aucun rejet sur la fixture (2 blocs complets)', () => {
  const { rejects } = parseParois(SRC);
  assert.equal(rejects.length, 0, JSON.stringify(rejects));
});
