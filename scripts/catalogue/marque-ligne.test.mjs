// scripts/catalogue/marque-ligne.test.mjs
// Marque d'une ligne de devis posée depuis un article de stock (src/lib/catalogue/marqueLigne.js) — module PUR.
// Décision d'Eric (2026-10-25) : « les disjoncteurs, j'aurai 4 marques, je vais les regrouper par type et on changera
// la marque dans le devis ». Marge = prix d'achat le plus bas (de la marque choisie).
// Run : node --test scripts/catalogue/marque-ligne.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marquesDesOffres, appliquerMarque } from '../../src/lib/catalogue/marqueLigne.js';

const offres = [
  { brand: 'Hager', purchase_price_ht: 9.8, is_active: true },
  { brand: 'HAGER', purchase_price_ht: 9.2, is_active: true },
  { brand: 'Schneider', purchase_price_ht: 11.4, is_active: true },
  { brand: 'Legrand', purchase_price_ht: 0, is_active: true },
  { brand: 'ABB', purchase_price_ht: 7.5, is_active: false },
  { brand: null, purchase_price_ht: 6, is_active: true },
];

test('marquesDesOffres : une entrée par marque (casse ignorée), offres actives, prix = le plus bas non nul, triées par prix', () => {
  assert.deepEqual(marquesDesOffres(offres), [
    { marque: 'Hager', prix: 9.2 },
    { marque: 'Schneider', prix: 11.4 },
    { marque: 'Legrand', prix: null },
  ]);
  assert.deepEqual(marquesDesOffres([]), []);
  assert.deepEqual(marquesDesOffres(undefined), []);
});

const ligne = { designation: 'Disjoncteur 1P+N 16 A courbe C', purchase_price_ht: 9.2, brand: null, quantity: 2, unit_price_ht: 25 };

test('appliquerMarque : libellé suffixé « – Marque », prix d\'achat de la marque, le reste intact', () => {
  const l = appliquerMarque(ligne, 'Schneider', offres);
  assert.equal(l.designation, 'Disjoncteur 1P+N 16 A courbe C – Schneider');
  assert.equal(l.brand, 'Schneider');
  assert.equal(l.purchase_price_ht, 11.4);
  assert.equal(l.quantity, 2);
  assert.equal(l.unit_price_ht, 25, 'le prix de vente reste celui de l\'article');
});

test('appliquerMarque : changer de marque remplace le suffixe, jamais de doublon (Review Focus 4)', () => {
  const l1 = appliquerMarque(ligne, 'Schneider', offres);
  const l2 = appliquerMarque(l1, 'Hager', offres);
  assert.equal(l2.designation, 'Disjoncteur 1P+N 16 A courbe C – Hager');
  assert.equal(l2.purchase_price_ht, 9.2);
  const l3 = appliquerMarque(l2, 'Hager', offres);
  assert.equal(l3.designation, 'Disjoncteur 1P+N 16 A courbe C – Hager', 'réappliquer la même marque ne double pas');
});

test('appliquerMarque : marque vide ⇒ libellé générique et prix le plus bas toutes marques', () => {
  const l = appliquerMarque(appliquerMarque(ligne, 'Schneider', offres), '', offres);
  assert.equal(l.designation, 'Disjoncteur 1P+N 16 A courbe C');
  assert.equal(l.brand, null);
  assert.equal(l.purchase_price_ht, 9.2);
});

test('appliquerMarque : marque sans prix connu ⇒ prix d\'achat vide ; marque inconnue ⇒ ligne inchangée', () => {
  const l = appliquerMarque(ligne, 'Legrand', offres);
  assert.equal(l.purchase_price_ht, null);
  assert.equal(l.designation, 'Disjoncteur 1P+N 16 A courbe C – Legrand');
  assert.equal(appliquerMarque(ligne, 'Siemens', offres), ligne);
});

test('appliquerMarque : un libellé modifié à la main garde sa saisie (seul le suffixe de marque connu est remplacé)', () => {
  const saisi = { ...appliquerMarque(ligne, 'Schneider', offres), designation: 'Disjoncteur différentiel 30 mA – Schneider (tableau existant)' };
  const l = appliquerMarque(saisi, 'Hager', offres);
  assert.equal(l.designation, 'Disjoncteur différentiel 30 mA – Schneider (tableau existant) – Hager');
});
