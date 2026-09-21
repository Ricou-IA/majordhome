// scripts/entretien-invoice-model.test.mjs — modèle de facture d'entretien (src/lib/entretienInvoiceModel.js)
// node --test scripts/entretien-invoice-model.test.mjs
//
// Ce que la facture Pennylane d'un entretien DOIT reproduire : le montant contractuel
// figé (pas le prix catalogue), la TVA de la catégorie d'équipement, les pièces non
// offertes sur la même facture, l'objet « Entretien de votre poêle à bois : Marque ·
// Modèle · N° série ». Cas de référence : DALOUS, facture F-2026-09372 saisie à la main
// le 2026-09-21 (90 € TTC, 81,82 HT, TVA 10 %).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntretienInvoice, toPennylaneInvoicePayload } from '../src/lib/entretienInvoiceModel.js';

const CAT_POELE = { id: 'cat-poele', code: 'poele_bois', label: 'Poêle à bois', default_vat_rate: 10 };
const CAT_SANS_TVA = { id: 'cat-x', code: 'x', label: 'Divers', default_vat_rate: null };
const TYPE_POELE = { id: 'type-poele', label: 'Entretien et ramonage de conduit poêle à bois', category_id: 'cat-poele' };
const TYPE_X = { id: 'type-x', label: 'Type sans TVA', category_id: 'cat-x' };

const referentiel = {
  typesById: new Map([[TYPE_POELE.id, TYPE_POELE], [TYPE_X.id, TYPE_X]]),
  categoriesById: new Map([[CAT_POELE.id, CAT_POELE], [CAT_SANS_TVA.id, CAT_SANS_TVA]]),
};

const dalous = () => ({
  intervention: { id: 'iv-1', intervention_type: 'entretien' },
  contract: { id: 'ct-1', contract_number: 'CTR-00593', amount: 90 },
  pricingItems: [
    { equipment_id: 'eq-1', equipment_type_id: 'type-poele', equipment_type_label: 'Entretien et ramonage de conduit poêle à bois', quantity: 1, line_total: 90 },
  ],
  equipments: [
    { id: 'eq-1', brand: 'Jollymec', model: 'Quadro+s/80', serial_number: '0160067', equipment_type_id: 'type-poele', category_id: 'cat-poele' },
  ],
  parts: [],
  referentiel,
  deadlineDays: 30,
  today: '2026-09-21',
});

test('DALOUS : une ligne au montant contractuel, TVA 10 %, HT dérivé du TTC, échéance à 30 jours', () => {
  const m = buildEntretienInvoice(dalous());
  assert.deepEqual(m.errors, []);
  assert.equal(m.date, '2026-09-21');
  assert.equal(m.deadline, '2026-10-21');
  assert.equal(m.lines.length, 1);
  const l = m.lines[0];
  assert.equal(l.label, 'Entretien et ramonage de conduit poêle à bois');
  assert.equal(l.description, 'Jollymec · Quadro+s/80 · N° 0160067');
  assert.equal(l.quantity, 1);
  assert.equal(l.vatPercent, 10);
  assert.equal(l.vatCode, 'FR_100');
  assert.equal(l.totalTtc, 90);
  assert.equal(l.unitPriceHt, '81.8181818182');
  assert.equal(m.totalTtc, 90);
  assert.equal(m.subject, 'Entretien de votre poêle à bois : Jollymec · Quadro+s/80 · N° 0160067');
  assert.deepEqual(m.warnings, []);
});

test('montant forcé : les lignes sont mises à l’échelle du montant contractuel, la dernière absorbe l’arrondi', () => {
  const p = dalous();
  p.contract.amount = 200;
  p.pricingItems = [
    { equipment_id: 'eq-1', equipment_type_id: 'type-poele', equipment_type_label: 'A', quantity: 1, line_total: 100 },
    { equipment_id: 'eq-2', equipment_type_id: 'type-poele', equipment_type_label: 'B', quantity: 1, line_total: 120 },
  ];
  p.equipments.push({ id: 'eq-2', brand: 'Rika', model: 'Domo', serial_number: null, equipment_type_id: 'type-poele', category_id: 'cat-poele' });
  const m = buildEntretienInvoice(p);
  assert.deepEqual(m.lines.map((l) => l.totalTtc), [90.91, 109.09]);
  assert.equal(m.totalTtc, 200);
  assert.equal(m.subject, 'Entretien de vos équipements : Jollymec · Quadro+s/80 · N° 0160067 / Rika · Domo');
});

