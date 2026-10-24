// scripts/catalogue/mapping.test.mjs
// Correspondance « catégorie du site → catégorie Majord'home » (src/lib/catalogue/mapping.js).
// Run : node --test scripts/catalogue/mapping.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorieMajordhome, DEFAUTS_MAPPING, CLE_SANS_CATEGORIE, CIBLES } from '../../src/lib/catalogue/mapping.js';

test('cibles et clé « sans catégorie »', () => {
  assert.deepEqual([...CIBLES], ['batterie', 'photovoltaique', 'borne_recharge', 'exclure']);
  assert.equal(CLE_SANS_CATEGORIE, '(sans categorie)');
});

test('SuiteCommerce par défaut : Battery Storage → batterie, E-Mobility → borne_recharge, le reste → photovoltaique', () => {
  const d = DEFAUTS_MAPPING.suitecommerce;
  assert.equal(categorieMajordhome(['Battery Storage'], {}, d), 'batterie');
  assert.equal(categorieMajordhome(['E-Mobility'], {}, d), 'borne_recharge');
  for (const c of ['PV', 'Inverters', 'Inverter Accessories', 'Mounting Systems', 'Electrical', 'Diverse']) {
    assert.equal(categorieMajordhome([c], {}, d), 'photovoltaique', c);
  }
  assert.equal(categorieMajordhome([], {}, d), 'photovoltaique', 'sans catégorie ⇒ photovoltaique par défaut');
});

test('WooCommerce par défaut : slugs stockage → batterie, borne-de-recharge → borne_recharge, racines solaires → photovoltaique', () => {
  const d = DEFAUTS_MAPPING.woocommerce;
  for (const s of ['systeme-de-stockage', 'batteries-ac', 'batteries-dc', 'accessoires-systeme-de-stockage', 'kits-de-stockage', 'kit-batterie']) {
    assert.equal(categorieMajordhome([s], {}, d), 'batterie', s);
  }
  assert.equal(categorieMajordhome(['borne-de-recharge', 'accessoires'], {}, d), 'borne_recharge');
  for (const s of ['panneaux-solaires', 'onduleurs-micro-onduleurs', 'onduleur-central', 'systemes-de-fixation', 'coffrets-de-protection', 'accessoires', 'site-isole-ess', 'destockage', 'non-classe']) {
    assert.equal(categorieMajordhome([s], {}, d), 'photovoltaique', s);
  }
  assert.equal(categorieMajordhome([], {}, d), 'photovoltaique');
});

test('précédence : exclure > batterie > borne_recharge > photovoltaique quand un article porte plusieurs catégories', () => {
  const d = DEFAUTS_MAPPING.woocommerce;
  assert.equal(categorieMajordhome(['batteries-dc', 'destockage'], {}, d), 'batterie');
  assert.equal(categorieMajordhome(['batteries-dc', 'destockage'], { destockage: 'exclure' }, d), null);
  assert.equal(categorieMajordhome(['monitoring', 'site-isole-ess'], {}, d), 'photovoltaique');
  assert.equal(categorieMajordhome(['borne-de-recharge', 'batteries-dc'], {}, d), 'batterie');
});

test('surcharge du mapping : exclure une catégorie du site, reclasser une autre', () => {
  const d = DEFAUTS_MAPPING.suitecommerce;
  assert.equal(categorieMajordhome(['E-Mobility'], { 'E-Mobility': 'exclure' }, d), null);
  assert.equal(categorieMajordhome(['Electrical'], { Electrical: 'batterie' }, d), 'batterie');
  assert.equal(categorieMajordhome([], { '(sans categorie)': 'exclure' }, d), null);
  assert.equal(categorieMajordhome(['Inconnue'], { Inconnue: 'nimportequoi' }, d), 'photovoltaique', 'cible invalide ⇒ défaut');
});
