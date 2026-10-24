// scripts/catalogue/releve.test.mjs
// Allègement d'un relevé avant envoi à l'edge (src/lib/catalogue/releve.js) : on ne transmet que ce que les
// adaptateurs lisent, et le résultat de l'adaptateur est IDENTIQUE sur le relevé allégé.
// Run : node --test scripts/catalogue/releve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allegerReleve } from '../../src/lib/catalogue/releve.js';
import { articlesDepuisReleveSuitecommerce } from '../../src/lib/catalogue/suitecommerce.js';
import { articlesDepuisReleveWoocommerce } from '../../src/lib/catalogue/woocommerce.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (f) => JSON.parse(readFileSync(path.join(racine, 'scripts', 'catalogue', 'data', f), 'utf8'));
const taille = (o) => JSON.stringify(o).length;

test('BayWa : le relevé allégé perd descriptions et détails de prix, garde fields/docs/prix, et produit les mêmes lignes', () => {
  const brut = lire('baywa-2026-10.json');
  const leger = allegerReleve('suitecommerce', brut);
  assert.equal(leger.total, brut.total);
  assert.equal(leger.fetched_at, brut.fetched_at);
  assert.equal(leger.items.length, brut.items.length);
  const i = leger.items.find((x) => x.itemid === '35-119503');
  assert.equal(i.storedescription, undefined);
  assert.equal(i.price_detail, undefined);
  assert.equal(i.price, 4773.29);
  assert.ok(i.fields && i.docs);
  assert.ok('urlcomponent' in i, 'urlcomponent (page produit) conservé pour image_source_url');
  assert.ok(taille(leger) < taille(brut) * 0.5, `allégé ${taille(leger)} vs brut ${taille(brut)}`);
  assert.deepEqual(articlesDepuisReleveSuitecommerce(leger, { version: 'v' }), articlesDepuisReleveSuitecommerce(brut, { version: 'v' }));
});

test('Domos : le relevé allégé perd la description longue, mêmes lignes', () => {
  const brut = lire('domos-2026-10.json');
  const leger = allegerReleve('woocommerce', brut);
  assert.equal(leger.total, brut.total);
  assert.equal(leger.items.length, brut.items.length);
  const i = leger.items.find((x) => x.sku === '323052');
  assert.equal(i.description, undefined);
  assert.ok(i.short_description);
  assert.ok(i.prices && i.categories);
  assert.ok(taille(leger) < taille(brut) * 0.7, `allégé ${taille(leger)} vs brut ${taille(brut)}`);
  assert.deepEqual(articlesDepuisReleveWoocommerce(leger, { version: 'v' }), articlesDepuisReleveWoocommerce(brut, { version: 'v' }));
});

test('connecteur inconnu ou relevé sans items : renvoyé tel quel (l\'edge tranchera)', () => {
  const r = { total: 1, items: [{ a: 1 }] };
  assert.deepEqual(allegerReleve('autre', r), r);
  assert.deepEqual(allegerReleve('suitecommerce', { total: 0 }), { total: 0 });
});
