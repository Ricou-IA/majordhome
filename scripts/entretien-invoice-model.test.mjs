// scripts/entretien-invoice-model.test.mjs — facture d'entretien (src/lib/entretienInvoiceModel.js)
// et calcul tarifaire du contrat (src/lib/contractPricing.js).
// node --test scripts/entretien-invoice-model.test.mjs
//
// Ce que la facture Pennylane d'un entretien DOIT reproduire (Eric, 2026-09-21) :
// 1 ligne par équipement au prix grille, la remise appliquée (dégressivité, remise
// commerciale), le total = montant contractuel figé, la TVA de la catégorie, les
// pièces non offertes sur la même facture sans remise, l'objet « Entretien de votre
// poêle à bois : Marque · Modèle · N° série ». Cas de référence : DALOUS, facture
// F-2026-09372 saisie à la main le 2026-09-21 (90 € TTC, 81,82 HT, TVA 10 %).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntretienInvoice, toPennylaneInvoicePayload } from '../src/lib/entretienInvoiceModel.js';
import { computeContractLines, calculateContractTotal } from '../src/lib/contractPricing.js';

const ZONE = { id: 'z1', name: 'Zone 1', supplement: 0 };
const CAT_POELE = { id: 'cat-poele', code: 'poele_bois', label: 'Poêle à bois', default_vat_rate: 10 };
const CAT_PAC = { id: 'cat-pac', code: 'pac', label: 'PAC Air/Air', default_vat_rate: 20 };
const CAT_SANS_TVA = { id: 'cat-x', code: 'x', label: 'Divers', default_vat_rate: null };
const TYPE_POELE = { id: 'type-poele', label: 'Entretien et ramonage de conduit poêle à bois', category_id: 'cat-poele' };
const TYPE_PAC = { id: 'type-pac', label: 'Entretien PAC Air/Air', category_id: 'cat-pac', has_unit_pricing: true, included_units: 1, unit_label: 'split' };
const TYPE_X = { id: 'type-x', label: 'Type sans TVA', category_id: 'cat-x' };
const TYPES = [TYPE_POELE, TYPE_PAC, TYPE_X];
const RATES = [
  { zone_id: 'z1', equipment_type_id: 'type-poele', price: 90 },
  { zone_id: 'z1', equipment_type_id: 'type-pac', price: 160, unit_price: 50 },
  { zone_id: 'z1', equipment_type_id: 'type-x', price: 100 },
];
const DISCOUNTS = [{ min_equipments: 2, discount_percent: 10, is_active: true }];

const referentiel = {
  typesById: new Map(TYPES.map((t) => [t.id, t])),
  categoriesById: new Map([CAT_POELE, CAT_PAC, CAT_SANS_TVA].map((c) => [c.id, c])),
};

const EQ_POELE = { id: 'eq-1', brand: 'Jollymec', model: 'Quadro+s/80', serial_number: '0160067', equipment_type_id: 'type-poele' };
const EQ_PAC = { id: 'eq-2', brand: 'Toshiba', model: 'Ras-16e2avg-e', serial_number: '32301304', equipment_type_id: 'type-pac', unit_count: 1 };

function pricingFor(equipments, { overrides = {}, discounts = DISCOUNTS, zone = ZONE } = {}) {
  return computeContractLines({ equipments, rates: RATES, equipmentTypes: TYPES, zone, overrides, discounts });
}

const dalous = (over = {}) => ({
  intervention: { id: 'iv-1' },
  contract: { id: 'ct-1', contract_number: 'CTR-00593', amount: 90 },
  pricing: pricingFor([EQ_POELE]),
  parts: [],
  referentiel,
  deadlineDays: 30,
  today: '2026-09-21',
  ...over,
});

// ---------------------------------------------------------------------------
// computeContractLines (calcul du contrat signé)
// ---------------------------------------------------------------------------

