// scripts/invoice-document-model.test.mjs — hub de facturation (src/lib/invoiceDocumentModel.js)
// node --test scripts/invoice-document-model.test.mjs
//
// Ce que la facture émise par Majord'home DOIT garantir (spec 2026-09-22) : montants au centime
// (ht + tva = ttc par ligne et au total), photo du client, réglages d'émission avec défauts
// neutres, mentions obligatoires sur le PDF, aucun glyphe hors cp1252.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVOICING_DEFAULTS, invoicingSettings, validateIban, validateBic, splitTtc, fmtEur,
  buildInvoiceDraft, buildInvoicePdfModel,
} from '../src/lib/invoiceDocumentModel.js';
import { buildCompanyInfo } from '../src/lib/orgBranding.js';

const MODEL = {
  date: '2026-09-23', deadline: '2026-10-23', subject: 'Entretien de votre poêle à bois : Jollymec · Quadro',
  discount: { percent: 10, amount: 10, degressivitePercent: 10, exceptionalAmount: 0, commercialAmount: 0 },
  totalTtc: 102,
  lines: [
    { kind: 'contrat', label: 'Entretien poêle', description: 'Jollymec · Quadro', quantity: 1, vatPercent: 10,
      grossTtc: 100, netTtc: 90, discountPercent: 10, ledgerAccountId: 123, ledgerAccountNumber: '70601',
      equipmentId: 'eq-1', equipmentTypeId: 'type-poele', categoryId: 'cat-poele' },
    { kind: 'piece', label: 'Joint', description: 'REF-1', quantity: 2, vatPercent: 10,
      grossTtc: 12, netTtc: 12, discountPercent: 0, ledgerAccountId: null, ledgerAccountNumber: '7070',
      equipmentId: null, equipmentTypeId: null, categoryId: null },
  ],
  warnings: [], errors: [],
};
const CLIENT = { id: 'cl-1', display_name: 'Anna FERNANDEZ', first_name: 'Anna', last_name: 'FERNANDEZ',
  address: '3 impasse des Lilas', postal_code: '81600', city: 'Gaillac', email: 'anna@example.org', phone: '0612345678', client_number: 286 };

test('invoicingSettings : défauts neutres, préfixe forcé en majuscules', () => {
  assert.deepEqual(invoicingSettings({}), INVOICING_DEFAULTS);
  assert.equal(invoicingSettings({ invoicing: { number_prefix: 'fm' } }).numberPrefix, 'FM');
  assert.equal(invoicingSettings({ invoicing: { number_prefix: '' } }).numberPrefix, 'F');
  assert.equal(invoicingSettings({ invoicing: { iban: 'FR76 1234' } }).iban, 'FR76 1234');
});

test('validateIban / validateBic : normalisation + format', () => {
  assert.deepEqual(validateIban('fr76 3000 6000 0112 3456 7890 189'), { ok: true, value: 'FR76 3000 6000 0112 3456 7890 189' });
  assert.equal(validateIban('FR76').ok, false);
  assert.equal(validateIban('').ok, true); // vide = pas de bloc paiement, pas une erreur
  assert.deepEqual(validateBic('agrifrpp'), { ok: true, value: 'AGRIFRPP' });
  assert.deepEqual(validateBic('AGRIFRPP882'), { ok: true, value: 'AGRIFRPP882' });
  assert.equal(validateBic('AGRI').ok, false);
});

test('splitTtc : ht + tva = ttc au centime', () => {
  assert.deepEqual(splitTtc(90, 10), { ht: 81.82, tva: 8.18, ttc: 90 });
  assert.deepEqual(splitTtc(100, 20), { ht: 83.33, tva: 16.67, ttc: 100 });
  assert.deepEqual(splitTtc(12, 0), { ht: 12, tva: 0, ttc: 12 });
  for (const [ttc, r] of [[0.01, 20], [33.33, 5.5], [999.99, 10]]) {
    const s = splitTtc(ttc, r);
    assert.equal(Math.round((s.ht + s.tva) * 100), Math.round(s.ttc * 100));
  }
});

test('fmtEur : espaces ordinaires, virgule, deux décimales', () => {
  assert.equal(fmtEur(1234.5), '1 234,50 €');
  assert.equal(fmtEur(0), '0,00 €');
  assert.equal(fmtEur(-40), '-40,00 €');
  assert.ok(!/[\u202f\u00a0]/.test(fmtEur(1234567.89)));
});

