// scripts/devis-config.test.mjs
// Défauts du paramétrage des devis (src/lib/devisConfig.js) : famille « Batterie » et catégorie `batterie`.
// Run : node --test scripts/devis-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES_PRODUIT, DEFAULT_FAMILLES, buildDevisConfig, categoriesPourSection } from '../src/lib/devisConfig.js';

test('les catégories photovoltaique et borne_recharge font partie des catégories produit du picker', () => {
  assert.ok(CATEGORIES_PRODUIT.includes('photovoltaique'));
  assert.ok(CATEGORIES_PRODUIT.includes('borne_recharge'), 'catégorie posée par le fournisseur ECOSTAL (autre session, 2026-10-24)');
});

test('famille Photovoltaïque par défaut : deux catégories (photovoltaique + batterie), cinq chapitres, après Batterie', () => {
  const i = DEFAULT_FAMILLES.findIndex((f) => f.key === 'photovoltaique');
  assert.ok(i >= 0, 'famille photovoltaique absente');
  const f = DEFAULT_FAMILLES[i];
  assert.equal(f.label, 'Photovoltaïque');
  assert.deepEqual([...f.categories], ['photovoltaique', 'batterie']);
  assert.deepEqual([...f.sections], ['PANNEAUX', 'ONDULEUR ET MONITORING', 'FIXATION', 'COFFRETS ET CÂBLAGE', 'MAIN D\'ŒUVRE']);
  assert.equal(DEFAULT_FAMILLES[i - 1].key, 'batterie');
  assert.deepEqual([...DEFAULT_FAMILLES[i - 1].categories], ['batterie', 'photovoltaique']);
});

test('rétro-compatibilité : une famille enregistrée avec `categorie` (texte) ressort en `categories` (tableau)', () => {
  const config = buildDevisConfig({ devis: { familles: [{ key: 'p', label: 'P', actif: true, categorie: 'poele', sections: ['A'] }] } });
  assert.deepEqual(config.familles[0].categories, ['poele']);
  assert.equal('categorie' in config.familles[0], false);
  const libre = buildDevisConfig({ devis: { familles: [{ key: 'x', label: 'X', actif: true, categorie: null, sections: ['A'] }] } });
  assert.deepEqual(libre.familles[0].categories, []);
  const inconnue = buildDevisConfig({ devis: { familles: [{ key: 'y', label: 'Y', actif: true, categories: ['poele', 'inconnue'], sections: ['A'] }] } });
  assert.deepEqual(inconnue.familles[0].categories, ['poele']);
});

test('categoriesPourSection : les catégories de la famille, ou celle du nom de section, ou aucune (tous)', () => {
  const config = buildDevisConfig({});
  assert.deepEqual(categoriesPourSection(config, 'PANNEAUX', 'photovoltaique'), ['photovoltaique', 'batterie']);
  assert.deepEqual(categoriesPourSection(config, 'FUMISTERIE', 'poele_granules'), ['fumisterie']);
  assert.deepEqual(categoriesPourSection(config, 'MAIN D\'ŒUVRE', 'autre'), []);
});

test('la catégorie batterie fait partie des catégories produit du picker', () => {
  assert.ok(CATEGORIES_PRODUIT.includes('batterie'));
});

test('la famille Batterie par défaut : catégorie batterie, trois chapitres, juste après Chauffage/PAC', () => {
  const i = DEFAULT_FAMILLES.findIndex((f) => f.key === 'batterie');
  assert.ok(i >= 0, 'famille batterie absente');
  const f = DEFAULT_FAMILLES[i];
  assert.equal(f.label, 'Batterie');
  assert.equal(f.categories[0], 'batterie');
  assert.equal(f.actif, true);
  assert.deepEqual([...f.sections], ['ÉQUIPEMENT', 'MATÉRIEL', 'MAIN D\'ŒUVRE']);
  assert.equal(DEFAULT_FAMILLES[i - 1].key, 'chauffage_pac');
});

test('une org sans réglage reçoit la famille Batterie', () => {
  const config = buildDevisConfig({});
  assert.ok(config.familles.some((f) => f.key === 'batterie'));
});

test('une liste de familles enregistrée prime : la famille Batterie ne s\'y ajoute pas toute seule', () => {
  const config = buildDevisConfig({ devis: { familles: [{ key: 'x', label: 'X', actif: true, categorie: null, sections: ['A'] }] } });
  assert.deepEqual(config.familles.map((f) => f.key), ['x']);
});
