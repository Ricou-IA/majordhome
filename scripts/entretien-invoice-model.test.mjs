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
import { buildEntretienInvoice, toPennylaneInvoicePayload, resolveLedgerAccountId, renderInvoiceTemplate, invoiceTemplatesFromSettings } from '../src/lib/entretienInvoiceModel.js';
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

// Pennylane : un compte par (numéro, taux) — cf. plan Mayer (70601 × any/FR_100/FR_55/FR_200)
const CATALOG = [
  { id: 1, number: '70601', label: "Contrat d'entretien", vatRate: 'any' },
  { id: 2, number: '70601', label: "Contrat d'entretien", vatRate: 'FR_100' },
  { id: 3, number: '70601', label: "Contrat d'entretien", vatRate: 'FR_55' },
  { id: 4, number: '70601', label: "Contrat d'entretien", vatRate: 'FR_200' },
  { id: 5, number: '7070', label: 'Pièces', vatRate: 'any' },
];
const LEDGERS = { byCategory: { 'cat-poele': '70601', 'cat-pac': '70601' }, parts: '7070', catalog: CATALOG };

test('resolveLedgerAccountId : déclinaison du taux de la ligne, sinon générique « any », id legacy toléré, introuvable = null', () => {
  assert.equal(resolveLedgerAccountId(CATALOG, '70601', 'FR_100'), 2);
  assert.equal(resolveLedgerAccountId(CATALOG, '70601', 'FR_200'), 4);
  assert.equal(resolveLedgerAccountId(CATALOG, '70601', 'exempt'), 1);
  assert.equal(resolveLedgerAccountId(CATALOG, '7070', 'FR_100'), 5);
  assert.equal(resolveLedgerAccountId(CATALOG, 3, 'FR_200'), 3);
  assert.equal(resolveLedgerAccountId(CATALOG, '70699', 'FR_100'), null);
  assert.equal(resolveLedgerAccountId([], '70601', 'FR_100'), '70601');
  assert.equal(resolveLedgerAccountId(CATALOG, null, 'FR_100'), null);
});

test('comptes comptables : par catégorie d’équipement + pièces, déclinés par TVA, transmis à Pennylane ; absent → avertissement une fois par catégorie', () => {
  const avec = buildEntretienInvoice(dalous({
    contract: { contract_number: 'CTR-1', amount: 225 },
    pricing: pricingFor([EQ_POELE, EQ_PAC]),
    parts: [{ designation: 'Joint', quantite: 1, prix_ht: 11 }],
    ledgerAccounts: LEDGERS,
  }));
  // poêle TVA 10 % → 70601/FR_100 ; PAC TVA 20 % → 70601/FR_200 ; pièces TVA 10 % → 7070/any
  assert.deepEqual(avec.lines.map((l) => l.ledgerAccountId), [2, 4, 5]);
  assert.equal(avec.warnings.filter((w) => w.code === 'compte_manquant').length, 0);
  const payload = toPennylaneInvoicePayload(avec, { customerId: 1, draft: true, externalReference: 'iv-1' });
  assert.deepEqual(payload.invoice_lines.map((l) => l.ledger_account_id), [2, 4, 5]);

  const sans = buildEntretienInvoice(dalous({
    contract: { contract_number: 'CTR-1', amount: 225 },
    pricing: pricingFor([EQ_POELE, { ...EQ_POELE, id: 'eq-1b' }, EQ_PAC]),
    parts: [{ designation: 'Joint', quantite: 1, prix_ht: 11 }],
    ledgerAccounts: { byCategory: { 'cat-pac': '70601' }, catalog: CATALOG },
  }));
  assert.deepEqual(sans.lines.map((l) => l.ledgerAccountId), [null, null, 4, null]);
  // poêle (1 fois pour 2 lignes) + pièces = 2 avertissements
  assert.equal(sans.warnings.filter((w) => w.code === 'compte_manquant').length, 2);
  assert.deepEqual(sans.errors, []);
  const p2 = toPennylaneInvoicePayload(sans, { customerId: 1, draft: true, externalReference: 'iv-1' });
  assert.equal('ledger_account_id' in p2.invoice_lines[0], false);

  const disparu = buildEntretienInvoice(dalous({ ledgerAccounts: { byCategory: { 'cat-poele': '70699' }, catalog: CATALOG } }));
  assert.equal(disparu.lines[0].ledgerAccountId, null);
  assert.ok(disparu.warnings.some((w) => w.code === 'compte_manquant' && /n’existe plus/.test(w.message)));
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
  assert.equal(l.unitPriceHt, '81.818182');
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
  assert.deepEqual(m.discount, { percent: 10, amount: 25, degressivitePercent: 10, exceptionalAmount: 0, commercialAmount: 0 });
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
    contract: { contract_number: 'CTR-00233', amount: 270 }, // (210 + 90) − dégressivité 10 %
    pricing: pricingFor([{ ...EQ_PAC, unit_count: 2 }, EQ_POELE]),
  }));
  assert.equal(m.lines[0].label, 'Entretien PAC Air/Air (2 splits)');
  assert.equal(m.lines[0].grossTtc, 210); // 160 + 1 split supplémentaire à 50
  assert.equal(m.lines[0].netTtc, 189);
  assert.equal(m.totalTtc, 270);
  assert.equal(m.lines[1].label, 'Entretien et ramonage de conduit poêle à bois');
  assert.equal(m.lines[0].description, 'Toshiba · Ras-16e2avg-e · N° 32301304');
});

