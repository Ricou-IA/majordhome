import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabQuoted, parseVitrages, parseMenuiseriesProfils, parseVolets, parseWarmEdge, parseCoffresVolets } from './parseMenuiseries.js';

// Fixtures COPIÉES telles quelles depuis C:\Thermique\Vitrages.txt (échantillon réel).
const VITRAGES_SRC = [
  '"Simple vitrage courant\t4\t0.90\t5.70\t0.90\t"',
  '"Saint-Gobain - double vitrage - Planitherm argon\t4/12/4\t0.70\t1.40\t0.81\t"',
  '"Saint-Gobain - double vitrage - Planilux + Planitherm Ultra N + Argon 90%\t4/16/4\t0.64\t1.10\t0.81\t"',
  '"Porte palière isolante\t\t0.00\t1.60\t0.00\t"',
].join('\r\n');

test('parseVitrages : nom + format + ug (4e champ) ; g et TL ignorés du besoin mais lus', () => {
  const rows = parseVitrages(VITRAGES_SRC);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { nom: 'Simple vitrage courant', format: '4', ug: 5.7 });
  assert.deepEqual(rows[1], { nom: 'Saint-Gobain - double vitrage - Planitherm argon', format: '4/12/4', ug: 1.4 });
  // Vérifie l'exemple donné dans la consigne de tâche : 4/16/4 argon -> ug 1.10
  assert.deepEqual(rows[2], {
    nom: 'Saint-Gobain - double vitrage - Planilux + Planitherm Ultra N + Argon 90%',
    format: '4/16/4', ug: 1.1,
  });
  assert.equal(rows[3].format, ''); // "Porte palière isolante" n'a pas de format vitrage
});

// Fixtures COPIÉES depuis C:\Thermique\Menuiseries.txt
const MENUISERIES_SRC = [
  '"Menuiserie métallique à  rupture de pont thermique de mauvais niveau\t5.00\t"',
  '"Menuiserie PVC de très bon niveau\t1.50\t"',
  '"Menuiserie VELUX fenètre de toit double vitrage\t1.50\t"',
].join('\r\n');

test('parseMenuiseriesProfils : nom + uf', () => {
  const rows = parseMenuiseriesProfils(MENUISERIES_SRC);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { nom: 'Menuiserie métallique à  rupture de pont thermique de mauvais niveau', uf: 5 });
  assert.deepEqual(rows[1], { nom: 'Menuiserie PVC de très bon niveau', uf: 1.5 });
});

// Fixtures COPIÉES depuis C:\Thermique\Volets.txt
const VOLETS_SRC = [
  '"Volet roulant PVC (e > 12 mm)\t0.25\t"',
  '"Volet roulant alu\t0.14\t"',
  '"Persienne avec ajours fixes\t0.08\t"',
].join('\r\n');

test('parseVolets : nom + deltaR', () => {
  const rows = parseVolets(VOLETS_SRC);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { nom: 'Volet roulant PVC (e > 12 mm)', deltaR: 0.25 });
  assert.deepEqual(rows[1], { nom: 'Volet roulant alu', deltaR: 0.14 });
});

// Fixtures COPIÉES depuis C:\Thermique\WarmEdge.txt (coefficient linéique psi de l'intercalaire, W/(m.K))
const WARMEDGE_SRC = [
  '"Double Vitrage - Métal avec séparation thermique\t0.051\t"',
  '"Triple Vitrage - Matière synthétique - Warm edge\t0.038\t"',
].join('\r\n');

test('parseWarmEdge : nom + psi (coefficient linéique intercalaire)', () => {
  const rows = parseWarmEdge(WARMEDGE_SRC);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { nom: 'Double Vitrage - Métal avec séparation thermique', psi: 0.051 });
  assert.deepEqual(rows[1], { nom: 'Triple Vitrage - Matière synthétique - Warm edge', psi: 0.038 });
});

// Fixtures COPIÉES depuis C:\Thermique\CoffreVolets.txt
const COFFREVOLETS_SRC = [
  '"Coffre PVC, non isolé\t1.40\t"',
  '"Coffre PVC, isolé, de très bonne qualité\t0.58\t"',
].join('\r\n');

test('parseCoffresVolets : nom + uc', () => {
  const rows = parseCoffresVolets(COFFREVOLETS_SRC);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { nom: 'Coffre PVC, non isolé', uc: 1.4 });
  assert.deepEqual(rows[1], { nom: 'Coffre PVC, isolé, de très bonne qualité', uc: 0.58 });
});

test('parseTabQuoted : ignore les lignes vides et déballe les guillemets/tabs', () => {
  // unquote() trim() la ligne : le champ vide final (tabulation traînante) disparaît,
  // ce qui est sans conséquence puisque seuls c[0]/c[1]/c[3] sont exploités par les parseurs.
  const rows = parseTabQuoted('"a\tb\t"\r\n\r\n"c\td\t"\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['c', 'd']]);
});
