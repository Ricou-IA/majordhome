// scripts/tournee/geo.test.mjs
// Run : node --test scripts/tournee/geo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleCoord, barycentre, filtreProximite, haversineKm } from '../../src/lib/tournee/geo.js';

const GAILLAC = { lat: 43.9019, lng: 1.8981 };
const ALBI = { lat: 43.9298, lng: 2.1480 };

test('cleCoord — 3 décimales, stable et symétrique en format', () => {
  assert.equal(cleCoord({ lat: 43.90194, lng: 1.89812 }), '43.902,1.898');
  assert.equal(cleCoord({ lat: 43.9019449, lng: 1.8981 }), cleCoord({ lat: 43.90189, lng: 1.89814 }),
    'deux points a moins de 100 m partagent la meme cle');
});

test('cleCoord — coordonnées absentes → null', () => {
  assert.equal(cleCoord({ lat: null, lng: 1.9 }), null);
  assert.equal(cleCoord(null), null);
});

test('barycentre — moyenne des points, null si vide', () => {
  const b = barycentre([{ lat: 43.9, lng: 1.9 }, { lat: 43.9, lng: 2.1 }]);
  assert.ok(Math.abs(b.lat - 43.9) < 1e-9);
  assert.ok(Math.abs(b.lng - 2.0) < 1e-9);
  assert.equal(barycentre([]), null);
});

test('barycentre — ignore les points sans coordonnées', () => {
  const b = barycentre([{ lat: 43.9, lng: 1.9 }, { lat: null, lng: null }]);
  assert.ok(Math.abs(b.lat - 43.9) < 1e-9);
});

test('filtreProximite — garde ce qui est dans le rayon', () => {
  const candidats = [
    { id: 'proche', ...GAILLAC },
    { id: 'loin', ...ALBI },        // ~20 km
    { id: 'sanscoord', lat: null, lng: null },
  ];
  const dans = filtreProximite(candidats, GAILLAC, 25).map((c) => c.id);
  assert.deepEqual(dans.sort(), ['loin', 'proche']);

  const serre = filtreProximite(candidats, GAILLAC, 5).map((c) => c.id);
  assert.deepEqual(serre, ['proche']);
});

test('filtreProximite — centre null → aucun filtrage (tout passe sauf sans coords)', () => {
  const candidats = [{ id: 'a', ...GAILLAC }, { id: 'b', lat: null, lng: null }];
  assert.deepEqual(filtreProximite(candidats, null, 25).map((c) => c.id), ['a']);
});

test('haversineKm réexporté et cohérent', () => {
  const d = haversineKm(GAILLAC, ALBI);
  assert.ok(d > 18 && d < 22, `attendu ~20 km, obtenu ${d}`);
});

test('cleCoord — chaîne vide et blanche rejetées', () => {
  assert.equal(cleCoord({ lat: '', lng: 1.9 }), null, 'chaîne vide en lat');
  assert.equal(cleCoord({ lat: 1.9, lng: '' }), null, 'chaîne vide en lng');
  assert.equal(cleCoord({ lat: '  ', lng: 1.9 }), null, 'chaîne blanche en lat');
  assert.equal(cleCoord({ lat: 1.9, lng: '  ' }), null, 'chaîne blanche en lng');
});

test('cleCoord — booléens rejetés', () => {
  assert.equal(cleCoord({ lat: true, lng: 1.9 }), null);
  assert.equal(cleCoord({ lat: false, lng: 1.9 }), null);
  assert.equal(cleCoord({ lat: 1.9, lng: true }), null);
});

test('cleCoord — tableaux rejetés', () => {
  assert.equal(cleCoord({ lat: [], lng: 1.9 }), null);
  assert.equal(cleCoord({ lat: [43.9], lng: 1.9 }), null);
  assert.equal(cleCoord({ lat: 1.9, lng: [] }), null);
});

test('barycentre — filtre chaînes vides et booléens', () => {
  const b = barycentre([
    { lat: 43.9, lng: 1.9 },
    { lat: '', lng: '' },
    { lat: true, lng: false },
  ]);
  assert.ok(Math.abs(b.lat - 43.9) < 1e-9, 'chaînes vides et booléens ignorés');
});

test('filtreProximite — filtre chaînes vides et booléens', () => {
  const candidats = [
    { id: 'valide', ...GAILLAC },
    { id: 'vide', lat: '', lng: '' },
    { id: 'bool', lat: true, lng: false },
  ];
  const resultat = filtreProximite(candidats, GAILLAC, 50).map((c) => c.id);
  assert.deepEqual(resultat, ['valide'], 'chaînes vides et booléens écartés');
});
