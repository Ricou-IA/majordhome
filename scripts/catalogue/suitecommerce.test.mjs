// scripts/catalogue/suitecommerce.test.mjs
// Adaptateur NetSuite SuiteCommerce (src/lib/catalogue/suitecommerce.js — BayWa r.e.) sur le RELEVÉ RÉEL
// scripts/catalogue/data/baywa-2026-10.json. Périmètre complet depuis la tranche 2 : stockage → batterie, le
// reste → photovoltaique, kits exclus, correspondance des catégories surchargeable.
// Run : node --test scripts/catalogue/suitecommerce.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  articlesDepuisReleveSuitecommerce, nommer, gammeDe, PRIX_PUBLIC_TESLA_HT, LIBELLES_FR_TESLA,
} from '../../src/lib/catalogue/suitecommerce.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releve = JSON.parse(readFileSync(path.join(racine, 'scripts', 'catalogue', 'data', 'baywa-2026-10.json'), 'utf8'));
const resultat = articlesDepuisReleveSuitecommerce(releve, { version: 'baywa_2026-10' });
const ligne = (ref) => resultat.lignes.find((l) => l.reference === ref);

test('périmètre complet : 919 articles retenus, 74 kits exclus, aucun kit dans les lignes', () => {
  assert.equal(resultat.retenus, 919);
  assert.equal(resultat.exclus.kits, 74);
  assert.equal(resultat.exclus.par_mapping, 0);
  assert.equal(resultat.lignes.length, 919);
  const kits = new Set(releve.items.filter((i) => i.itemtype === 'Kit').map((i) => i.itemid));
  assert.ok(resultat.lignes.every((l) => !kits.has(l.reference)));
  assert.equal(resultat.releve_at, releve.fetched_at);
});

test('stockage → batterie (87, comme en tranche 1), bornes → borne_recharge (82), le reste → photovoltaique', () => {
  const batterie = resultat.lignes.filter((l) => l.category === 'batterie');
  assert.equal(batterie.length, 87);
  assert.equal(resultat.lignes.filter((l) => l.category === 'borne_recharge').length, 82);
  assert.equal(resultat.lignes.filter((l) => l.category === 'photovoltaique').length, 919 - 87 - 82);
  assert.equal(ligne('35-013439').category, 'batterie', 'BYD Premium HVM');
  assert.equal(ligne('37-122388').category, 'batterie', 'Remote Meter Tesla rangé en Inverter Accessories chez BayWa');
  assert.equal(ligne('37-122388').gamme, 'Compteur');
});

test('Powerwall 3 : inchangée (achat 4 773,29, vente 5 500, batterie principale, libellé FR)', () => {
  const pw = ligne('35-119503');
  assert.equal(pw.purchase_price_ht, 4773.29);
  assert.equal(pw.selling_price_ht_defaut, 5500);
  assert.equal(pw.product_kind, 'main');
  assert.equal(pw.category, 'batterie');
  assert.equal(pw.gamme, 'Batterie');
  assert.equal(pw.specs.canonical.mpn, '1707000-30-L');
  assert.equal(pw.model_key, '170700030L');
  assert.ok(!/Battery/.test(pw.name));
  assert.equal(ligne('35-120026').selling_price_ht_defaut, 4780);
  assert.equal(ligne('36-122569').selling_price_ht_defaut, 1150);
});

test('module PV : photovoltaique, gamme Modules PV, principal, puissance en Wc', () => {
  const m = ligne('31-122497');
  assert.equal(m.category, 'photovoltaique');
  assert.equal(m.gamme, 'Modules PV');
  assert.equal(m.product_kind, 'main');
  assert.equal(m.specs.canonical.puissance_wc, 510);
  assert.equal(m.selling_price_ht_defaut, 0);
  assert.equal(m.brand, 'Trina Solar');
});

