// scripts/catalogue/article-depuis-ligne.test.mjs
// Créer un article de la base depuis une ligne libre du devis (src/lib/catalogue/natures.js) — retour d'Eric
// (2026-10-25) : « la création des articles n'a pas été proposée » sur ses lignes saisies à la main.
// Run : node --test scripts/catalogue/article-depuis-ligne.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { natureDepuisChapitre, articleDepuisLigne, lignesSansArticle } from '../../src/lib/catalogue/natures.js';

test('natureDepuisChapitre : le type du chapitre décide de la nature de l\'article', () => {
  assert.equal(natureDepuisChapitre('equipement'), 'main');
  assert.equal(natureDepuisChapitre('option'), 'accessory');
  assert.equal(natureDepuisChapitre('stock'), 'stock');
  assert.equal(natureDepuisChapitre('main_oeuvre'), 'main_oeuvre');
  assert.equal(natureDepuisChapitre('libre'), 'main');
  assert.equal(natureDepuisChapitre(undefined), 'main');
});

test('articleDepuisLigne : libellé, unité connue (sinon pièce), prix de vente = prix unitaire de la ligne', () => {
  assert.deepEqual(articleDepuisLigne({ designation: '  Disjoncteur XP 1P+N 32A C ', unit: 'u', unit_price_ht: '35.35' }, 'stock', null),
    { name: 'Disjoncteur XP 1P+N 32A C', productKind: 'stock', unit: 'pièce', sellingPriceHt: 35.35, category: null });
  assert.deepEqual(articleDepuisLigne({ designation: 'Pose et installation', unit: 'forfait', unit_price_ht: 225 }, 'main_oeuvre', 'borne_recharge'),
    { name: 'Pose et installation', productKind: 'main_oeuvre', unit: 'forfait', sellingPriceHt: 225, category: null });
  assert.deepEqual(articleDepuisLigne({ designation: 'Abri', unit: 'pièce', unit_price_ht: 90 }, 'option', 'borne_recharge'),
    { name: 'Abri', productKind: 'accessory', unit: 'pièce', sellingPriceHt: 90, category: 'borne_recharge' });
  assert.equal(articleDepuisLigne({ designation: '   ', unit_price_ht: 3 }, 'stock', null), null, 'sans libellé : pas d\'article');
});

test('lignesSansArticle : lignes libres ou de main d\'œuvre, nommées, pas encore rattachées à un article', () => {
  const lignes = [
    { line_type: 'section_title', designation: 'SECU' },
    { line_type: 'product', is_freeform: true, designation: 'Disjoncteur', catalog_item_id: null },
    { line_type: 'product', is_freeform: true, designation: '', catalog_item_id: null },
    { line_type: 'labor', designation: 'Pose', catalog_item_id: null },
    { line_type: 'product', designation: 'Borne', catalog_item_id: 'a1' },
    { line_type: 'product', is_freeform: true, designation: 'Câble', catalog_item_id: 'a2' },
  ];
  assert.deepEqual(lignesSansArticle(lignes), [1, 3]);
});
