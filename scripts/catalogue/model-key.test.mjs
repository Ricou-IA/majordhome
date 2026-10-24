// scripts/catalogue/model-key.test.mjs
// Clé « modèle fabricant » (src/lib/catalogue/modelKey.js) : la clé commune entre fournisseurs, dérivée des libellés.
// Run : node --test scripts/catalogue/model-key.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerModelKey, normaliserModele, jetonsModele } from '../../src/lib/catalogue/modelKey.js';

test('Huawei LUNA2000-7-E1 : même clé depuis un libellé Domos et un libellé BayWa (mpn numérique ignoré)', () => {
  assert.equal(calculerModelKey('HUAWEI', ['HUAWEI – Batterie LUNA2000-7-E1 – Module de batterie 6.9 kWh']), 'LUNA20007E1');
  assert.equal(calculerModelKey('Huawei', ['LUNA2000-7-E1 Battery Module (S1)', '01076608']), 'LUNA20007E1');
  // deux candidats non emboîtés : le premier du libellé (le modèle vient en tête, la certification après)
  assert.equal(calculerModelKey('Huawei', ['LUNA2000-7-E1 Battery Module (S1) - UL9540A', '01076608-007']), 'LUNA20007E1');
});

test('un nom de famille (lettres puis 3-4 chiffres : SUN2000, LUNA2000) ne fait pas de clé', () => {
  assert.equal(calculerModelKey('HUAWEI', ['HUAWEI – Optimiseurs des 600W-P – SUN2000']), null);
  assert.equal(calculerModelKey('Huawei', ['LUNA2000 241kWh 2S1 C&I Storage']), null);
  assert.equal(calculerModelKey('HUAWEI', ['HUAWEI – Batterie LUNA2000 E0 – Module de batterie HT de 5kWh']), null);
});

test('le jeton le plus spécifique gagne : SUN2000 est le préfixe de SUN2000-5K-LB0', () => {
  assert.deepEqual(jetonsModele('HUAWEI – Onduleur – SUN2000-5K-LB0 – Monophasé – 2 MPPT'), ['SUN20005KLB0']);
  assert.equal(calculerModelKey('HUAWEI', ['HUAWEI – Onduleur – SUN2000-5K-LB0 – Monophasé']), 'SUN20005KLB0');
  assert.equal(calculerModelKey('Huawei', ['SUN2000-5K-LB0']), 'SUN20005KLB0');
  assert.equal(calculerModelKey('Huawei', ['Dongle SUN2000 – SDongleB-06-EU 4G']), 'SDONGLEB06EU');
});

test('unités, EAN et codes purement numériques ne sont pas des modèles', () => {
  assert.deepEqual(jetonsModele('ECOFLOW – Batterie 8kWh – 5102000098 – 48V 100Ah 400Wc 13,5kWh 5kW 3000W 230VAC'), []);
  assert.deepEqual(jetonsModele('ECOFLOW – Batterie Ocean 2 – 5kWh – 4895251670951'), []);
  assert.equal(calculerModelKey('ECOFLOW', ['ECOFLOW – Batterie 8kWh – 5102000098']), null);
});

test('Enphase, Hoymiles, Tesla (mpn) : clés attendues, marque retirée des jetons', () => {
  assert.equal(calculerModelKey('ENPHASE', ['ENPHASE – IQController SC100G-M230ROW']), 'SC100GM230ROW');
  assert.equal(calculerModelKey('Enphase', ['IQ System Controller 3 INT', 'SC100G-M230ROW']), 'SC100GM230ROW');
  assert.equal(calculerModelKey('HOYMILES', ['HOYMILES – MICRO ONDULEUR HMS-1000-2T']), 'HMS10002T');
  assert.equal(calculerModelKey('Hoymiles', ['HMS Connection Cable EN40-300']), 'EN40300');
  assert.equal(calculerModelKey('Tesla', ['Tesla Powerwall 3 – batterie 13,5 kWh / 11 kW AC', '1707000-30-L']), '170700030L');
  assert.equal(calculerModelKey('K2', ['K2 SYSTEM – Rail K2 SR20']), null, 'la marque (K2) et un jeton trop court ne font pas de clé');
});

test('normaliserModele : majuscules, sans espaces ni tirets ni points', () => {
  assert.equal(normaliserModele(' luna2000-7-e1 '), 'LUNA20007E1');
  assert.equal(normaliserModele('HMS-1000-2T'), 'HMS10002T');
  assert.equal(normaliserModele('SG6.0RS'), 'SG60RS');
  assert.equal(normaliserModele(''), null);
  assert.equal(normaliserModele(null), null);
});
