/**
 * scripts/fabdis.test.mjs — Tests du parser FAB-DIS
 * ============================================================================
 * node --test scripts/fabdis.test.mjs
 * ============================================================================
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeHeader,
  toNumber,
  toText,
  normalizeGtin,
  buildHeaderMap,
  parseSheet,
  assembleProducts,
  buildAiDescription,
  hashAiDescription,
  SHEET_SPECS,
} from './fabdis/parser.mjs';

// GTIN-13 avec cle de controle correcte (verifies a la main).
const GTIN_PAC = '4006381333931';
const GTIN_VASE = '4012345678901';

// ----------------------------------------------------------------------------
// Normalisation
// ----------------------------------------------------------------------------

test('normalizeHeader neutralise casse, accents et ponctuation', () => {
  assert.equal(normalizeHeader('Prix public HT (€)'), 'prix public ht');
  assert.equal(normalizeHeader('  Référence   Fabricant  '), 'reference fabricant');
  assert.equal(normalizeHeader('GTIN/EAN'), 'gtin ean');
  assert.equal(normalizeHeader(null), '');
});

test('toNumber lit les nombres au format francais', () => {
  assert.equal(toNumber('1 234,56'), 1234.56);
  assert.equal(toNumber('2 890,00 €'), 2890);
  assert.equal(toNumber(1234.5), 1234.5);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('n/a'), null);
});

test('toText renvoie null sur une cellule vide, pas une chaine vide', () => {
  assert.equal(toText('  '), null);
  assert.equal(toText(null), null);
  assert.equal(toText(' ABC '), 'ABC');
});

// ----------------------------------------------------------------------------
// GTIN
// ----------------------------------------------------------------------------

test('normalizeGtin accepte une cle de controle valide et rejette le reste', () => {
  assert.equal(normalizeGtin(GTIN_PAC), GTIN_PAC);
  assert.equal(normalizeGtin(` ${GTIN_PAC} `), GTIN_PAC);

  // Cle de controle fausse
  assert.equal(normalizeGtin('3410000000003'), null);
  // Longueur non normalisee
  assert.equal(normalizeGtin('12345'), null);
  // Reference interne glissee dans la colonne GTIN
  assert.equal(normalizeGtin('REF-ATL-8KW'), null);
  assert.equal(normalizeGtin(null), null);
});

// ----------------------------------------------------------------------------
// Mapping des colonnes
// ----------------------------------------------------------------------------

test('buildHeaderMap relie les alias et remonte les colonnes inconnues', () => {
  const headers = ['Référence fabricant', 'GTIN', 'Désignation', 'Prix public HT', 'Colonne Maison'];
  const { map, unknown, missing } = buildHeaderMap(headers, SHEET_SPECS.B01_COMMERCE);

  assert.equal(map[0], 'manufacturer_ref');
  assert.equal(map[1], 'gtin');
  assert.equal(map[2], 'label');
  assert.equal(map[3], 'public_price_ht');
  assert.deepEqual(unknown, ['Colonne Maison']);
  assert.deepEqual(missing, []);
});

test('parseSheet rejette l onglet en bloc si une colonne requise manque', () => {
  // Pas de colonne de libelle : on ne devine pas, on refuse.
  const rows = [
    ['Référence fabricant', 'Prix public HT'],
    ['ATL-8KW', '2890,00'],
  ];
  const res = parseSheet(rows, SHEET_SPECS.B01_COMMERCE);

  assert.deepEqual(res.records, []);
  assert.deepEqual(res.missingColumns, ['label']);
  assert.equal(res.skipped, 1);
});

test('parseSheet ignore les lignes dont un champ requis est vide', () => {
  const rows = [
    ['Référence fabricant', 'Désignation'],
    ['ATL-8KW', 'PAC air/eau 8 kW'],
    ['', 'Ligne sans reference'],
    ['ATL-11KW', ''],
  ];
  const res = parseSheet(rows, SHEET_SPECS.B01_COMMERCE);

  assert.equal(res.records.length, 1);
  assert.equal(res.skipped, 2);
});

// ----------------------------------------------------------------------------
// Assemblage multi-onglets
// ----------------------------------------------------------------------------

function sampleSheets() {
  return {
    B01_COMMERCE: [
      { manufacturer_ref: 'ATL-ALFEA-8', gtin: GTIN_PAC, brand_code: 'ATLANTIC',
        label: 'Alfea Excellia A.I. 8', description_text: 'Pompe a chaleur air/eau',
        public_price_ht: '7 890,00', unit: 'PCE' },
      { manufacturer_ref: 'ATL-VASE-18', gtin: GTIN_VASE, brand_code: 'ATLANTIC',
        label: 'Vase d expansion 18 L', public_price_ht: '89,90' },
    ],
    B04_MEDIA: [
      { manufacturer_ref: 'ATL-ALFEA-8', media_type: 'Fiche technique',
        url: 'https://example.test/alfea8.pdf', media_label: 'FT Alfea 8' },
      { manufacturer_ref: 'ATL-ALFEA-8', media_type: 'Notice de pose',
        url: 'https://example.test/alfea8-notice.pdf' },
      { manufacturer_ref: 'ATL-ALFEA-8', media_type: 'Certificat CE',
        url: 'https://example.test/alfea8-ce.pdf' },
    ],
    B05_ETIM: [
      { manufacturer_ref: 'ATL-ALFEA-8', etim_class_code: 'EC010912',
        feature_code: 'EF000008', value_numeric: '8', unit_code: 'EU570448' },
      { manufacturer_ref: 'ATL-ALFEA-8', feature_code: 'EF000199', value_numeric: '111' },
    ],
    C02_CORRESPONDANCE: [
      { parent_gtin: GTIN_PAC, child_gtin: GTIN_VASE, relation_type: 'Obligatoire', quantity_required: '1' },
    ],
    C06_SUBSTITUTION: [],
  };
}

test('assembleProducts joint les onglets sur la reference fabricant', () => {
  const { products, relations, warnings } = assembleProducts(sampleSheets());

  assert.equal(products.length, 2);
  const pac = products.find((p) => p.manufacturer_ref === 'ATL-ALFEA-8');

  assert.equal(pac.gtin, GTIN_PAC);
  assert.equal(pac.public_price_ht, 7890);
  assert.equal(pac.technical_pdf_url, 'https://example.test/alfea8.pdf');
  assert.equal(pac.installation_manual_url, 'https://example.test/alfea8-notice.pdf');
  assert.equal(pac.etim_class_code, 'EC010912');
  assert.equal(pac.etim_features.EF000008.value, 8);

  // Le certificat CE n'a pas de colonne dediee : il doit malgre tout etre conserve.
  const allMedia = Object.values(pac.media).flat().map((m) => m.url);
  assert.ok(allMedia.includes('https://example.test/alfea8-ce.pdf'));

  assert.equal(relations.length, 1);
  assert.equal(relations[0].relation_type, 'MANDATORY');
  assert.equal(relations[0].quantity_required, 1);
  assert.deepEqual(warnings, []);
});

test('assembleProducts traduit les codes ETIM quand un resolveur est fourni', () => {
  const dictionnaire = {
    EC010912: { label: 'Pompe a chaleur air/eau' },
    EF000008: { label: 'Puissance calorifique' },
    EU570448: { label: 'kW' },
  };
  const { products } = assembleProducts(sampleSheets(), {
    resolveEtim: (code) => dictionnaire[code] || null,
  });

  const pac = products.find((p) => p.manufacturer_ref === 'ATL-ALFEA-8');
  assert.equal(pac.etim_class_label, 'Pompe a chaleur air/eau');
  assert.equal(pac.etim_features.EF000008.label, 'Puissance calorifique');
  assert.equal(pac.etim_features.EF000008.unit, 'kW');

  // Code absent du dictionnaire : conserve brut, jamais invente.
  assert.equal(pac.etim_features.EF000199.label, null);
});

test('assembleProducts rejette une relation de type inconnu au lieu de la supposer optionnelle', () => {
  const sheets = sampleSheets();
  sheets.C02_CORRESPONDANCE = [
    { parent_gtin: GTIN_PAC, child_gtin: GTIN_VASE, relation_type: 'Truc bizarre' },
  ];
  const { relations, warnings } = assembleProducts(sheets);

  assert.equal(relations.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /type de relation non reconnu/);
});

test('assembleProducts signale un GTIN invalide au lieu de creer un produit fantome', () => {
  const sheets = sampleSheets();
  sheets.B01_COMMERCE[0].gtin = '3410000000003'; // cle de controle fausse
  const { products, warnings } = assembleProducts(sheets);

  const pac = products.find((p) => p.manufacturer_ref === 'ATL-ALFEA-8');
  assert.equal(pac.gtin, null);
  assert.ok(warnings.some((w) => /GTIN invalide/.test(w)));
});

test('assembleProducts transforme C06 en relation SUBSTITUTION', () => {
  const sheets = sampleSheets();
  sheets.C02_CORRESPONDANCE = [];
  sheets.C06_SUBSTITUTION = [{ parent_gtin: GTIN_PAC, child_gtin: GTIN_VASE }];

  const { relations } = assembleProducts(sheets);
  assert.equal(relations.length, 1);
  assert.equal(relations[0].relation_type, 'SUBSTITUTION');
});

// ----------------------------------------------------------------------------
// Texte d'embedding — exigence economique de la section 4
// ----------------------------------------------------------------------------

test('buildAiDescription decrit le produit sans jamais y mettre le prix', () => {
  const { products } = assembleProducts(sampleSheets(), {
    resolveEtim: (code) => ({
      EC010912: { label: 'Pompe a chaleur air/eau' },
      EF000008: { label: 'Puissance calorifique' },
      EU570448: { label: 'kW' },
    })[code] || null,
  });
  const pac = products.find((p) => p.manufacturer_ref === 'ATL-ALFEA-8');
  const text = buildAiDescription(pac);

  assert.match(text, /Alfea Excellia/);
  assert.match(text, /Pompe a chaleur air\/eau/);
  assert.match(text, /Puissance calorifique : 8 kW/);
  assert.doesNotMatch(text, /7890|7 890/);
});

test('un changement de prix seul ne modifie pas l empreinte, donc aucun embedding a regenerer', () => {
  const avant = assembleProducts(sampleSheets()).products
    .find((p) => p.manufacturer_ref === 'ATL-ALFEA-8');

  const sheetsApres = sampleSheets();
  sheetsApres.B01_COMMERCE[0].public_price_ht = '8 450,00';
  const apres = assembleProducts(sheetsApres).products
    .find((p) => p.manufacturer_ref === 'ATL-ALFEA-8');

  assert.notEqual(avant.public_price_ht, apres.public_price_ht);
  assert.equal(
    hashAiDescription(buildAiDescription(avant)),
    hashAiDescription(buildAiDescription(apres)),
  );
});

test('une modification technique change l empreinte, donc declenche un nouvel embedding', () => {
  const avant = assembleProducts(sampleSheets()).products
    .find((p) => p.manufacturer_ref === 'ATL-ALFEA-8');

  const sheetsApres = sampleSheets();
  sheetsApres.B05_ETIM[0].value_numeric = '11';
  const apres = assembleProducts(sheetsApres).products
    .find((p) => p.manufacturer_ref === 'ATL-ALFEA-8');

  assert.notEqual(
    hashAiDescription(buildAiDescription(avant)),
    hashAiDescription(buildAiDescription(apres)),
  );
});
