// scripts/catalogue/baywa.test.mjs
// Adaptateur BayWa r.e. (src/lib/catalogue/baywa.js) sur le RELEVÉ RÉEL scripts/catalogue/data/baywa-2026-10.json.
// Run : node --test scripts/catalogue/baywa.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  articlesDepuisReleveBaywa, estRetenu, nommer, gammeDe, PRIX_PUBLIC_TESLA_HT, LIBELLES_FR_TESLA,
} from '../../src/lib/catalogue/baywa.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releve = JSON.parse(readFileSync(path.join(racine, 'scripts', 'catalogue', 'data', 'baywa-2026-10.json'), 'utf8'));
const resultat = articlesDepuisReleveBaywa(releve, { version: 'baywa_2026-10' });
const ligne = (ref) => resultat.lignes.find((l) => l.reference === ref);

test('périmètre : 87 articles retenus, 13 kits exclus, aucun kit dans les lignes', () => {
  assert.equal(resultat.retenus, 87);
  assert.equal(resultat.exclus.kits, 13);
  assert.equal(resultat.lignes.length, 87);
  const kits = releve.items.filter((i) => i.itemtype === 'Kit').map((i) => i.itemid);
  assert.ok(resultat.lignes.every((l) => !kits.includes(l.reference)));
  assert.equal(resultat.releve_at, releve.fetched_at);
});

test('Powerwall 3 : achat 4 773,29, vente par défaut 5 500 (prix public Tesla HT), batterie principale', () => {
  const pw = ligne('35-119503');
  assert.equal(pw.purchase_price_ht, 4773.29);
  assert.equal(pw.selling_price_ht_defaut, 5500);
  assert.equal(pw.product_kind, 'main');
  assert.equal(pw.brand, 'Tesla');
  assert.equal(pw.category, 'batterie');
  assert.equal(pw.unit, 'pièce');
  assert.equal(pw.default_tva_rate, 20);
  assert.equal(pw.specs.canonical.mpn, '1707000-30-L');
  assert.equal(pw.specs.canonical.energie_utile_kwh, 13.5);
  assert.equal(pw.specs.source_version, 'baywa_2026-10');
  assert.ok(!/Battery/.test(pw.name), `libellé anglais : ${pw.name}`);
});

test('extension DC et Backup Gateway 2 : prix publics par différence (4 780 / 1 150)', () => {
  assert.equal(ligne('35-120026').purchase_price_ht, 3969.76);
  assert.equal(ligne('35-120026').selling_price_ht_defaut, 4780);
  assert.equal(ligne('36-122569').purchase_price_ht, 835.32);
  assert.equal(ligne('36-122569').selling_price_ht_defaut, 1150);
  assert.equal(ligne('36-117955').purchase_price_ht, 952.97);
  assert.equal(ligne('36-117955').selling_price_ht_defaut, 1150);
});

test('Remote Meter monophasé : accessoire, gamme Compteur, prix de vente à renseigner', () => {
  const rm = ligne('37-122388');
  assert.equal(rm.purchase_price_ht, 103.67);
  assert.equal(rm.selling_price_ht_defaut, 0);
  assert.equal(rm.product_kind, 'accessory');
  assert.equal(rm.gamme, 'Compteur');
});

test('gammes : 19 systèmes en Stockage tertiaire, aucun accessoire à plus de 5 000 €', () => {
  assert.equal(resultat.lignes.filter((l) => l.gamme === 'Stockage tertiaire').length, 19);
  assert.ok(resultat.lignes.every((l) => l.product_kind === 'main' || l.purchase_price_ht < 5000));
});

test('specs : fiche technique absolue, relevé de stock daté', () => {
  const pw = ligne('35-119503');
  assert.ok(pw.specs.canonical.fiche_technique_fr.startsWith('https://solarshop.baywa-re.fr/'));
  assert.deepEqual(Object.keys(pw.specs.canonical.stock_releve), ['qty', 'at']);
  assert.equal(pw.specs.canonical.stock_releve.at, releve.fetched_at);
  // Certaines fiches sont hébergées chez le fabricant (GoodWe…) : absolue dans tous les cas, jamais relative.
  assert.ok(resultat.lignes.every((l) => !l.specs.canonical.fiche_technique_fr || l.specs.canonical.fiche_technique_fr.startsWith('https://')));
});

test('nommer : table FR Tesla d\'abord, puis le libellé qui ressemble à une phrase', () => {
  assert.equal(nommer({ displayname: 'TESLA-REMOTE-METER-TRI-KIT-CABLE-RS485', storedisplayname2: 'Tesla Remote Meter Three Phase Kit', fields: { mpn: '2302439-00-A' } }), LIBELLES_FR_TESLA['2302439']);
  assert.equal(nommer({ displayname: 'Vitre frontale pour Powerwall 3', storedisplayname2: 'Powerwall 3 Front Glass', fields: { mpn: '1763418-11-C' } }), 'Vitre frontale pour Powerwall 3');
  assert.equal(nommer({ displayname: 'HUAWEI-LUNA2000-5-E0', storedisplayname2: 'Huawei LUNA2000-5-E0 Battery Module', fields: {} }), 'Huawei LUNA2000-5-E0 Battery Module');
});

test('estRetenu / gammeDe / prix publics', () => {
  assert.equal(estRetenu({ itemtype: 'Kit', fields: { cseg_itemcategory: 'Battery Storage' }, price: 10000, ispurchasable: true }), false);
  assert.equal(estRetenu({ itemtype: 'InvtPart', fields: { cseg_itemcategory: 'Electrical', custitem_manufacturerfacet: 'Kamase', custitem_itemtitle: 'Box pour onduleur hybride Tesla' }, price: 567.07, ispurchasable: true }), true);
  assert.equal(estRetenu({ itemtype: 'InvtPart', fields: { cseg_itemcategory: 'PV', custitem_manufacturerfacet: 'Aiko' }, price: 80, ispurchasable: true }), false);
  assert.equal(gammeDe({ fields: { custitem_usableenergy: '13,5' } }), 'Batterie');
  assert.equal(gammeDe({ fields: { custitem_usableenergy: '261,0' } }), 'Stockage tertiaire');
  assert.equal(gammeDe({ fields: { custitem_itemtitle: 'Backup Gateway 2' } }), 'Passerelle / Gateway');
  assert.deepEqual(PRIX_PUBLIC_TESLA_HT, { 1707000: 5500, 1152100: 1150, 1807000: 4780 });
});

test('relevé tronqué : refus (sinon tout le catalogue serait désactivé)', () => {
  assert.throws(() => articlesDepuisReleveBaywa({ total: 995, items: releve.items.slice(0, 10) }, { version: 'x' }), /releve_incomplet/);
});
