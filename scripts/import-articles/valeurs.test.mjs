// Valeurs à interpréter (nature, catégorie, unité) — scripts/import-articles/valeurs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposerValeurs, valeursDistinctes, NATURE_ECARTER } from '../../src/lib/importArticles/valeurs.js';
import { NATURES_ARTICLE, UNITES_ARTICLE } from '../../src/lib/catalogue/natures.js';

test('nature', () => {
  const r = proposerValeurs('nature', ['Fourniture', 'MO', 'Main d\'oeuvre', 'Main-d’œuvre', 'Option', 'Accessoire', 'Stock', 'Ouvrage', 'Truc'], NATURES_ARTICLE);
  assert.equal(r.Fourniture, 'main');
  assert.equal(r.MO, 'main_oeuvre');
  assert.equal(r['Main d\'oeuvre'], 'main_oeuvre');
  assert.equal(r['Main-d’œuvre'], 'main_oeuvre');
  assert.equal(r.Option, 'accessory');
  assert.equal(r.Accessoire, 'accessory');
  assert.equal(r.Stock, 'stock');
  assert.equal(r.Ouvrage, NATURE_ECARTER);
  assert.equal(NATURE_ECARTER, '@ecarter');
  assert.equal(r.Truc, '');
});

test('catégorie', () => {
  const options = [{ value: 'poele', label: 'Poêle' }, { value: 'climatisation', label: 'Climatisation' }];
  const r = proposerValeurs('categorie', ['Poêles', 'POELE', 'poele', 'Clim'], options);
  assert.equal(r['Poêles'], 'poele');
  assert.equal(r.POELE, 'poele');
  assert.equal(r.poele, 'poele');
  assert.equal(r.Clim, '');
});

test('unité', () => {
  const attendu = {
    U: 'pièce', 'Unité': 'pièce', pce: 'pièce', 'Pièce': 'pièce', ML: 'ml', m: 'ml', m2: 'm²', 'M²': 'm²',
    Forfait: 'forfait', Ft: 'forfait', H: 'h', heure: 'h',
  };
  const r = proposerValeurs('unite', Object.keys(attendu), UNITES_ARTICLE);
  for (const [k, v] of Object.entries(attendu)) assert.equal(r[k], v, k);
});

test('valeursDistinctes : triées, sans vide', () => {
  const lignes = [{ valeurs: { unite: 'ml' } }, { valeurs: { unite: 'h' } }, { valeurs: {} }, { valeurs: { unite: 'ml' } }, { valeurs: { unite: ' ' } }];
  assert.deepEqual(valeursDistinctes(lignes, 'unite'), ['h', 'ml']);
});
