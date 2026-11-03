// scripts/devis-ligne-article.test.mjs
// Réalignement d'une ligne de devis sur son article après édition (src/lib/devisLigneArticle.js).
// Run : node --test scripts/devis-ligne-article.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rafraichirPrixLignes, realignerLigne } from '../src/lib/devisLigneArticle.js';
import { SEP } from '../src/lib/catalogue/marqueLigne.js';

const avant = { name: 'Poêle A', unit: 'pièce', selling_price_ht: 2500, code: null, updated_at: '2026-10-26T10:00:00Z', specs: {} };
const apres = { ...avant, name: 'Poêle A+', code: 'ME-001', selling_price_ht: 2600, updated_at: '2026-10-26T11:00:00Z' };

test('article inchangé : la ligne est renvoyée telle quelle (même référence)', () => {
  const l = { designation: 'Poêle A', unit_price_ht: 2500, quantity: 1, show_specs: false };
  assert.equal(realignerLigne(l, avant, avant, []), l);
});

test('article modifié : libellé, unité, référence et caractéristiques suivent ; prix suivi seulement s\'il n\'avait pas été ajusté', () => {
  const suivie = realignerLigne({ designation: 'Poêle A', unit_price_ht: 2500, quantity: 2, show_specs: false }, avant, apres, []);
  assert.deepEqual([suivie.designation, suivie.reference, suivie.unit_price_ht, suivie.quantity], ['Poêle A+', 'ME-001', 2600, 2]);
  const ajustee = realignerLigne({ designation: 'Poêle A', unit_price_ht: 2400, show_specs: false }, avant, apres, []);
  assert.equal(ajustee.unit_price_ht, 2400);
});

test('show_specs vrai : caractéristiques recalculées ; faux : vidées ; quantité, remise, TVA, description conservées', () => {
  const champs = [{ key: 'power_nominal_kw', label: 'Puissance nominale', unit: 'kW', type: 'number' }];
  const modifie = { ...apres, specs: { canonical: { power_nominal_kw: 8 } } };
  const base = { designation: 'Poêle A', unit_price_ht: 2500, quantity: 3, discount_percent: 5, tva_rate: 10, description: 'Texte', caracteristiques: ['ancien'] };
  const avec = realignerLigne({ ...base, show_specs: true }, avant, modifie, champs);
  assert.deepEqual(avec.caracteristiques, ['Puissance nominale : 8 kW']);
  assert.deepEqual([avec.quantity, avec.discount_percent, avec.tva_rate, avec.description, avec.show_specs], [3, 5, 10, 'Texte', true]);
  const sans = realignerLigne({ ...base, show_specs: false }, avant, modifie, champs);
  assert.deepEqual(sans.caracteristiques, []);
});

test('aucune mutation : la ligne d\'origine reste intacte ; unité de l\'article reprise', () => {
  const l = Object.freeze({ designation: 'Poêle A', unit_price_ht: 2500, unit: 'u', show_specs: false });
  const r = realignerLigne(l, avant, { ...apres, unit: 'pièce' }, []);
  assert.notEqual(r, l);
  assert.equal(l.designation, 'Poêle A');
  assert.equal(r.unit, 'pièce');
});

test('article sans code : référence vide', () => {
  const r = realignerLigne({ designation: 'x', unit_price_ht: 2500, show_specs: false }, avant, { ...apres, code: null }, []);
  assert.equal(r.reference, '');
});

test('prix de vente nul/absent : pas d exception, prix de la ligne conservé (jamais NaN)', () => {
  const sansDate = { ...avant, updated_at: undefined, selling_price_ht: null };
  const r = realignerLigne({ designation: 'x', unit_price_ht: 2500, show_specs: false }, sansDate, { ...apres, selling_price_ht: null }, []);
  assert.notEqual(r.designation, 'x');
  assert.equal(r.unit_price_ht, 2500);
  const sansPrix = { ...avant };
  delete sansPrix.selling_price_ht;
  const r2 = realignerLigne({ designation: 'x', unit_price_ht: 2500, show_specs: false }, sansPrix, { ...apres, selling_price_ht: null }, []);
  assert.equal(r2.unit_price_ht, 2500);
  assert.ok(!Number.isNaN(r2.unit_price_ht));
});

