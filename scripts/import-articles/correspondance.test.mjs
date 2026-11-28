// Correspondance des colonnes d'un fichier d'articles — scripts/import-articles/correspondance.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  proposerCorrespondanceArticles, validerCorrespondanceArticles, appliquerCorrespondanceArticles,
} from '../../src/lib/importArticles/correspondance.js';

const ENTETES = ['Désignation', 'Réf', 'PU HT', 'Fournisseur', 'Réf. fournisseur', 'Prix d\'achat', 'Bidule'];

test('proposition par en-têtes et synonymes', () => {
  const c = proposerCorrespondanceArticles(ENTETES);
  assert.deepEqual(c.map((x) => x.cible), ['designation', 'code', 'prix_vente', 'fournisseur', 'ref_fournisseur', 'prix_achat', '']);
  assert.equal(c[0].index, 0);
  assert.equal(c[0].entete, 'Désignation');
});

test('avecFournisseur : fournisseur + référence + prix d\'achat', () => {
  assert.equal(validerCorrespondanceArticles(proposerCorrespondanceArticles(ENTETES)).avecFournisseur, true);
  const sans = proposerCorrespondanceArticles(ENTETES.filter((e) => e !== 'Prix d\'achat'));
  assert.equal(validerCorrespondanceArticles(sans).avecFournisseur, false);
});

test('colonne non reconnue comptée à choisir', () => {
  assert.equal(validerCorrespondanceArticles(proposerCorrespondanceArticles(ENTETES)).aChoisir, 1);
});

test('deux colonnes Désignation : la seconde est à choisir, et deux choix identiques donnent une erreur', () => {
  const c = proposerCorrespondanceArticles(['Désignation', 'Désignation']);
  assert.equal(c[0].cible, 'designation');
  assert.equal(c[1].cible, '');
  const v = validerCorrespondanceArticles(c.map((x) => ({ ...x, cible: 'designation' })));
  assert.equal(v.erreurs.length, 1);
});

test('désignation absente : erreur', () => {
  const v = validerCorrespondanceArticles(proposerCorrespondanceArticles(['Marque']));
  assert.deepEqual(v.erreurs, ['Indiquez la colonne de la désignation.']);
});

test('appliquer : cellules non vides seulement, la première l\'emporte', () => {
  const c = [
    { index: 0, entete: 'A', cible: 'designation', origine: 'main' },
    { index: 1, entete: 'B', cible: 'designation', origine: 'main' },
    { index: 2, entete: 'C', cible: 'marque', origine: 'main' },
    { index: 3, entete: 'D', cible: '@ignorer', origine: '' },
  ];
  const r = appliquerCorrespondanceArticles({ numero: 7, cellules: ['', ' Poêle ', '', 'x'] }, c);
  assert.deepEqual(r, { numero: 7, valeurs: { designation: 'Poêle' } });
  const r2 = appliquerCorrespondanceArticles({ numero: 8, cellules: ['Un', 'Deux', 'Invicta', 'x'] }, c);
  assert.deepEqual(r2.valeurs, { designation: 'Un', marque: 'Invicta' });
});