test('computeContractLines : prix grille par équipement, dégressivité à partir de 2 équipements', () => {
  const p = pricingFor([EQ_POELE, EQ_PAC]);
  assert.deepEqual(p.items.map((i) => [i.label, i.lineTotal]), [
    ['Entretien et ramonage de conduit poêle à bois', 90],
    ['Entretien PAC Air/Air', 160],
  ]);
  assert.equal(p.subtotal, 250);
  assert.equal(p.discountPercent, 10);
  assert.equal(p.discountAmount, 25);
  assert.equal(p.total, 225);
});

test('computeContractLines : prix forcé par ligne, splits supplémentaires, supplément de zone, type sans tarif', () => {
  const p = pricingFor(
    [{ ...EQ_PAC, unit_count: 3 }, { ...EQ_POELE, id: 'eq-3' }, { id: 'eq-4', equipment_type_id: 'type-inconnu', brand: 'X' }],
    { overrides: { 'eq-3': 75 }, discounts: [], zone: { ...ZONE, supplement: 10 } },
  );
  assert.deepEqual(p.items.map((i) => i.lineTotal), [160 + 2 * 50 + 10, 75, 0]);
  assert.equal(p.items[0].reference, 'Toshiba · Ras-16e2avg-e · 3 splits');
  assert.equal(calculateContractTotal(p.items, []).total, 345);
});

// ---------------------------------------------------------------------------
// buildEntretienInvoice
// ---------------------------------------------------------------------------

const LEDGERS = { byCategory: { 'cat-poele': 7061, 'cat-pac': 7062 }, parts: 7070 };

test('comptes comptables : par catégorie d’équipement + pièces, transmis à Pennylane ; absent → avertissement une fois par catégorie', () => {
  const avec = buildEntretienInvoice(dalous({
    contract: { contract_number: 'CTR-1', amount: 225 },
    pricing: pricingFor([EQ_POELE, EQ_PAC]),
    parts: [{ designation: 'Joint', quantite: 1, prix_ht: 11 }],
    ledgerAccounts: LEDGERS,
  }));
  assert.deepEqual(avec.lines.map((l) => l.ledgerAccountId), [7061, 7062, 7070]);
  assert.equal(avec.warnings.filter((w) => w.code === 'compte_manquant').length, 0);
  const payload = toPennylaneInvoicePayload(avec, { customerId: 1, draft: true, externalReference: 'iv-1' });
  assert.deepEqual(payload.invoice_lines.map((l) => l.ledger_account_id), [7061, 7062, 7070]);

  const sans = buildEntretienInvoice(dalous({
    contract: { contract_number: 'CTR-1', amount: 225 },
    pricing: pricingFor([EQ_POELE, { ...EQ_POELE, id: 'eq-1b' }, EQ_PAC]),
    parts: [{ designation: 'Joint', quantite: 1, prix_ht: 11 }],
    ledgerAccounts: { byCategory: { 'cat-pac': 7062 } },
  }));
  assert.deepEqual(sans.lines.map((l) => l.ledgerAccountId), [null, null, 7062, null]);
  // poêle (1 fois pour 2 lignes) + pièces = 2 avertissements
  assert.equal(sans.warnings.filter((w) => w.code === 'compte_manquant').length, 2);
  assert.deepEqual(sans.errors, []);
  const p2 = toPennylaneInvoicePayload(sans, { customerId: 1, draft: true, externalReference: 'iv-1' });
  assert.equal('ledger_account_id' in p2.invoice_lines[0], false);
});

test('DALOUS : une ligne au prix grille = montant contractuel, TVA 10 %, HT dérivé du TTC, échéance à 30 jours', () => {
  const m = buildEntretienInvoice(dalous({ ledgerAccounts: LEDGERS }));
  assert.deepEqual(m.errors, []);
  assert.deepEqual(m.warnings, []);
  assert.equal(m.date, '2026-09-21');
  assert.equal(m.deadline, '2026-10-21');
  assert.equal(m.lines.length, 1);
  const l = m.lines[0];
  assert.equal(l.label, 'Entretien et ramonage de conduit poêle à bois');
  assert.equal(l.description, 'Jollymec · Quadro+s/80 · N° 0160067');
  assert.equal(l.quantity, 1);
  assert.equal(l.vatPercent, 10);
  assert.equal(l.vatCode, 'FR_100');
  assert.equal(l.grossTtc, 90);
  assert.equal(l.netTtc, 90);
  assert.equal(l.discountPercent, 0);
  assert.equal(l.unitPriceHt, '81.8181818182');
  assert.equal(m.discount, null);
  assert.equal(m.totalTtc, 90);
  assert.equal(m.subject, 'Entretien de votre poêle à bois : Jollymec · Quadro+s/80 · N° 0160067');
});

