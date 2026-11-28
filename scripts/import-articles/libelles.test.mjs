// Tests de libelles.js (import des articles).
import test from 'node:test';
import assert from 'node:assert/strict';
import { phraseBilanArticles, texteRetraitArticles, texteCorrectionsArticles, texteDateDuPrix } from '../../src/lib/importArticles/libelles.js';

test('bilan en une phrase', () => {
  assert.equal(phraseBilanArticles({ lues: 10, importees: 7, doublons: 2, ecartees: 1, lignesFournisseur: 4 }),
    '10 lignes lues = 7 à importer + 2 doublons écartés + 1 écartée');
  assert.equal(phraseBilanArticles({ lues: 1, importees: 1, doublons: 0, ecartees: 0 }),
    '1 ligne lue = 1 à importer + 0 doublon écarté + 0 écartée');
});

test('date du prix', () => {
  assert.equal(texteDateDuPrix(12), "12 prix d'achat sans date : ils seront affichés « date inconnue » et remplacés au premier relevé de leur fournisseur.");
  assert.match(texteDateDuPrix(1), /^1 prix d'achat sans date : il sera/);
  assert.equal(texteDateDuPrix(0), null);
});

test('corrections', () => {
  assert.equal(texteCorrectionsArticles([]), null);
  const t = texteCorrectionsArticles([{ cle: 'tva', nombre: 3 }, { cle: 'prix_vente', nombre: 1 }]);
  assert.match(t, /3 × Taux de TVA/);
  assert.match(t, /1 × Prix de vente HT/);
});

test('retrait', () => {
  assert.equal(texteRetraitArticles({ retirables: 5, conservees: 0 }), '5 articles seront retirés.');
  assert.match(texteRetraitArticles({ retirables: 1, conservees: 2 }), /1 article sera retiré\. 2 seront conservés/);
  assert.match(texteRetraitArticles({ retirables: 0, conservees: 3 }), /Aucun article ne peut être retiré/);
  assert.match(texteRetraitArticles({ retirables: 0, conservees: 0 }), /aucun article/i);
});
