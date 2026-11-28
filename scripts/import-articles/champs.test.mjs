import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAMPS_ARTICLE, champArticle, cibleArticleDepuisEntete } from '../../src/lib/importArticles/champs.js';
import { cleEntete } from '../../src/lib/importClients/champs.js';

const CLES = ['designation', 'code', 'marque', 'modele', 'ean', 'categorie', 'gamme', 'nature', 'unite', 'tva',
  'prix_vente', 'description', 'fournisseur', 'ref_fournisseur', 'prix_achat', 'prix_public', 'date_prix', 'ancien_numero'];

test('dix-huit champs, clés uniques, dans l\'ordre du fichier type', () => {
  assert.deepEqual(CHAMPS_ARTICLE.map((c) => c.cle), CLES);
  assert.equal(new Set(CLES).size, 18);
});

test('les cinq derniers champs liés au fournisseur sont marqués', () => {
  assert.deepEqual(CHAMPS_ARTICLE.filter((c) => c.fournisseur).map((c) => c.cle),
    ['fournisseur', 'ref_fournisseur', 'prix_achat', 'prix_public', 'date_prix']);
});

test('chaque champ porte un type connu, un exemple et une aide', () => {
  for (const c of CHAMPS_ARTICLE) {
    assert.ok(['texte', 'prix', 'tva', 'ean', 'date', 'valeur'].includes(c.type), c.cle);
    assert.ok(c.libelle && c.exemple && c.aide, c.cle);
  }
});

test('aucun en-tête (libellé ou synonyme) n\'est partagé par deux champs', () => {
  const vus = new Map();
  for (const c of CHAMPS_ARTICLE) {
    for (const s of [c.libelle, ...c.synonymes]) {
      const k = cleEntete(s);
      assert.ok(!vus.has(k) || vus.get(k) === c.cle, `${s} désigne ${vus.get(k)} et ${c.cle}`);
      vus.set(k, c.cle);
    }
  }
});

test('en-têtes reconnus', () => {
  const attendus = {
    'Désignation': 'designation', 'Libellé': 'designation', 'Réf. interne': 'code', 'Code article': 'code',
    'PU HT': 'prix_vente', 'Prix d\'achat': 'prix_achat', 'Gencod': 'ean', 'Réf. fabricant': 'modele',
    'Fournisseur principal': 'fournisseur', 'Réf. fournisseur': 'ref_fournisseur', 'DESIGNATION': 'designation',
  };
  for (const [e, cle] of Object.entries(attendus)) assert.equal(cibleArticleDepuisEntete(e), cle, e);
});

test('en-tête inconnu, ou volontairement sans synonyme', () => {
  for (const e of ['Colonne X', 'Note', 'Remarque', 'Client', '']) assert.equal(cibleArticleDepuisEntete(e), '', e);
});

test('champArticle', () => {
  assert.equal(champArticle('tva').type, 'tva');
  assert.equal(champArticle('inconnu'), null);
});