test('2 équipements : 1 ligne chacun au prix grille, dégressivité 10 % portée par chaque ligne, total = montant du contrat', () => {
  const m = buildEntretienInvoice(dalous({ contract: { contract_number: 'CTR-1', amount: 225 }, pricing: pricingFor([EQ_POELE, EQ_PAC]) }));
  assert.deepEqual(m.errors, []);
  assert.deepEqual(m.lines.map((l) => [l.grossTtc, l.discountPercent, l.netTtc, l.vatCode]), [
    [90, 10, 81, 'FR_100'],
    [160, 10, 144, 'FR_200'],
  ]);
  assert.deepEqual(m.discount, { percent: 10, amount: 25, degressivitePercent: 10, commercialAmount: 0 });
  assert.equal(m.totalTtc, 225);
  assert.equal(m.subject, 'Entretien de vos équipements : Jollymec · Quadro+s/80 · N° 0160067 / Toshiba · Ras-16e2avg-e · N° 32301304');
});

test('montant forcé à la baisse : la remise relative couvre dégressivité + remise commerciale, la dernière ligne absorbe l’arrondi', () => {
  const m = buildEntretienInvoice(dalous({ contract: { contract_number: 'CTR-1', amount: 200 }, pricing: pricingFor([EQ_POELE, EQ_PAC]) }));
  assert.equal(m.discount.percent, 20);
  assert.equal(m.discount.degressivitePercent, 10);
  assert.equal(m.discount.commercialAmount, 25);
  assert.deepEqual(m.lines.map((l) => l.netTtc), [72, 128]);
  assert.equal(m.totalTtc, 200);
});

test('bi-split : le nombre d’unités se lit dans le libellé de la ligne, comme sur la Tarification (MATHIEU, 2026-09-21)', () => {
  const m = buildEntretienInvoice(dalous({
    contract: { contract_number: 'CTR-00233', amount: 468 },
    pricing: pricingFor([{ ...EQ_PAC, unit_count: 2 }, EQ_POELE]),
  }));
  assert.equal(m.lines[0].label, 'Entretien PAC Air/Air (2 splits)');
  assert.equal(m.lines[0].grossTtc, 210); // 160 + 1 split supplémentaire à 50
  assert.equal(m.lines[1].label, 'Entretien et ramonage de conduit poêle à bois');
  assert.equal(m.lines[0].description, 'Toshiba · Ras-16e2avg-e · N° 32301304');
});

test('montant forcé à la hausse : lignes majorées au prorata, pas de remise', () => {
  const m = buildEntretienInvoice(dalous({ contract: { contract_number: 'CTR-1', amount: 300 }, pricing: pricingFor([EQ_POELE, EQ_PAC]) }));
  assert.equal(m.discount, null);
  assert.deepEqual(m.lines.map((l) => [l.grossTtc, l.netTtc, l.discountPercent]), [[108, 108, 0], [192, 192, 0]]);
  assert.equal(m.totalTtc, 300);
});

test('pièces : les non offertes s’ajoutent sur la même facture, TVA de l’équipement, SANS remise', () => {
  const m = buildEntretienInvoice(dalous({
    contract: { contract_number: 'CTR-1', amount: 225 },
    pricing: pricingFor([EQ_POELE, EQ_PAC]),
    parts: [
      { designation: 'Joint de porte', quantite: 2, prix_ht: 30, offert: false },
      { designation: 'Vis', quantite: 1, prix_ht: 5, offert: true },
    ],
  }));
  assert.equal(m.lines.length, 3);
  const piece = m.lines[2];
  assert.equal(piece.kind, 'piece');
  assert.equal(piece.label, 'Joint de porte');
  assert.equal(piece.quantity, 2);
  assert.equal(piece.vatCode, 'FR_100');
  assert.equal(piece.discountPercent, 0);
  assert.equal(piece.unitPriceHt, '27.2727272727');
  assert.equal(piece.netTtc, 60);
  assert.equal(m.totalTtc, 285);
});