test('remise exceptionnelle (contrat) : après la dégressivité, distinguée de la remise commerciale legacy, total = montant du contrat', () => {
  const pricing = computeContractLines({ equipments: [EQ_POELE, EQ_PAC], rates: RATES, equipmentTypes: TYPES, zone: ZONE, discounts: DISCOUNTS, exceptionalDiscount: 25 });
  assert.equal(pricing.discountAmount, 25);
  assert.equal(pricing.exceptionalDiscount, 25);
  assert.equal(pricing.total, 200); // 250 − 25 (dégressivité) − 25 (exceptionnelle)
  const m = buildEntretienInvoice(dalous({ contract: { contract_number: 'CTR-1', amount: 200 }, pricing }));
  assert.equal(m.discount.percent, 20);
  assert.equal(m.discount.degressivitePercent, 10);
  assert.equal(m.discount.exceptionalAmount, 25);
  assert.equal(m.discount.commercialAmount, 0);
  assert.equal(m.totalTtc, 200);
  // Une remise exceptionnelle supérieure au total ne produit jamais un total négatif
  assert.equal(calculateContractTotal([{ lineTotal: 90 }], [], 500).total, 0);
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
  assert.equal(piece.unitPriceHt, '27.272727');
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
  assert.equal(m.lines[0].unitPriceHt, '83.333333');
  assert.ok(m.warnings.some((w) => w.code === 'tva_par_defaut'));
});

test('équipement « À renseigner » : le texte de remplissage n’apparaît ni en description ni dans l’objet (FERNANDEZ, 2026-09-22)', () => {
  const eq = { id: 'eq-p', brand: 'À renseigner', model: 'à renseigner', serial_number: '', equipment_type_id: 'type-poele' };
  const m = buildEntretienInvoice(dalous({ pricing: pricingFor([eq]) }));
  assert.equal(m.lines[0].description, null);
  assert.equal(m.subject, 'Entretien — contrat CTR-00593');
  const payload = toPennylaneInvoicePayload(m, { customerId: 1, draft: true, externalReference: 'iv-1' });
  assert.equal('description' in payload.invoice_lines[0], false);
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
    quantity: 1,
    unit: 'piece',
    raw_currency_unit_price: '81.818182',
    vat_rate: 'FR_100',
    discount: { type: 'relative', value: '10' },
  });
  assert.equal(brouillon.invoice_lines[1].discount.value, '10');
  assert.equal('discount' in brouillon.invoice_lines[2], false);
  assert.equal(brouillon.invoice_lines[2].raw_currency_unit_price, '10');
  const finale = toPennylaneInvoicePayload(m, { customerId: 1, draft: false, externalReference: 'iv-1' });
  assert.equal('draft' in finale, false);
});

test('lignes : axes analytiques (compte par numero, equipement, type, categorie) pour le journal d\'integration', () => {
  const m = buildEntretienInvoice(dalous({
    pricing: pricingFor([EQ_POELE]),
    parts: [{ designation: 'Joint', quantite: 1, prix_ht: 12 }],
    ledgerAccounts: { byCategory: { 'cat-poele': '70601' }, parts: '7070', catalog: [] },
  }));
  const [eq, piece] = m.lines;
  assert.equal(eq.kind, 'contrat');
  assert.equal(eq.ledgerAccountNumber, '70601');
  assert.equal(eq.equipmentId, 'eq-1');
  assert.equal(eq.equipmentTypeId, 'type-poele');
  assert.equal(eq.categoryId, 'cat-poele');
  assert.equal(piece.kind, 'piece');
  assert.equal(piece.ledgerAccountNumber, '7070');
  assert.equal(piece.equipmentId, null);
  assert.equal(piece.equipmentTypeId, null);
  assert.equal(piece.categoryId, null);
});

