// scripts/devis-config.test.mjs
// Défauts du paramétrage des devis (src/lib/devisConfig.js) : famille « Batterie » et catégorie `batterie`.
// Run : node --test scripts/devis-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES_PRODUIT, DEFAULT_FAMILLES, buildDevisConfig } from '../src/lib/devisConfig.js';

test('la catégorie batterie fait partie des catégories produit du picker', () => {
  assert.ok(CATEGORIES_PRODUIT.includes('batterie'));
});

test('la famille Batterie par défaut : catégorie batterie, trois chapitres, juste après Chauffage/PAC', () => {
  const i = DEFAULT_FAMILLES.findIndex((f) => f.key === 'batterie');
  assert.ok(i >= 0, 'famille batterie absente');
  const f = DEFAULT_FAMILLES[i];
  assert.equal(f.label, 'Batterie');
  assert.equal(f.categorie, 'batterie');
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