test('buildInvoiceDraft : en-tête + lignes persistables, totaux = sommes des lignes', () => {
  const { invoice, lines } = buildInvoiceDraft({
    model: MODEL, orgId: 'org-1', context: 'contrat', client: CLIENT, contractId: 'ct-1', interventionId: 'iv-1', dueDays: 30,
  });
  assert.equal(invoice.org_id, 'org-1');
  assert.equal(invoice.kind, 'invoice');
  assert.equal(invoice.client_id, 'cl-1');
  assert.equal(invoice.contract_id, 'ct-1');
  assert.equal(invoice.intervention_id, 'iv-1');
  assert.equal(invoice.due_days, 30);
  assert.equal(invoice.subject, MODEL.subject);
  assert.deepEqual(invoice.customer, {
    name: 'Anna FERNANDEZ', address: '3 impasse des Lilas', postal_code: '81600', city: 'Gaillac',
    email: 'anna@example.org', phone: '0612345678', client_number: 286,
  });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {
    position: 1, kind: 'contrat', label: 'Entretien poêle', description: 'Jollymec · Quadro', quantity: 1,
    unit_price_ht: 81.8182, vat_rate: 10, discount_percent: 10, ht: 81.82, tva: 8.18, ttc: 90,
    ledger_account_number: '70601', ledger_account_pl_id: 123, metier_key: 'type-poele', equipment_id: 'eq-1', category_id: 'cat-poele',
  });
  assert.equal(lines[1].quantity, 2);
  assert.equal(lines[1].unit_price_ht, 5.4545);
  assert.equal(lines[1].ttc, 12);
  assert.equal(invoice.total_ht, 92.73);
  assert.equal(invoice.total_tva, 9.27);
  assert.equal(invoice.total_ttc, 102);
  assert.deepEqual(invoice.vat_breakdown, [{ rate: 10, base: 92.73, amount: 9.27 }]);
  assert.deepEqual(invoice.discount, MODEL.discount);
});

test('buildInvoiceDraft : ventilation TVA multi-taux et client sans email', () => {
  const model = { ...MODEL, lines: [MODEL.lines[0], { ...MODEL.lines[1], vatPercent: 20 }] };
  const { invoice } = buildInvoiceDraft({ model, orgId: 'org-1', client: { ...CLIENT, email: null }, dueDays: 45 });
  assert.deepEqual(invoice.vat_breakdown, [{ rate: 10, base: 81.82, amount: 8.18 }, { rate: 20, base: 10, amount: 2 }]);
  assert.equal(invoice.total_ttc, 102);
  assert.equal(invoice.customer.email, null);
  assert.equal(invoice.due_days, 45);
});

test('buildInvoiceDraft : nom client = display_name, sinon "Prénom NOM"', () => {
  const { invoice } = buildInvoiceDraft({ model: MODEL, orgId: 'o', client: { first_name: 'Anna', last_name: 'FERNANDEZ' }, dueDays: 30 });
  assert.equal(invoice.customer.name, 'Anna FERNANDEZ');
});

const ISSUED = {
  id: 'inv-1', number: 'F-2026-00012', kind: 'invoice', status: 'issued', invoice_date: '2026-09-23', due_at: '2026-10-23',
  subject: 'Entretien de votre poêle', customer: { name: 'Anna FERNANDEZ', address: '3 impasse des Lilas', postal_code: '81600', city: 'Gaillac', client_number: 286 },
  total_ht: 92.73, total_tva: 9.27, total_ttc: 102, vat_breakdown: [{ rate: 10, base: 92.73, amount: 9.27 }],
  discount: { percent: 10, amount: 10, degressivitePercent: 10, exceptionalAmount: 0, commercialAmount: 0 },
};
const LINES = [
  { position: 1, kind: 'contrat', label: 'Entretien poêle', description: 'Jollymec · Quadro', quantity: 1, unit_price_ht: 81.8182, vat_rate: 10, discount_percent: 10, ht: 81.82, tva: 8.18, ttc: 90 },
  { position: 2, kind: 'piece', label: 'Joint', description: null, quantity: 2, unit_price_ht: 5.4545, vat_rate: 10, discount_percent: 0, ht: 10.91, tva: 1.09, ttc: 12 },
];
const COMPANY = buildCompanyInfo({ brand_name: 'Test Énergie', legal_name: 'TEST ENERGIE', legal_form: 'SAS', capital: '6 000', siret: '100 288 224 00015',
  rcs: '100 288 224 R.C.S. Albi', tva_intra: 'FR 06 449776916', address: '26 rue des Pyrénées', postal_code: '81600', city: 'Gaillac', phone: '05 63 00 00 00',
  from_email: 'contact@test.fr', rge_certifications: ['QualiBois'] });