test('lignes : compte non parametré → ledgerAccountNumber null (et avertissement existant)', () => {
  const m = buildEntretienInvoice(dalous({ ledgerAccounts: {} }));
  assert.equal(m.lines[0].ledgerAccountNumber, null);
  assert.ok(m.warnings.some((w) => w.code === 'compte_manquant'));
});

// ---------------------------------------------------------------------------
// Gabarits par catégorie (libellé / objet / ligne offerte)
// ---------------------------------------------------------------------------

test('renderInvoiceTemplate : variables, inconnue vide, espaces réduits, ponctuation orpheline retirée', () => {
  const vars = { type: 'Poêle à granulés', marque: 'Cola', modele: 'Fire HR acciaio', serie: '', contrat: 'CTR-00063' };
  assert.equal(renderInvoiceTemplate('Entretien de votre {type} : {marque} {modele}', vars), 'Entretien de votre Poêle à granulés : Cola Fire HR acciaio');
  assert.equal(renderInvoiceTemplate('Entretien {type} : {marque} {modele}', { ...vars, marque: '', modele: '' }), 'Entretien Poêle à granulés');
  assert.equal(renderInvoiceTemplate('Contrat {contrat} — {inconnue}', vars), 'Contrat CTR-00063');
  assert.equal(renderInvoiceTemplate('   ', vars), '');
  assert.equal(renderInvoiceTemplate(null, vars), '');
  assert.equal(renderInvoiceTemplate('{marque} · {modele} — contrat {contrat}', { marque: '', modele: '', contrat: 'CTR-1' }), 'contrat CTR-1');
  assert.equal(renderInvoiceTemplate('{marque} · {modele}', { marque: 'Cola', modele: '' }), 'Cola');
});

test('invoiceTemplatesFromSettings : normalise, ignore les vides et les "undefined", une entrée héritée (price_ht/vat_rate) est acceptée et ses clés ignorées', () => {
  const t = invoiceTemplatesFromSettings({
    templates: { by_category: {
      'cat-poele': { label: ' Entretien Performance {type} ', subject: '', offered: { label: 'Ramonage conduit de fumée', price_ht: '60', vat_rate: '10' } },
      'cat-pac': { label: 'undefined', offered: { label: '', price_ht: '10', vat_rate: '20' } },
      'cat-x': { offered: { label: 'Truc', price_ht: '5', vat_rate: '7' } },
    } },
  });
  assert.deepEqual(t.byCategory['cat-poele'], { label: 'Entretien Performance {type}', subject: null, offered: { label: 'Ramonage conduit de fumée' } });
  assert.deepEqual(t.byCategory['cat-pac'], { label: null, subject: null, offered: null });
  assert.deepEqual(t.byCategory['cat-x'], { label: null, subject: null, offered: { label: 'Truc' } });
  assert.deepEqual(invoiceTemplatesFromSettings({}), { byCategory: {} });
  assert.deepEqual(invoiceTemplatesFromSettings(null), { byCategory: {} });
});

