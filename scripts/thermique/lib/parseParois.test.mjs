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

// Variantes de l'export 2024 (C:\Thermique2) — lignes COPIÉES telles quelles du fichier réel :
// bloc terre-plein "Plan. TP" dont la ligne de totaux n'a PAS de R total (seulement
// [U jour, U nuit] en colonnes 11-12), et bloc mur enterré "Mur Ent." dont la ligne porteuse
// du U est une ligne de composant ("Profondeur moyenne au-dessous du sol"), pas une ligne
// "Déphasage thermique".
const SRC_2024_VARIANTES = [
  '"\tPlan. TP, isol. continue.\t\tA4\t\t\tRésistance de sortie contact avec le sol\t\t\t0.170\t0.170\t\t\tPlan. TP, isol. continue.\t"',
  '"\t\t\t\t\t\tThane Sol\t0.1000\t0.023\t\t4.348\t\t\t28£1450£4£\t"',
  '"\t\t\t\t\t\tRésistance d\'entrée contact avec le sol\t\t\t0.170\t0.170\t\t\t\t"',
  '"\t\t\t\t\t\t\t\t\t\t\t0.18\t0.18\t\t"',
  '"\t\t\t\t\t\t\t\t\t\t\t\t\t\t"',
  '"\tMur Ent.\t\tA1\t\t\tRésistance de sortie mur intérieur\t\t\t0.130\t0.130\t\t\tMur Ent.\t"',
  '"\t\t\t\t\t\tRésistance d\'entrée mur intérieur\t\t\t0.130\t0.130\t\t\t\t"',
  '"\t\t\t\t\t\tProfondeur moyenne au-dessous du sol\t2.50\t\t\t0.149\t6.71\t6.71\t\t"',
].join('\r\n');

test('export 2024 : totaux sans R (terre-plein) et U hors ligne Déphasage (mur enterré)', () => {
  const { parois, rejects } = parseParois(SRC_2024_VARIANTES);
  assert.equal(rejects.length, 0, JSON.stringify(rejects));
  assert.equal(parois.length, 2);
  assert.deepEqual(parois[0], { nom: 'Plan. TP, isol. continue.', code: 'A4', famille: 'Plan. TP, isol. continue.', u: 0.18 });
  assert.deepEqual(parois[1], { nom: 'Mur Ent.', code: 'A1', famille: 'Mur Ent.', u: 6.71 });
});