test('pièces : les non offertes s’ajoutent sur la même facture avec la TVA de l’équipement', () => {
  const p = dalous();
  p.parts = [
    { designation: 'Joint de porte', quantite: 2, prix_ht: 30, offert: false },
    { designation: 'Vis', quantite: 1, prix_ht: 5, offert: true },
  ];
  const m = buildEntretienInvoice(p);
  assert.equal(m.lines.length, 2);
  const piece = m.lines[1];
  assert.equal(piece.kind, 'piece');
  assert.equal(piece.label, 'Joint de porte');
  assert.equal(piece.quantity, 2);
  assert.equal(piece.vatCode, 'FR_100');
  assert.equal(piece.unitPriceHt, '27.2727272727');
  assert.equal(piece.totalTtc, 60);
  assert.equal(m.totalTtc, 150);
});

test('sans ligne tarifaire : une ligne « Contrat d’entretien » au montant, TVA de l’équipement', () => {
  const p = dalous();
  p.pricingItems = [];
  const m = buildEntretienInvoice(p);
  assert.equal(m.lines.length, 1);
  assert.equal(m.lines[0].label, 'Contrat d’entretien CTR-00593');
  assert.equal(m.lines[0].vatCode, 'FR_100');
  assert.equal(m.totalTtc, 90);
});

test('catégorie sans TVA configurée : 20 % par défaut ET avertissement', () => {
  const p = dalous();
  p.pricingItems[0].equipment_type_id = 'type-x';
  p.equipments[0].equipment_type_id = 'type-x';
  p.equipments[0].category_id = 'cat-x';
  const m = buildEntretienInvoice(p);
  assert.equal(m.lines[0].vatCode, 'FR_200');
  assert.equal(m.lines[0].unitPriceHt, '75');
  assert.ok(m.warnings.some((w) => w.code === 'tva_par_defaut'));
});

test('montant contractuel nul : erreur bloquante, aucune ligne', () => {
  const p = dalous();
  p.contract.amount = 0;
  const m = buildEntretienInvoice(p);
  assert.ok(m.errors.some((e) => e.code === 'montant_contrat_nul'));
  assert.equal(m.lines.length, 0);
});

test('taux de TVA sans code Pennylane : erreur bloquante', () => {
  const p = dalous();
  p.referentiel = {
    typesById: referentiel.typesById,
    categoriesById: new Map([['cat-poele', { ...CAT_POELE, default_vat_rate: 8 }]]),
  };
  const m = buildEntretienInvoice(p);
  assert.ok(m.errors.some((e) => e.code === 'tva_inconnue'));
});

test('charge utile Pennylane : chaînes pour les montants, brouillon explicite, final = draft omis', () => {
  const m = buildEntretienInvoice(dalous());
  const brouillon = toPennylaneInvoicePayload(m, { customerId: 244601267, draft: true, externalReference: 'iv-1' });
  assert.equal(brouillon.customer_id, 244601267);
  assert.equal(brouillon.draft, true);
  assert.equal(brouillon.date, '2026-09-21');
  assert.equal(brouillon.deadline, '2026-10-21');
  assert.equal(brouillon.external_reference, 'iv-1');
  assert.equal(brouillon.pdf_invoice_subject, m.subject);
  assert.equal(brouillon.currency, 'EUR');
  assert.equal(brouillon.language, 'fr_FR');
  assert.deepEqual(brouillon.invoice_lines, [
    {
      label: 'Entretien et ramonage de conduit poêle à bois',
      description: 'Jollymec · Quadro+s/80 · N° 0160067',
      quantity: '1',
      unit: 'piece',
      raw_currency_unit_price: '81.8181818182',
      vat_rate: 'FR_100',
    },
  ]);
  const finale = toPennylaneInvoicePayload(m, { customerId: 1, draft: false, externalReference: 'iv-1' });
  assert.equal('draft' in finale, false);
});
