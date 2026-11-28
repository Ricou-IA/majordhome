// Rapprochement des fournisseurs du fichier — scripts/import-articles/fournisseurs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleFournisseur, rapprocherFournisseurs } from '../../src/lib/importArticles/fournisseurs.js';

test('cleFournisseur : sans accent, casse, ponctuation ni forme juridique', () => {
  assert.equal(cleFournisseur('BAYWA r.e. SAS'), cleFournisseur('Baywa RE'));
  assert.equal(cleFournisseur('Cédéo'), cleFournisseur('CEDEO'));
  assert.notEqual(cleFournisseur('Tereva SA'), cleFournisseur('Tereva Distribution'));
  assert.equal(cleFournisseur('  Soditelem   SARL '), 'soditelem');
  assert.equal(cleFournisseur('SAS'), 'sas'); // jamais de clé vide pour un nom non vide
  assert.equal(cleFournisseur(''), '');
});

test('rapprocherFournisseurs : une entrée par clé, existant reconnu, sinon à créer', () => {
  const r = rapprocherFournisseurs(['Baywa RE', 'BAYWA R.E.', 'Cedeo', '', null], [{ id: 'b1', name: 'BayWa r.e.' }]);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { nom: 'Baywa RE', cle: 'baywa re', supplierId: 'b1', aCreer: false });
  assert.deepEqual(r[1], { nom: 'Cedeo', cle: 'cedeo', supplierId: null, aCreer: true });
});