test('équipement sans tarif : ignoré avec avertissement ; aucun équipement tarifé : erreur bloquante', () => {
  const sansTarif = { id: 'eq-9', equipment_type_id: 'type-inconnu', brand: 'Inconnu' };
  const m1 = buildEntretienInvoice(dalous({ pricing: pricingFor([EQ_POELE, sansTarif]) }));
  assert.equal(m1.lines.length, 1);
  assert.ok(m1.warnings.some((w) => w.code === 'ligne_sans_tarif'));
  const m2 = buildEntretienInvoice(dalous({ pricing: pricingFor([sansTarif]) }));
  assert.ok(m2.errors.some((e) => e.code === 'aucune_ligne'));
  assert.equal(m2.lines.length, 0);
});

test('catégorie sans TVA configurée : 20 % par défaut ET avertissement', () => {
  const eqX = { id: 'eq-x', equipment_type_id: 'type-x', brand: 'Marque' };
  const m = buildEntretienInvoice(dalous({ contract: { amount: 100 }, pricing: pricingFor([eqX]) }));
  assert.equal(m.lines[0].vatCode, 'FR_200');
  assert.equal(m.lines[0].unitPriceHt, '83.3333333333');
  assert.ok(m.warnings.some((w) => w.code === 'tva_par_defaut'));
});

test('montant contractuel nul : erreur bloquante, aucune ligne', () => {
  const m = buildEntretienInvoice(dalous({ contract: { contract_number: 'CTR-1', amount: 0 } }));
  assert.ok(m.errors.some((e) => e.code === 'montant_contrat_nul'));
  assert.equal(m.lines.length, 0);
});

test('taux de TVA sans code Pennylane : erreur bloquante', () => {
  const m = buildEntretienInvoice(dalous({
    referentiel: { typesById: referentiel.typesById, categoriesById: new Map([['cat-poele', { ...CAT_POELE, default_vat_rate: 8 }]]) },
  }));
  assert.ok(m.errors.some((e) => e.code === 'tva_inconnue'));
});

test('charge utile Pennylane : chaînes pour les montants, remise relative par ligne d’équipement seulement, brouillon explicite, final = draft omis', () => {
  const m = buildEntretienInvoice(dalous({
    contract: { contract_number: 'CTR-1', amount: 225 },
    pricing: pricingFor([EQ_POELE, EQ_PAC]),
    parts: [{ designation: 'Joint', quantite: 1, prix_ht: 11 }],
  }));
  const brouillon = toPennylaneInvoicePayload(m, { customerId: 244601267, draft: true, externalReference: 'iv-1' });
  assert.equal(brouillon.customer_id, 244601267);
  assert.equal(brouillon.draft, true);
  assert.equal(brouillon.date, '2026-09-21');
  assert.equal(brouillon.deadline, '2026-10-21');
  assert.equal(brouillon.external_reference, 'iv-1');
  assert.equal(brouillon.pdf_invoice_subject, m.subject);
  assert.equal(brouillon.currency, 'EUR');
  assert.equal(brouillon.language, 'fr_FR');
  assert.deepEqual(brouillon.invoice_lines[0], {
    label: 'Entretien et ramonage de conduit poêle à bois',
    description: 'Jollymec · Quadro+s/80 · N° 0160067',
    quantity: '1',
    unit: 'piece',
    raw_currency_unit_price: '81.8181818182',
    vat_rate: 'FR_100',
    discount: { type: 'relative', value: '10' },
  });
  assert.equal(brouillon.invoice_lines[1].discount.value, '10');
  assert.equal('discount' in brouillon.invoice_lines[2], false);
  assert.equal(brouillon.invoice_lines[2].raw_currency_unit_price, '10');
  const finale = toPennylaneInvoicePayload(m, { customerId: 1, draft: false, externalReference: 'iv-1' });
  assert.equal('draft' in finale, false);
});
