// scripts/catalogue/matches-model.test.mjs
// Mise en forme des rapprochements entre fournisseurs (src/lib/catalogue/matchesModel.js) — module PUR.
// Run : node --test scripts/catalogue/matches-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecartPct, libelleAussiChez, autreCote, trierParEcart, formatPrixHt } from '../../src/lib/catalogue/matchesModel.js';

const match = {
  id: 'm1', statut: 'confirme', model_key: 'LUNA20007E1',
  product_a_id: 'pa', product_a_name: 'LUNA2000-7-E1 Battery Module', product_a_reference: '35-117819', product_a_purchase: 2001.9, supplier_a_id: 'sa', supplier_a_name: 'BAYWA R.E.',
  product_b_id: 'pb', product_b_name: 'HUAWEI – Batterie LUNA2000-7-E1', product_b_reference: '482057', product_b_purchase: 2119.94, supplier_b_id: 'sb', supplier_b_name: 'DOMOS INDUSTRIES',
  ecart_pct: 5.9,
};

test('ecartPct : écart relatif en %, une décimale, null si prix nul', () => {
  assert.equal(ecartPct(2001.9, 2119.94), 5.9);
  assert.equal(ecartPct(2119.94, 2001.9), -5.6);
  assert.equal(ecartPct(0, 10), null);
  assert.equal(ecartPct(null, 10), null);
});

test('formatPrixHt : PDF-safe, virgule décimale, espace des milliers', () => {
  assert.equal(formatPrixHt(2119.94), '2 119,94 € HT');
  assert.equal(formatPrixHt(10.5), '10,50 € HT');
});

test('autreCote : vu depuis un produit, le fournisseur et le prix d\'en face, avec l\'écart par rapport à MOI', () => {
  const vuDeA = autreCote(match, 'pa');
  assert.equal(vuDeA.supplierName, 'DOMOS INDUSTRIES');
  assert.equal(vuDeA.productId, 'pb');
  assert.equal(vuDeA.reference, '482057');
  assert.equal(vuDeA.purchase, 2119.94);
  assert.equal(vuDeA.ecartPct, 5.9);
  const vuDeB = autreCote(match, 'pb');
  assert.equal(vuDeB.supplierName, 'BAYWA R.E.');
  assert.equal(vuDeB.ecartPct, -5.6);
  assert.equal(autreCote(match, 'inconnu'), null);
});

test('libelleAussiChez : « DOMOS INDUSTRIES : 2 119,94 € HT (+5,9 %) » ; signe et moins cher', () => {
  assert.equal(libelleAussiChez(autreCote(match, 'pa')), 'DOMOS INDUSTRIES : 2 119,94 € HT (+5,9 %)');
  assert.equal(libelleAussiChez(autreCote(match, 'pb')), 'BAYWA R.E. : 2 001,90 € HT (-5,6 %, moins cher)');
  assert.equal(libelleAussiChez({ supplierName: 'X', purchase: 100, ecartPct: 0 }), 'X : 100,00 € HT (même prix)');
});

test('trierParEcart : écart absolu décroissant, les propositions avant les confirmées à écart égal', () => {
  const liste = [
    { id: 'a', statut: 'confirme', ecart_pct: 2 },
    { id: 'b', statut: 'propose', ecart_pct: -9.7 },
    { id: 'c', statut: 'propose', ecart_pct: 2 },
    { id: 'd', statut: 'confirme', ecart_pct: null },
  ];
  assert.deepEqual(trierParEcart(liste).map((m) => m.id), ['b', 'c', 'a', 'd']);
});