const INVOICING = invoicingSettings({ invoicing: { iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP882' } });

test('buildInvoicePdfModel : en-tête, lignes, TVA, totaux, remise', () => {
  const pdf = buildInvoicePdfModel({ invoice: ISSUED, lines: LINES, company: COMPANY, invoicing: INVOICING });
  assert.equal(pdf.title, 'FACTURE');
  assert.equal(pdf.number, 'F-2026-00012');
  assert.deepEqual(pdf.dates, { invoice: '23/09/2026', due: '23/10/2026' });
  assert.deepEqual(pdf.customer, ['Anna FERNANDEZ', '3 impasse des Lilas', '81600 Gaillac', 'Client n° 286']);
  assert.equal(pdf.rows.length, 2);
  assert.deepEqual(pdf.rows[0], { label: 'Entretien poêle', description: 'Jollymec · Quadro', qty: '1', unitHt: '81,82 €', vat: '10 %', ht: '81,82 €' });
  assert.equal(pdf.rows[1].qty, '2');
  assert.equal(pdf.rows[1].unitHt, '5,45 €');
  assert.deepEqual(pdf.vatRows, [{ rate: '10 %', base: '92,73 €', amount: '9,27 €' }]);
  assert.deepEqual(pdf.totals, { ht: '92,73 €', tva: '9,27 €', ttc: '102,00 €' });
  assert.equal(pdf.discountLine, 'Remise 10 % appliquée sur les équipements (dégressivité 10 %) : -10,00 € TTC');
});

test('buildInvoicePdfModel : mentions obligatoires, paiement, RGE, pied de page', () => {
  const pdf = buildInvoicePdfModel({ invoice: ISSUED, lines: LINES, company: COMPANY, invoicing: INVOICING });
  assert.deepEqual(pdf.payment, [
    'Paiement à réception, au plus tard à la date d’échéance.',
    'IBAN : FR76 3000 6000 0112 3456 7890 189 — BIC : AGRIFRPP882',
  ]);
  assert.ok(pdf.legal.some((l) => l.includes('trois fois le taux d’intérêt légal')));
  assert.ok(pdf.legal.some((l) => l.includes('40 €')));
  assert.ok(pdf.legal.some((l) => l.includes('escompte')));
  assert.equal(pdf.rge, 'Certifications : QualiBois');
  assert.ok(pdf.footer.includes('TEST ENERGIE') && pdf.footer.includes('SIRET 100 288 224 00015') && pdf.footer.includes('TVA FR 06 449776916'));
});

test('buildInvoicePdfModel : sans IBAN → pas de ligne IBAN ; sans RGE → null ; avoir → AVOIR', () => {
  const pdf = buildInvoicePdfModel({ invoice: { ...ISSUED, kind: 'credit_note', credited_number: 'F-2026-00011' }, lines: LINES,
    company: buildCompanyInfo({}), invoicing: invoicingSettings({}) });
  assert.equal(pdf.title, 'AVOIR');
  assert.equal(pdf.creditedNumber, 'F-2026-00011');
  assert.equal(pdf.payment.length, 1);
  assert.equal(pdf.rge, null);
});

test('buildInvoicePdfModel : aucun glyphe hors cp1252 dans les chaînes rendues', () => {
  const pdf = buildInvoicePdfModel({ invoice: ISSUED, lines: LINES, company: COMPANY, invoicing: INVOICING });
  const all = JSON.stringify(pdf);
  assert.ok(!/[\u202f\u2212\u2192\u2265\u2264\u0394\u03b8\u03a6]/.test(all), 'glyphe interdit trouvé');
});
