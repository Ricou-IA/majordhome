// scripts/catalogue/woocommerce.test.mjs
// Adaptateur WooCommerce (src/lib/catalogue/woocommerce.js — Domos Industries) sur le RELEVÉ RÉEL
// scripts/catalogue/data/domos-2026-10.json. Périmètre complet depuis la tranche 2.
// Run : node --test scripts/catalogue/woocommerce.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { articlesDepuisReleveWoocommerce } from '../../src/lib/catalogue/woocommerce.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releve = JSON.parse(readFileSync(path.join(racine, 'scripts', 'catalogue', 'data', 'domos-2026-10.json'), 'utf8'));
const resultat = articlesDepuisReleveWoocommerce(releve, { version: 'domos_2026-10' });
const ligne = (sku) => resultat.lignes.find((l) => l.reference === sku);

test('périmètre complet : 604 articles simples retenus (1 non achetable écarté), 156 bundles exclus', () => {
  assert.equal(resultat.retenus, 604);
  assert.equal(resultat.exclus.kits, 156);
  assert.equal(resultat.exclus.non_achetable, 1);
  assert.equal(resultat.exclus.par_mapping, 0);
  assert.equal(resultat.lignes.length, 604);
  assert.ok(resultat.lignes.every((l) => l.unit === 'pièce' && l.default_tva_rate === 20 && l.selling_price_ht_defaut === 0));
});

test('stockage → batterie (52, comme en tranche 1), le reste → photovoltaique, sans catégorie → photovoltaique', () => {
  assert.equal(resultat.lignes.filter((l) => l.category === 'batterie').length, 52);
  assert.equal(resultat.lignes.filter((l) => l.category === 'borne_recharge').length, 10);
  assert.ok(resultat.lignes.filter((l) => l.category === 'borne_recharge').every((l) => l.product_kind === 'main'));
  assert.equal(resultat.lignes.filter((l) => l.category === 'photovoltaique').length, 604 - 52 - 10);
  assert.equal(ligne('323052').category, 'batterie');
  assert.equal(ligne('323052').gamme, 'Batterie AC');
  assert.equal(ligne('405034').category, 'photovoltaique', 'compteur Livoltek sans catégorie');
  assert.deepEqual(ligne('405034').specs.canonical.categories_site, []);
});

test('onduleur Huawei : photovoltaique, gamme = sous-catégorie la plus précise, principal, clé modèle', () => {
  const o = ligne('483090');
  assert.equal(o.category, 'photovoltaique');
  assert.equal(o.gamme, 'Onduleur central');
  assert.equal(o.product_kind, 'main');
  assert.equal(o.model_key, 'SUN20005KLB0');
  assert.equal(ligne('482057').model_key, 'LUNA20007E1');
  assert.equal(ligne('482057').product_kind, 'main');
});

test('précédence des catégories : batterie DC + déstockage ⇒ batterie ; déstockage exclu ⇒ écarté', () => {
  assert.equal(ligne('482025').category, 'batterie');
  const r = articlesDepuisReleveWoocommerce(releve, { version: 'v', mapping: { destockage: 'exclure' } });
  assert.equal(r.lignes.find((l) => l.reference === '482025'), undefined);
  assert.ok(r.exclus.par_mapping >= 19);
});

test('categories_vues : slug, libellé, parent, nombre ; entrée (sans categorie) = 23', () => {
  const sans = resultat.categories_vues.find((c) => c.cle === '(sans categorie)');
  assert.deepEqual(sans, { cle: '(sans categorie)', libelle: 'Sans catégorie', parent: null, nombre: 23 });
  const ac = resultat.categories_vues.find((c) => c.cle === 'batteries-ac');
  assert.equal(ac.libelle, 'Batteries AC');
  assert.equal(ac.parent, 'Système de stockage');
  assert.ok(ac.nombre >= 11);
});

test('photo et page produit depuis le relevé', () => {
  assert.equal(ligne('323052').image_url, 'https://webshop.domosindustries.com/wp-content/uploads/2026/09/M-ELV-Battbank-Atmoce.webp');
  assert.equal(ligne('323052').image_source_url, 'https://webshop.domosindustries.com/produit/atmoce-battbank-module-batterie-16kwh/');
});

test('relevé tronqué : refus', () => {
  assert.throws(() => articlesDepuisReleveWoocommerce({ total: 761, items: releve.items.slice(0, 10) }, { version: 'x' }), /releve_incomplet/);
});