test('référence : fournisseur ou saisie conservée, ancien code de l article remplacé, vide complétée', () => {
  const offre = realignerLigne({ designation: 'x', reference: 'SUP-123', supplier_product_id: 'sp1', unit_price_ht: 2500, show_specs: false }, avant, apres, []);
  assert.equal(offre.reference, 'SUP-123');
  const picker = realignerLigne({ designation: 'x', reference: '', unit_price_ht: 2500, show_specs: false }, avant, apres, []);
  assert.equal(picker.reference, 'ME-001');
  const absente = realignerLigne({ designation: 'x', unit_price_ht: 2500, show_specs: false }, avant, apres, []);
  assert.equal(absente.reference, 'ME-001');
  const ancien = realignerLigne({ designation: 'x', reference: 'ME-OLD', unit_price_ht: 2500, show_specs: false }, { ...avant, code: 'ME-OLD' }, apres, []);
  assert.equal(ancien.reference, 'ME-001');
});

test('marque : le suffixe « – Marque » est recomposé sur le nouveau nom ; sans marque, nom tel quel', () => {
  const renomme = { ...apres, name: 'Disjoncteur 16 A' };
  const marquee = realignerLigne({ designation: 'Disjoncteur 16A' + SEP + 'Hager', brand: 'Hager', unit_price_ht: 2500, show_specs: false }, avant, renomme, []);
  assert.equal(marquee.designation, 'Disjoncteur 16 A' + SEP + 'Hager');
  assert.equal(marquee.brand, 'Hager');
  const sans = realignerLigne({ designation: 'Disjoncteur 16A', brand: null, unit_price_ht: 2500, show_specs: false }, avant, renomme, []);
  assert.equal(sans.designation, 'Disjoncteur 16 A');
});

test('rafraichirPrixLignes : seules les lignes produit liées à un article à prix > 0 et différent changent ; totaux de ligne recalculés', () => {
  const lignes = [
    { line_type: 'section_title', designation: 'ÉQUIPEMENT' },
    { line_type: 'product', designation: 'PAC', catalog_item_id: 'a', unit_price_ht: 0, quantity: 2, tva_rate: 5.5, discount_percent: 0 },
    { line_type: 'product', designation: 'Ajustée', catalog_item_id: 'b', unit_price_ht: 2400, quantity: 1, tva_rate: 20 },
    { line_type: 'product', designation: 'Déjà au prix', catalog_item_id: 'c', unit_price_ht: 100, quantity: 1, tva_rate: 20 },
    { line_type: 'product', designation: 'Article à 0', catalog_item_id: 'd', unit_price_ht: 50, quantity: 1, tva_rate: 20 },
    { line_type: 'product', designation: 'Sans article', catalog_item_id: null, unit_price_ht: 0, quantity: 1, tva_rate: 20 },
    { line_type: 'product', designation: 'Article disparu', catalog_item_id: 'z', unit_price_ht: 10, quantity: 1, tva_rate: 20 },
  ];
  const articles = [
    { id: 'a', selling_price_ht: '5454.58' }, { id: 'b', selling_price_ht: 2600 }, { id: 'c', selling_price_ht: 100 }, { id: 'd', selling_price_ht: 0 },
  ];
  const r = rafraichirPrixLignes(lignes, articles);
  assert.equal(r.lignes.length, lignes.length);
  assert.equal(r.lignes[0], lignes[0]);
  assert.deepEqual([r.lignes[1].unit_price_ht, r.lignes[1].total_ht, r.lignes[1].total_tva, r.lignes[1].total_ttc], [5454.58, 10909.16, 600, 11509.16]);
  assert.deepEqual([r.lignes[2].unit_price_ht, r.lignes[2].total_ht], [2600, 2600]);
  assert.equal(r.lignes[3], lignes[3]);
  assert.equal(r.lignes[4], lignes[4]);
  assert.equal(r.lignes[5], lignes[5]);
  assert.equal(r.lignes[6], lignes[6]);
  assert.deepEqual(r.modifiees.map((m) => [m.designation, m.avant, m.apres]), [['PAC', 0, 5454.58], ['Ajustée', 2400, 2600]]);
  assert.deepEqual(r.sansPrix.map((l) => l.designation), ['Article à 0', 'Sans article', 'Article disparu']);
});

test('rafraichirPrixLignes : rien à changer → mêmes objets, aucune modifiée', () => {
  const lignes = [{ line_type: 'product', designation: 'x', catalog_item_id: 'a', unit_price_ht: 10, quantity: 1, tva_rate: 20 }];
  const r = rafraichirPrixLignes(lignes, [{ id: 'a', selling_price_ht: 10 }]);
  assert.equal(r.lignes[0], lignes[0]);
  assert.deepEqual(r.modifiees, []);
  assert.deepEqual(r.sansPrix, []);
});
