// scripts/devis-ligne-article.test.mjs
// Réalignement d'une ligne de devis sur son article après édition (src/lib/devisLigneArticle.js).
// Run : node --test scripts/devis-ligne-article.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realignerLigne } from '../src/lib/devisLigneArticle.js';

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

test('article sans code : référence vide ; prix de vente nul/absent ne casse pas le suivi', () => {
  const r = realignerLigne({ designation: 'x', unit_price_ht: 2500, show_specs: false }, avant, { ...apres, code: null }, []);
  assert.equal(r.reference, '');
});
