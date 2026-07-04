import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copAt, pThAt, pElRefDe } from '../../src/apps/thermique/lib/heatPumpEngine.js';

const catalogue = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/pac-catalogue.json', import.meta.url), 'utf8'));
const reelle = catalogue.pacs.find((p) => !p.generique && p.copRef != null);
const generique = catalogue.pacs.find((p) => p.generique && p.modele.includes('average'));

test('copAt : formule hplib — COP = p1·Tin + p2·Tout + p3 + p4·Tamb (Tamb = Tin en air/eau)', () => {
  const [p1, p2, p3, p4] = reelle.coefCop;
  const attendu = Math.max(1, p1 * 7 + p2 * 35 + p3 + p4 * 7);
  assert.equal(copAt(reelle, 7, 35), attendu);
  assert.ok(copAt(reelle, 7, 35) > 2.5 && copAt(reelle, 7, 35) < 7, `COP=${copAt(reelle, 7, 35)}`);
});

test('pElRefDe : brut si présent, dérivé pthRef/COP_fitté(−7,52) pour les génériques', () => {
  assert.equal(pElRefDe(reelle), reelle.pElRef);
  const copFitte = copAt(generique, -7, 52);
  assert.ok(Math.abs(pElRefDe(generique) - generique.pthRef / copFitte) < 1e-9);
});

test('pThAt = P_el × COP avec P_el = pElRef × (q1·Tin + q2·Tout + q3 + q4·Tamb)', () => {
  const [q1, q2, q3, q4] = reelle.coefPth; // coefficients P_el (cf. _meta.note du catalogue)
  const pEl = reelle.pElRef * (q1 * 7 + q2 * 35 + q3 + q4 * 7);
  assert.ok(Math.abs(pThAt(reelle, 7, 35) - pEl * copAt(reelle, 7, 35)) < 1e-6);
  assert.ok(pThAt(reelle, -15, 35) > 0);
  assert.ok(pThAt(generique, 7, 35) > 0); // le générique fonctionne via pElRef dérivé
});

test('garde-fous température et plancher COP', () => {
  assert.throws(() => pThAt(reelle, 7, 70), /thermique/);   // tDépart hors [20, 65]
  assert.throws(() => pThAt(reelle, 7, 15), /thermique/);
  assert.throws(() => copAt(reelle, -35, 35), /thermique/);  // tExt hors [-30, 45]
  assert.ok(copAt(reelle, -25, 55) >= 1); // plancher physique (le fit linéaire peut diverger aux extrêmes)
});

test('pac invalide → erreurs propres', () => {
  assert.throws(() => copAt({ coefCop: [1, 2, 3] }, 7, 35), /thermique/);        // 3 coefs au lieu de 4
  assert.throws(() => pThAt({ coefCop: [0,0,3,0], coefPth: [0,0,1,0], pthRef: null, pElRef: null }, 7, 35), /thermique/); // ni pElRef ni pthRef
});
