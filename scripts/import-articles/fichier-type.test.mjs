// Tests de fichierType.js (import des articles).
import test from 'node:test';
import assert from 'node:assert/strict';
import { feuillesFichierTypeArticles, feuilleLignesEcarteesArticles } from '../../src/lib/importArticles/fichierType.js';
import { CHAMPS_ARTICLE } from '../../src/lib/importArticles/champs.js';
import { proposerCorrespondanceArticles, validerCorrespondanceArticles } from '../../src/lib/importArticles/correspondance.js';
import { classerArticles } from '../../src/lib/importArticles/controles.js';

test('feuille Articles : 18 libellés puis un exemple, relue sans rien à choisir', () => {
  const [articles, aide] = feuillesFichierTypeArticles();
  assert.equal(articles.nom, 'Articles');
  assert.equal(articles.lignes.length, 2);
  assert.deepEqual(articles.lignes[0], CHAMPS_ARTICLE.map((c) => c.libelle));
  assert.equal(articles.lignes[0].length, 18);
  assert.deepEqual(articles.lignes[1], CHAMPS_ARTICLE.map((c) => c.exemple));
  const prop = proposerCorrespondanceArticles(articles.lignes[0]);
  assert.deepEqual(prop.map((c) => c.cible), CHAMPS_ARTICLE.map((c) => c.cle));
  assert.ok(prop.every((c) => c.origine === 'fichier_type'));
  assert.equal(validerCorrespondanceArticles(prop).erreurs.length, 0);
  assert.equal(aide.nom, 'Aide');
  assert.deepEqual(aide.lignes[0], ['Colonne', 'À quoi elle sert', 'Exemple']);
  assert.equal(aide.lignes.length, 19);
});

test("lignes écartées : colonnes d'origine puis Raison, seulement ce qui n'est pas importé", () => {
  const entetes = ['Désignation', 'Réf'];
  const classees = classerArticles([
    { numero: 2, valeurs: { designation: 'A', code: 'X' } },
    { numero: 3, valeurs: { designation: '', code: 'Y' } },
    { numero: 4, valeurs: { designation: 'B', code: 'x' } },
  ], { articles: [], lignes: [] });
  const lignesFichier = [{ numero: 2, cellules: ['A', 'X'] }, { numero: 3, cellules: ['', 'Y'] }, { numero: 4, cellules: ['B', 'x'] }];
  const f = feuilleLignesEcarteesArticles(entetes, lignesFichier, classees, {});
  assert.equal(f.nom, 'Lignes écartées');
  assert.deepEqual(f.lignes[0], ['Désignation', 'Réf', 'Raison']);
  assert.equal(f.lignes.length, 3);
  assert.match(f.lignes[1][2], /désignation/i);
  assert.match(f.lignes[2][2], /référence interne/i);
});
