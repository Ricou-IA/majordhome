// scripts/catalogue/article-ligne.test.mjs
// Fiche fournisseur : ce que l'ARTICLE apporte à une ligne fournisseur (src/lib/catalogue/articleLigne.js) — retour
// d'Eric (2026-10-25) : la fiche fournisseur n'affichait ni la photo enrichie ni la même référence chez un autre fournisseur.
// Run : node --test scripts/catalogue/article-ligne.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoDeLigne, autresFournisseurs } from '../../src/lib/catalogue/articleLigne.js';

test('photoDeLigne : la photo de la ligne d\'abord, sinon celle de son article', () => {
  assert.equal(photoDeLigne({ image_url: 'ligne.jpg' }, { image_url: 'article.jpg' }), 'ligne.jpg');
  assert.equal(photoDeLigne({ image_url: null }, { image_url: 'article.jpg' }), 'article.jpg');
  assert.equal(photoDeLigne({ image_url: '' }, null), null);
});

test('autresFournisseurs : les fournisseurs de l\'article hors celui de la fiche, sans doublon, casse ignorée', () => {
  assert.deepEqual(autresFournisseurs('BAYWA R.E.,ECOSTAL', 'ECOSTAL'), ['BAYWA R.E.']);
  assert.deepEqual(autresFournisseurs(['Ecostal', 'BayWa r.e.', 'BAYWA R.E.'], 'ecostal'), ['BayWa r.e.']);
  assert.deepEqual(autresFournisseurs('ECOSTAL', 'ECOSTAL'), []);
  assert.deepEqual(autresFournisseurs(null, 'ECOSTAL'), []);
});
