// scripts/devis-calculs.test.mjs
// Calculs d'un devis (src/lib/devisCalculs.js) — remise à la ligne (demande d'Eric, 2026-10-25) puis remise globale.
// Run : node --test scripts/devis-calculs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLineTotals, computeQuoteTotals, margeFournitures, remiseLigne } from '../src/lib/devisCalculs.js';

test('remiseLigne : pourcentage borné à [0, 100], illisible ⇒ 0', () => {
  assert.equal(remiseLigne({ discount_percent: 10 }), 10);
  assert.equal(remiseLigne({ discount_percent: '12,5' }), 12.5);
  assert.equal(remiseLigne({ discount_percent: 150 }), 100);
  assert.equal(remiseLigne({ discount_percent: -3 }), 0);
  assert.equal(remiseLigne({}), 0);
});

test('computeLineTotals : la remise de ligne s\'applique au HT avant TVA, au centime', () => {
  assert.deepEqual(computeLineTotals({ quantity: 2, unit_price_ht: 100, tva_rate: 5.5, discount_percent: 10 }), { total_ht: 180, total_tva: 9.9, total_ttc: 189.9 });
  assert.deepEqual(computeLineTotals({ quantity: 1, unit_price_ht: 87.96, tva_rate: 20 }), { total_ht: 87.96, total_tva: 17.59, total_ttc: 105.55 });
  assert.deepEqual(computeLineTotals({ line_type: 'section_title', quantity: 3, unit_price_ht: 10 }), { total_ht: 0, total_tva: 0, total_ttc: 0 });
});

test('computeQuoteTotals : remises de ligne puis remise globale, ventilation TVA cohérente', () => {
  const lignes = [
    { line_type: 'section_title', designation: 'A' },
    { quantity: 1, unit_price_ht: 1000, tva_rate: 5.5, discount_percent: 10 }, // 900
    { quantity: 1, unit_price_ht: 100, tva_rate: 20 }, // 100
  ];
  const t = computeQuoteTotals(lignes, 0);
  assert.equal(t.subtotal_ht, 1000);
  assert.equal(t.total_ht, 1000);
  assert.equal(t.total_tva, 69.5);
  const g = computeQuoteTotals(lignes, 10);
  assert.equal(g.discount_amount, 100);
  assert.equal(g.total_ht, 900);
});

test('margeFournitures : la vente est comptée après remise de ligne', () => {
  const m = margeFournitures([{ quantity: 1, unit_price_ht: 200, purchase_price_ht: 100, discount_percent: 25 }]);
  assert.equal(m.vente, 150);
  assert.equal(m.achat, 100);
  assert.equal(m.marge, 50);
});
