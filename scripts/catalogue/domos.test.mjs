// scripts/catalogue/domos.test.mjs
// Adaptateur Domos Industries (src/lib/catalogue/domos.js) sur le RELEVÉ RÉEL scripts/catalogue/data/domos-2026-10.json.
// Run : node --test scripts/catalogue/domos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { articlesDepuisReleveDomos } from '../../src/lib/catalogue/domos.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releve = JSON.parse(readFileSync(path.join(racine, 'scripts', 'catalogue', 'data', 'domos-2026-10.json'), 'utf8'));
const resultat = articlesDepuisReleveDomos(releve, { version: 'domos_2026-10' });
const ligne = (sku) => resultat.lignes.find((l) => l.reference === sku);

test('périmètre stockage : 52 articles simples retenus, 9 bundles exclus, 16 batteries principales', () => {
  assert.equal(resultat.retenus, 52);
  assert.equal(resultat.exclus.kits, 9);
  assert.equal(resultat.lignes.length, 52);
  assert.equal(resultat.lignes.filter((l) => l.product_kind === 'main').length, 16);
  assert.ok(resultat.lignes.every((l) => l.category === 'batterie' && l.unit === 'pièce' && l.default_tva_rate === 20));
  assert.equal(resultat.releve_at, releve.fetched_at);
});

test('ATMOCE BattBank 16 kWh : prix en centimes converti, batterie AC principale, pas de prix de vente', () => {
  const a = ligne('323052');
  assert.equal(a.purchase_price_ht, 3039.6);
  assert.equal(a.selling_price_ht_defaut, 0);
  assert.equal(a.product_kind, 'main');
  assert.equal(a.brand, 'ATMOCE');
  assert.equal(a.gamme, 'Batterie AC');
  assert.equal(a.name, 'ATMOCE – BattBank – Module batterie 16kWh');
  assert.equal(a.specs.canonical.energie_utile_kwh, 16);
  assert.equal(a.specs.canonical.domos_id, 6475);
  assert.equal(a.specs.canonical.fiche_produit, 'https://webshop.domosindustries.com/produit/atmoce-battbank-module-batterie-16kwh/');
  assert.deepEqual(a.specs.canonical.stock_releve, { en_stock: true, at: releve.fetched_at });
  assert.equal(a.specs.source_version, 'domos_2026-10');
});

test('Huawei LUNA2000-7-E1 : batterie DC principale ; EcoFlow Smart Meter : accessoire stockage', () => {
  assert.equal(ligne('482057').purchase_price_ht, 2119.94);
  assert.equal(ligne('482057').product_kind, 'main');
  assert.equal(ligne('482057').gamme, 'Batterie DC');
  assert.equal(ligne('482057').brand, 'HUAWEI');
  assert.equal(ligne('392092').product_kind, 'accessory');
  assert.equal(ligne('392092').gamme, 'Accessoire stockage');
  assert.equal(ligne('392092').brand, 'ECOFLOW');
});

test('marque : premier mot du nom même sans séparateur propre', () => {
  assert.equal(ligne('405024').brand, 'LIVOLTEK');
  assert.equal(ligne('110020').brand, 'PYLONTECH');
  assert.equal(ligne('322011').brand, 'SUNOLOGY');
});

test('relevé tronqué : refus', () => {
  assert.throws(() => articlesDepuisReleveDomos({ total: 761, items: releve.items.slice(0, 10) }, { version: 'x' }), /releve_incomplet/);
});
