// Photo et documents d'une page produit de fabricant (src/lib/catalogue/ressourcesPage.js) — module PUR, copié pour
// l'edge equipment-model-enrich. Run : node --test scripts/catalogue/ressources-page.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extraireRessourcesPage } from '../../src/lib/catalogue/ressourcesPage.js';

const PAGE_JOLLY = 'https://jolly-mec.it/fr/produit/bridge-6-kw/12/';
const HTML_JOLLY = readFileSync(new URL('./data/pages/jolly-mec-bridge-6kw.html', import.meta.url), 'utf8');

test('page Jolly Mec réelle : photo produit (champ caché) avant la photo d\'ambiance, icônes écartées', () => {
  const r = extraireRessourcesPage(HTML_JOLLY, PAGE_JOLLY);
  assert.equal(r.photos[0], 'https://jolly-mec.it/backend/contents/images/products/BRIDG_prod_A_03_00_00_ip.jpg');
  assert.ok(r.photos.includes('https://jolly-mec.it/backend/contents/images/products/BRIDG_amb_01.jpg'));
  assert.ok(!r.photos.some((u) => /favicon|apple-touch|icon-|\.svg|colore-/.test(u)), r.photos.join(' '));
  assert.equal(r.photos.length, 2);
});

test('page Jolly Mec réelle : manuel et fiche produit derrière des boutons de script, réglementaires écartés', () => {
  const r = extraireRessourcesPage(HTML_JOLLY, PAGE_JOLLY);
  assert.deepEqual(r.notice, { url: 'https://jolly-mec.it/frontend/products/download/3030/', label: 'Manuel' });
  assert.deepEqual(r.fiche, { url: 'https://jolly-mec.it/frontend/products/download/3029/', label: 'Fiche produit' });
});

test('og:image en premier, liens .pdf classiques, adresses relatives résolues', () => {
  const html = `<meta property="og:image" content="https://cdn.ex.fr/p/poele.webp">
    <img src="/img/logo.png"><img data-src="/img/poele-face.jpg">
    <a href="/docs/notice-installation.pdf">Notice d'installation et d'utilisation</a>
    <a href="docs/fiche-technique.pdf">Fiche technique</a>
    <a href="/docs/declaration-performance.pdf">Déclaration de performance</a>`;
  const r = extraireRessourcesPage(html, 'https://www.ex.fr/produits/poele/');
  assert.deepEqual(r.photos, ['https://cdn.ex.fr/p/poele.webp', 'https://www.ex.fr/img/poele-face.jpg']);
  assert.equal(r.notice.url, 'https://www.ex.fr/docs/notice-installation.pdf');
  assert.equal(r.fiche.url, 'https://www.ex.fr/produits/poele/docs/fiche-technique.pdf');
});

test('rien d\'exploitable : listes vides, jamais d\'exception', () => {
  assert.deepEqual(extraireRessourcesPage('', 'https://ex.fr/'), { photos: [], notice: null, fiche: null });
  assert.deepEqual(extraireRessourcesPage('<a href="javascript:void(0)">x</a>', 'pas une url'), { photos: [], notice: null, fiche: null });
});
