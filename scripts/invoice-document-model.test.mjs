// scripts/invoice-document-model.test.mjs — hub de facturation (src/lib/invoiceDocumentModel.js)
// node --test scripts/invoice-document-model.test.mjs
//
// Ce que la facture émise par Majord'home DOIT garantir (spec 2026-09-22) : montants au centime
// (ht + tva = ttc par ligne et au total), photo du client, réglages d'émission avec défauts
// neutres, mentions obligatoires sur le PDF, aucun glyphe hors cp1252.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVOICING_DEFAULTS, invoicingSettings, validateIban, validateBic, validateNumberPrefix, splitTtc, fmtEur,
  buildInvoiceDraft, buildInvoicePdfModel, invoiceErrorMessage, INVOICE_RPC_MESSAGES, CREDIT_NOTE_PAYMENT_NOTE,
} from '../src/lib/invoiceDocumentModel.js';
import { buildCompanyInfo } from '../src/lib/orgBranding.js';

const MODEL = {
  date: '2026-09-23', deadline: '2026-10-23', subject: 'Entretien de votre poêle à bois : Jollymec · Quadro',
  discount: { percent: 10, amount: 10, degressivitePercent: 10, exceptionalAmount: 0, commercialAmount: 0 },
  totalTtc: 102,
  lines: [
    { kind: 'contrat', label: 'Entretien poêle', description: 'Jollymec · Quadro', quantity: 1, vatPercent: 10,
      grossTtc: 100, netTtc: 90, discountPercent: 10, ledgerAccountId: 123, ledgerAccountNumber: '70601',
      equipmentId: 'eq-1', equipmentTypeId: 'type-poele', categoryId: 'cat-poele', vatCode: 'FR_100' },
    { kind: 'piece', label: 'Joint', description: 'REF-1', quantity: 2, vatPercent: 10,
      grossTtc: 12, netTtc: 12, discountPercent: 0, ledgerAccountId: null, ledgerAccountNumber: '7070',
      equipmentId: null, equipmentTypeId: null, categoryId: null, vatCode: 'FR_100' },
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

test('validateNumberPrefix : majuscules, 1 à 6 caractères, lettre en tête', () => {
  assert.deepEqual(validateNumberPrefix(' fm '), { ok: true, value: 'FM' });
  assert.equal(validateNumberPrefix('F-1').ok, false);
  assert.equal(validateNumberPrefix('1F').ok, false);
  assert.equal(validateNumberPrefix('ABCDEFG').ok, false);
  assert.equal(validateNumberPrefix('').ok, false);
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
    ledger_account_number: '70601', ledger_account_pl_id: 123, metier_key: 'type-poele', equipment_id: 'eq-1', category_id: 'cat-poele', vat_code: 'FR_100',
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

test('buildInvoiceDraft : dueDays 0 reste 0 (paiement comptant), pas un fallback à 30', () => {
  const { invoice } = buildInvoiceDraft({ model: MODEL, orgId: 'org-1', client: CLIENT, dueDays: 0 });
  assert.equal(invoice.due_days, 0);
});

test('buildInvoiceDraft : sans catalogue Pennylane, resolveLedgerAccountId renvoie le numéro → pas un id PL, ledger_account_pl_id null', () => {
  const model = { ...MODEL, lines: [{ ...MODEL.lines[0], ledgerAccountId: '70601', ledgerAccountNumber: '70601' }] };
  const { lines } = buildInvoiceDraft({ model, orgId: 'org-1', client: CLIENT, dueDays: 30 });
  assert.equal(lines[0].ledger_account_pl_id, null);
  // Contre-exemple (fixture existante) : id PL résolu (catalogue disponible), distinct du numéro → conservé.
  const { lines: withCatalog } = buildInvoiceDraft({ model: MODEL, orgId: 'org-1', client: CLIENT, dueDays: 30 });
  assert.equal(withCatalog[0].ledger_account_pl_id, 123);
});

test('buildInvoiceDraft + buildInvoicePdfModel : ligne offerte (gabarit par catégorie) — remisée à 100 %, net 0, total et TVA inchangés', () => {
  const OFFERED = {
    kind: 'libre', label: 'Ramonage conduit de fumée',
    description: 'Offert dans le cadre du contrat d’entretien (valeur 60,00 € HT)',
    quantity: 1, vatPercent: 10, vatCode: 'FR_100', ledgerAccountId: 2, ledgerAccountNumber: '70601',
    equipmentId: 'eq-1', equipmentTypeId: 'type-poele', categoryId: 'cat-poele',
    grossTtc: 66, netTtc: 0, discountPercent: 100, unitPriceHt: '60',
  };
  const modelSansOffert = MODEL;
  const model = { ...MODEL, lines: [...MODEL.lines, OFFERED] };

  const { invoice, lines } = buildInvoiceDraft({ model, orgId: 'org-1', context: 'contrat', client: CLIENT, dueDays: 30 });
  const offeredLine = lines[lines.length - 1];
  assert.equal(offeredLine.kind, 'libre');
  assert.equal(offeredLine.unit_price_ht, 0);
  assert.equal(offeredLine.ht, 0);
  assert.equal(offeredLine.tva, 0);
  assert.equal(offeredLine.ttc, 0);
  assert.equal(offeredLine.discount_percent, 100);
  assert.equal(offeredLine.vat_code, 'FR_100');
  assert.equal(offeredLine.ledger_account_number, '70601');
  assert.equal(offeredLine.ledger_account_pl_id, 2);

  // Le total ne bouge pas : la ligne offerte est nette de 0, comme sans elle.
  const { invoice: invoiceSansOffert } = buildInvoiceDraft({ model: modelSansOffert, orgId: 'org-1', context: 'contrat', client: CLIENT, dueDays: 30 });
  assert.equal(invoice.total_ttc, invoiceSansOffert.total_ttc);
  assert.equal(invoice.total_ht, invoiceSansOffert.total_ht);
  assert.equal(invoice.total_tva, invoiceSansOffert.total_tva);

  const rate10 = invoice.vat_breakdown.find((v) => v.rate === 10);
  assert.ok(rate10, 'ventilation TVA 10 % absente');
  assert.equal(invoice.vat_breakdown.reduce((s, v) => s + v.base, 0), invoice.total_ht);

  const pdf = buildInvoicePdfModel({
    invoice: {
      ...ISSUED,
      total_ht: invoice.total_ht, total_tva: invoice.total_tva, total_ttc: invoice.total_ttc, vat_breakdown: invoice.vat_breakdown,
    },
    lines,
    company: COMPANY,
    invoicing: INVOICING,
  });
  const offeredRow = pdf.rows[pdf.rows.length - 1];
  assert.equal(offeredRow.unitHt, '0,00 €');
  assert.equal(offeredRow.ht, '0,00 €');
  assert.equal(offeredRow.description, OFFERED.description);
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
  assert.deepEqual(pdf.rows[0], { label: 'Entretien poêle', description: 'Jollymec · Quadro', qty: '1', unitHt: '81,8182 €', vat: '10 %', ht: '81,82 €' });
  assert.equal(pdf.rows[1].qty, '2');
  assert.equal(pdf.rows[1].unitHt, '5,4545 €');
  assert.deepEqual(pdf.vatRows, [{ rate: '10 %', base: '92,73 €', amount: '9,27 €' }]);
  assert.deepEqual(pdf.totals, { ht: '92,73 €', tva: '9,27 €', ttc: '102,00 €' });
  assert.equal(pdf.discountLine, 'Remise 10 % appliquée sur les équipements (dégressivité 10 %) : -10,00 € TTC');
});

test('buildInvoicePdfModel : prix unitaire HT exact au centime → 2 décimales, pas 4', () => {
  const pdf = buildInvoicePdfModel({
    invoice: ISSUED, lines: [{ ...LINES[0], unit_price_ht: 100 }], company: COMPANY, invoicing: INVOICING,
  });
  assert.equal(pdf.rows[0].unitHt, '100,00 €');
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

test('buildInvoicePdfModel : IBAN invalide en settings → pas de ligne IBAN (iban.ok requis, pas seulement iban.value)', () => {
  const pdf = buildInvoicePdfModel({
    invoice: ISSUED, lines: LINES, company: COMPANY,
    invoicing: invoicingSettings({ invoicing: { iban: 'PAS UN IBAN' } }),
  });
  assert.equal(pdf.payment.length, 1);
  assert.ok(!pdf.payment.some((p) => p.includes('IBAN')));
});

test('buildInvoicePdfModel : aucun glyphe hors cp1252 dans les chaînes rendues', () => {
  const pdf = buildInvoicePdfModel({ invoice: ISSUED, lines: LINES, company: COMPANY, invoicing: INVOICING });
  const all = JSON.stringify(pdf);
  assert.ok(!/[\u202f\u2212\u2192\u2265\u2264\u0394\u03b8\u03a6]/.test(all), 'glyphe interdit trouvé');
});

test('buildInvoicePdfModel : avoir — titre, facture créditée, montants négatifs, mention de règlement dédiée', () => {
  const avoir = { ...ISSUED, kind: 'credit_note', number: 'F-2026-00013', credited_number: 'F-2026-00012', subject: 'Avoir sur la facture F-2026-00012',
    total_ht: -92.73, total_tva: -9.27, total_ttc: -102, vat_breakdown: [{ rate: 10, base: -92.73, amount: -9.27 }], discount: null };
  const lignes = LINES.map((l) => ({ ...l, unit_price_ht: -l.unit_price_ht, ht: -l.ht, tva: -l.tva, ttc: -l.ttc }));
  const pdf = buildInvoicePdfModel({ invoice: avoir, lines: lignes, company: COMPANY, invoicing: INVOICING });
  assert.equal(pdf.title, 'AVOIR');
  assert.equal(pdf.creditedNumber, 'F-2026-00012');
  assert.equal(pdf.totals.ttc, '-102,00 €');
  assert.equal(pdf.rows[0].ht, '-81,82 €');
  assert.deepEqual(pdf.vatRows, [{ rate: '10 %', base: '-92,73 €', amount: '-9,27 €' }]);
  assert.deepEqual(pdf.payment, [CREDIT_NOTE_PAYMENT_NOTE]);
  assert.deepEqual(pdf.legal, []);
  assert.equal(pdf.discountLine, null);
});

test('invoiceErrorMessage : code RPC connu (nu ou dans un message PostgREST) → français', () => {
  assert.equal(invoiceErrorMessage(new Error('intervention_already_invoiced')), 'Cette intervention a déjà une facture émise.');
  assert.equal(
    invoiceErrorMessage(new Error('duplicate key value violates unique constraint "invoices_one_issued_per_intervention" DETAIL: intervention_already_invoiced')),
    'Cette intervention a déjà une facture émise.',
  );
  assert.equal(invoiceErrorMessage(new Error('team_leader_required')), 'Réservé aux chefs d’équipe et administrateurs.');
});

test('invoiceErrorMessage : code inconnu → message brut renvoyé tel quel (jamais masqué)', () => {
  assert.equal(invoiceErrorMessage(new Error('some_unmapped_pg_error')), 'some_unmapped_pg_error');
});

test('invoiceErrorMessage : erreur vide/absente → fallback', () => {
  assert.equal(invoiceErrorMessage(null), 'La facture n’a pas pu être émise');
  assert.equal(invoiceErrorMessage('', 'Repli custom'), 'Repli custom');
});

test('buildInvoiceDraft : vat_code figé depuis le modèle, null si absent', () => {
  const { lines } = buildInvoiceDraft({ model: MODEL, orgId: 'o', client: CLIENT, dueDays: 30 });
  assert.equal(lines[0].vat_code, 'FR_100');
  const sans = { ...MODEL, lines: [{ ...MODEL.lines[0], vatCode: undefined }] };
  assert.equal(buildInvoiceDraft({ model: sans, orgId: 'o', client: CLIENT, dueDays: 30 }).lines[0].vat_code, null);
});

test('invoiceErrorMessage : codes de l\'import Pennylane', () => {
  assert.match(invoiceErrorMessage(new Error('customer_not_synced')), /client.*Pennylane/i);
  assert.match(invoiceErrorMessage(new Error('pdf_missing')), /PDF/);
  assert.match(invoiceErrorMessage(new Error('pennylane_import_failed (étape import)')), /Pennylane/);
});

test('invoiceErrorMessage : codes ajoutés par la revue finale (vat_code_unmapped, pennylane_reference_taken, invoice_without_client)', () => {
  assert.match(invoiceErrorMessage(new Error('vat_code_unmapped')), /TVA.*Pennylane/i);
  assert.match(invoiceErrorMessage(new Error('pennylane_reference_taken')), /Pennylane.*référence/i);
  assert.match(invoiceErrorMessage(new Error('invoice_without_client')), /client rattaché/i);
});

test('invoiceErrorMessage : codes de l\'avoir', () => {
  assert.match(invoiceErrorMessage(new Error('already_credited')), /déjà.*avoir/i);
  assert.match(invoiceErrorMessage(new Error('credit_note_source_invalid')), /émise/i);
  assert.match(invoiceErrorMessage(new Error('credited_invoice_not_imported')), /Pennylane/);
});

test('INVOICE_RPC_MESSAGES : les codes morts pennylane_disabled/already_imported ont été retirés', () => {
  assert.equal('pennylane_disabled' in INVOICE_RPC_MESSAGES, false);
  assert.equal('already_imported' in INVOICE_RPC_MESSAGES, false);
});

test('invoiceErrorMessage : detail de l\'edge ajouté entre parenthèses, borné à 300 caractères', () => {
  const err = Object.assign(new Error('pennylane_import_failed'), { detail: '422 Unprocessable Entity' });
  assert.equal(invoiceErrorMessage(err), `${INVOICE_RPC_MESSAGES.pennylane_import_failed} (422 Unprocessable Entity)`);
  const long = Object.assign(new Error('pennylane_import_failed'), { detail: 'x'.repeat(400) });
  assert.equal(invoiceErrorMessage(long), `${INVOICE_RPC_MESSAGES.pennylane_import_failed} (${'x'.repeat(300)})`);
  // Sans detail (ou detail vide/non-string) : message mappé nu, comportement inchangé.
  assert.equal(invoiceErrorMessage(new Error('pennylane_import_failed')), INVOICE_RPC_MESSAGES.pennylane_import_failed);
  assert.equal(invoiceErrorMessage(Object.assign(new Error('pennylane_import_failed'), { detail: '   ' })), INVOICE_RPC_MESSAGES.pennylane_import_failed);
});
