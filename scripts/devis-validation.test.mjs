import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ligneChiffree, manquesDevis, RAISONS_DEVIS } from '../src/lib/devisValidation.js';

const chapitre = { line_type: 'section_title', designation: 'Équipement', quantity: 0, unit_price_ht: 0 };
const vide = { line_type: 'product', designation: '', quantity: 1, unit_price_ht: 0 };
const sansPrix = { line_type: 'product', designation: 'Poêle', quantity: 1, unit_price_ht: 0 };
const sansNom = { line_type: 'product', designation: ' ', quantity: 1, unit_price_ht: 500 };
const bonne = { line_type: 'product', designation: 'Poêle', quantity: 1, unit_price_ht: 2500 };
const offerte = { line_type: 'product', designation: 'Ramonage', quantity: 1, unit_price_ht: 80, discount_percent: 100 };

test('une ligne compte si elle a une désignation et un montant HT > 0', () => {
  assert.equal(ligneChiffree(chapitre), false);
  assert.equal(ligneChiffree(vide), false);
  assert.equal(ligneChiffree(sansPrix), false);
  assert.equal(ligneChiffree(sansNom), false);
  assert.equal(ligneChiffree(bonne), true);
  assert.equal(ligneChiffree({ ...bonne, quantity: 0 }), false);
});

test('l’objet manque d’abord, puis la ligne', () => {
  assert.deepEqual(manquesDevis({ subject: '', lines: [] }), { objet: true, ligne: true, raison: RAISONS_DEVIS.objet });
  assert.deepEqual(manquesDevis({ subject: 'Pose', lines: [chapitre, sansPrix] }), { objet: false, ligne: true, raison: RAISONS_DEVIS.ligne });
  assert.deepEqual(manquesDevis({ subject: '  ', lines: [bonne] }), { objet: true, ligne: false, raison: RAISONS_DEVIS.objet });
  assert.deepEqual(manquesDevis({ subject: 'Pose', lines: [chapitre, bonne, vide] }), { objet: false, ligne: false, raison: null });
});

test('une ligne entièrement offerte ne porte pas le devis seule', () => {
  assert.equal(manquesDevis({ subject: 'Pose', lines: [offerte] }).ligne, true);
});