test('gabarits : libellé et objet rendus par catégorie, suffixe d’unités conservé, défaut inchangé sans gabarit', () => {
  const templates = { byCategory: { 'cat-poele': { label: 'Entretien Performance {type} Multimarque', subject: 'Entretien de votre {type} : {marque} {modele}', offered: null } } };
  const eq = { ...EQ_POELE, brand: 'Cola', model: 'Fire HR acciaio', serial_number: null };
  const m = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', contract_number: 'CTR-00063', amount: 90 }, pricing: pricingFor([eq]), parts: [], referentiel, templates, today: '2026-09-23' });
  assert.equal(m.errors.length, 0);
  assert.equal(m.lines.length, 1);
  assert.equal(m.lines[0].label, 'Entretien Performance Entretien et ramonage de conduit poêle à bois Multimarque');
  assert.equal(m.subject, 'Entretien de votre Entretien et ramonage de conduit poêle à bois : Cola Fire HR acciaio');
  // bi-split : suffixe d'unités conservé après gabarit
  const tPac = { byCategory: { 'cat-pac': { label: 'Entretien {type}', subject: null, offered: null } } };
  const pac = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', amount: 210 }, pricing: pricingFor([{ ...EQ_PAC, unit_count: 2 }], { discounts: [] }), parts: [], referentiel, templates: tPac, today: '2026-09-23' });
  const base = pricingFor([{ ...EQ_PAC, unit_count: 2 }], { discounts: [] }).items[0];
  const suffix = base.labelWithUnits.slice(base.label.length);
  assert.ok(suffix.length > 0, 'la fixture bi-split doit produire un suffixe d’unités');
  assert.equal(pac.lines[0].label, `Entretien Entretien PAC Air/Air${suffix}`);
  // sans gabarit : identique à avant
  const none = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', contract_number: 'CTR-00063', amount: 90 }, pricing: pricingFor([eq]), parts: [], referentiel, templates: { byCategory: {} }, today: '2026-09-23' });
  assert.equal(none.lines[0].label, pricingFor([eq]).items[0].labelWithUnits);
  assert.equal(none.subject, 'Entretien de votre poêle à bois : Cola · Fire HR acciaio');
});

test('ligne offerte : après sa ligne d’équipement, sans prix ni TVA propres (suit sa ligne d’équipement), TTC net 0, compte de la catégorie, total inchangé, charge utile Pennylane', () => {
  const templates = { byCategory: { 'cat-poele': { label: null, subject: null, offered: { label: 'Ramonage conduit de fumée' } } } };
  const catalog = [{ id: 1, number: '70601', vatRate: 'any' }, { id: 2, number: '70601', vatRate: 'FR_100' }, { id: 3, number: '70601', vatRate: 'FR_55' }];
  const refPoele55 = { ...referentiel, categoriesById: new Map([[CAT_POELE.id, { ...CAT_POELE, default_vat_rate: 5.5 }], [CAT_PAC.id, CAT_PAC], [CAT_SANS_TVA.id, CAT_SANS_TVA]]) };
  const m = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', amount: 90 }, pricing: pricingFor([EQ_POELE]), parts: [{ designation: 'Joint', quantite: 1, prix_ht: 12, offert: false }], referentiel: refPoele55, ledgerAccounts: { byCategory: { 'cat-poele': '70601' }, parts: null, catalog }, templates, today: '2026-09-23' });
  assert.equal(m.errors.length, 0);
  assert.deepEqual(m.lines.map((l) => l.kind), ['contrat', 'libre', 'piece']);
  const off = m.lines[1];
  assert.equal(off.label, 'Ramonage conduit de fumée');
  assert.equal(off.description, 'Offert dans le cadre du contrat d’entretien');
  assert.equal(off.quantity, 1);
  assert.equal(off.vatPercent, 5.5);
  assert.equal(off.vatCode, 'FR_55');
  assert.equal(off.discountPercent, 0);
  assert.equal(off.grossTtc, 0);
  assert.equal(off.netTtc, 0);
  assert.equal(off.unitPriceHt, '0');
  assert.equal(off.ledgerAccountId, 3);
  assert.equal(off.ledgerAccountNumber, '70601');
  assert.equal(off.categoryId, 'cat-poele');
  assert.equal(off.equipmentId, 'eq-1');
  assert.equal(m.totalTtc, 102); // 90 + pièce 12, la ligne offerte ne pèse rien
  const payload = toPennylaneInvoicePayload(m, { customerId: 1, draft: true, externalReference: 'x' });
  assert.equal(payload.invoice_lines[1].discount, undefined);
  assert.equal(payload.invoice_lines[1].raw_currency_unit_price, '0');
  assert.equal(payload.invoice_lines[1].vat_rate, 'FR_55');
  assert.equal(payload.invoice_lines[1].ledger_account_id, 3);
  // 2 poêles → 2 lignes offertes, une derrière chaque équipement
  const m2 = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', amount: 162 }, pricing: pricingFor([EQ_POELE, { ...EQ_POELE, id: 'eq-3' }]), parts: [], referentiel, templates, today: '2026-09-23' });
  assert.deepEqual(m2.lines.map((l) => l.kind), ['contrat', 'libre', 'contrat', 'libre']);
  assert.equal(m2.totalTtc, 162);
});
