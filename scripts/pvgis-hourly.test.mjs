// scripts/pvgis-hourly.test.mjs
// Tests des transformations PVGIS seriescalc → prodHourly (src/apps/solaire/lib/pvgisHourly.js).
// Run : node --test scripts/pvgis-hourly.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePvgisHourly, alignTo8760, pvgisToProdHourly } from '../src/apps/solaire/lib/pvgisHourly.js';

test('parsePvgisHourly — P (W, 1 kWc) → kWh × puissance, année lue', () => {
  const outputsHourly = [
    { time: '20210101:0010', P: 0 },
    { time: '20210101:0110', P: 500 },
    { time: '20210101:0210', P: 1000 },
  ];
  const { prodHourly, year } = parsePvgisHourly(outputsHourly, 6);
  assert.equal(year, 2021);
  assert.deepEqual(prodHourly, [0, 3, 6]); // 500×6/1000=3 ; 1000×6/1000=6
});

test('parsePvgisHourly — entrée vide → erreur explicite', () => {
  assert.throws(() => parsePvgisHourly([], 6), /vide ou invalide/);
});

test('alignTo8760 — 8760 inchangé (copie)', () => {
  const src = Array.from({ length: 8760 }, (_, i) => i);
  const out = alignTo8760(src);
  assert.equal(out.length, 8760);
  assert.notEqual(out, src);        // copie, pas la même référence
  assert.equal(out[0], 0);
  assert.equal(out[8759], 8759);
});

test('alignTo8760 — 8784 bissextile → retire les 24 h du 29 février', () => {
  const src = Array.from({ length: 8784 }, (_, i) => i); // valeur = index
  const out = alignTo8760(src);
  assert.equal(out.length, 8760);
  // avant le 29 févr. : inchangé
  assert.equal(out[1415], 1415);
  // à la place du 29 févr. (heures 1416-1439 retirées) : l'heure suivante (1440)
  assert.equal(out[1416], 1440);
  // fin de série décalée de 24
  assert.equal(out[8759], 8783);
});

test('alignTo8760 — longueur inattendue → erreur', () => {
  assert.throws(() => alignTo8760(new Array(100).fill(0)), /longueur inattendue 100/);
});

test('pvgisToProdHourly — chaîne complète, sortie 8760', () => {
  // année bissextile simulée : 8784 pas, P constant 1000 W
  const outputsHourly = Array.from({ length: 8784 }, (_, i) => ({
    time: `2020...:${i}`, P: 1000,
  }));
  const { prodHourly, year } = pvgisToProdHourly(outputsHourly, 3);
  assert.equal(year, 2020);
  assert.equal(prodHourly.length, 8760);
  assert.equal(prodHourly[0], 3); // 1000×3/1000
});