test('onduleur et borne : gammes FR, onduleur principal', () => {
  assert.equal(ligne('32-122560').gamme, 'Onduleurs');
  assert.equal(ligne('32-122560').product_kind, 'main');
  assert.equal(ligne('32-122546').gamme, 'Bornes de recharge');
  assert.equal(ligne('32-122546').category, 'borne_recharge');
  assert.equal(ligne('32-122546').product_kind, 'main');
  assert.equal(resultat.lignes.filter((l) => l.gamme === 'Bornes de recharge').length, 82);
});

test('categories_vues : une entrée par famille du site avec son nombre d\'articles', () => {
  const pv = resultat.categories_vues.find((c) => c.cle === 'PV');
  assert.deepEqual(pv, { cle: 'PV', libelle: 'PV', parent: null, nombre: 60 });
  assert.ok(resultat.categories_vues.find((c) => c.cle === 'Battery Storage').nombre >= 80);
});

test('surcharge du mapping : E-Mobility exclu ⇒ 0 borne, 82 exclus par mapping', () => {
  const r = articlesDepuisReleveSuitecommerce(releve, { version: 'v', mapping: { 'E-Mobility': 'exclure' } });
  assert.equal(r.exclus.par_mapping, 82);
  assert.equal(r.lignes.filter((l) => l.gamme === 'Bornes de recharge').length, 0);
  assert.equal(r.retenus, 919 - 82);
});

test('photo : absente du relevé de ce matin, posée depuis itemimages_detail quand présent', () => {
  assert.equal(ligne('35-119503').image_url, null);
  const item = { ...releve.items.find((i) => i.itemid === '35-119503'), itemimages_detail: { urls: [{ url: 'https://solarshop.baywa-re.fr/img/pw3.jpg' }] }, urlcomponent: 'tesla-powerwall-3' };
  const r = articlesDepuisReleveSuitecommerce({ total: 1, items: [item], fetched_at: releve.fetched_at }, { version: 'v' });
  assert.equal(r.lignes[0].image_url, 'https://solarshop.baywa-re.fr/img/pw3.jpg');
  assert.equal(r.lignes[0].image_source_url, 'https://solarshop.baywa-re.fr/tesla-powerwall-3');
});

test('specs : fiche technique absolue, stock daté, catégories du site conservées', () => {
  const pw = ligne('35-119503');
  assert.ok(pw.specs.canonical.fiche_technique_fr.startsWith('https://solarshop.baywa-re.fr/'));
  assert.deepEqual(Object.keys(pw.specs.canonical.stock_releve), ['qty', 'at']);
  assert.deepEqual(pw.specs.canonical.categories_site, ['Battery Storage']);
  assert.ok(resultat.lignes.every((l) => !l.specs.canonical.fiche_technique_fr || l.specs.canonical.fiche_technique_fr.startsWith('https://')));
});

test('nommer / gammeDe / prix publics : inchangés', () => {
  assert.equal(nommer({ displayname: 'TESLA-REMOTE-METER-TRI-KIT-CABLE-RS485', storedisplayname2: 'Tesla Remote Meter Three Phase Kit', fields: { mpn: '2302439-00-A' } }), LIBELLES_FR_TESLA['2302439']);
  assert.equal(nommer({ displayname: 'Vitre frontale pour Powerwall 3', storedisplayname2: 'Powerwall 3 Front Glass', fields: { mpn: '1763418-11-C' } }), 'Vitre frontale pour Powerwall 3');
  assert.equal(gammeDe({ fields: { cseg_itemcategory: 'Battery Storage', custitem_usableenergy: '261,0' } }), 'Stockage tertiaire');
  assert.equal(gammeDe({ fields: { cseg_itemcategory: 'Battery Storage', custitem_itemtitle: 'Backup Gateway 2' } }), 'Passerelle / Gateway');
  assert.equal(gammeDe({ fields: { cseg_itemcategory: 'Mounting Systems' } }), 'Fixation');
  assert.deepEqual(PRIX_PUBLIC_TESLA_HT, { 1707000: 5500, 1152100: 1150, 1807000: 4780 });
});

test('relevé tronqué : refus', () => {
  assert.throws(() => articlesDepuisReleveSuitecommerce({ total: 995, items: releve.items.slice(0, 10) }, { version: 'x' }), /releve_incomplet/);
});
