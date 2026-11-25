// Tests du module pur src/lib/savInvoiceModel.js — `node --test scripts/sav-invoice-model.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devisAFacturer, preparerFactureSav, modeleFactureSav } from '../src/lib/savInvoiceModel.js';
import { toPennylaneInvoicePayload } from '../src/lib/entretienInvoiceModel.js';

const catalog = [
  { id: 11, number: '70709', vatRate: 'FR_200' },
  { id: 12, number: '70709', vatRate: 'FR_100' },
];

test('devisAFacturer : un devis accepté passe avant un plus récent non accepté ; refusé écarté', () => {
  const q = [
    { id: 'a', status: 'accepte', created_at: '2026-11-01' },
    { id: 'b', status: 'envoye', created_at: '2026-11-10' },
    { id: 'c', status: 'refuse', created_at: '2026-11-20' },
  ];
  assert.equal(devisAFacturer(q).id, 'a');
  assert.equal(devisAFacturer([q[1], q[2]]).id, 'b');
  assert.equal(devisAFacturer([q[2]]), null);
  assert.equal(devisAFacturer([]), null);
  assert.equal(devisAFacturer(undefined), null);
});

test('reprise du devis : titres écartés, remises cumulées, compte des pièces, total juste', () => {
  const prep = preparerFactureSav({
    item: { id: 'i1' },
    quote: { subject: 'Remplacement carte électronique', quote_number: 'DEV-12', global_discount_percent: 10 },
    quoteLines: [
      { line_type: 'section_title', designation: 'PIÈCES' },
      { line_type: 'product', designation: 'Carte électronique', reference: 'REF-1', quantity: 1, unit_price_ht: 200, tva_rate: 10, discount_percent: 0 },
      { line_type: 'labor', designation: 'Main d’œuvre', quantity: 2, unit_price_ht: 50, tva_rate: 10, discount_percent: 20 },
    ],
    ledgerAccounts: { parts: '70709' },
    deadlineDays: 30,
    today: '2026-11-25',
  });
  assert.equal(prep.source, 'devis');
  assert.equal(prep.edits.length, 2);
  assert.equal(prep.edits[1].discountPercent, 28); // 1 − 0,8 × 0,9
  assert.equal(prep.base.subject, 'Remplacement carte électronique');
  assert.equal(prep.base.deadline, '2026-12-25');
  assert.ok(prep.base.warnings.some((w) => w.code === 'compte_defaut'));

  const m = modeleFactureSav(prep.base, prep.edits, { catalog });
  assert.deepEqual(m.errors, []);
  assert.equal(m.lines[0].ledgerAccountId, 12); // 70709 décliné à 10 %
  assert.equal(m.lines[1].ledgerAccountId, null);
  // HT : 200 × 0,9 + 100 × 0,72 = 252 ; TTC à 10 % = 277,20
  assert.equal(m.totalHt, 252);
  assert.equal(m.totalTtc, 277.2);

  const payload = toPennylaneInvoicePayload(m, { customerId: 9, draft: true, externalReference: 'x' });
  assert.equal(payload.invoice_lines.length, 2);
  assert.equal(payload.invoice_lines[0].ledger_account_id, 12);
  assert.equal(payload.invoice_lines[1].discount.value, '28');
  assert.equal(payload.draft, true);
});

test('sans devis : ligne « Intervention SAV » à chiffrer + pièces de la carte ; refus à 0 €', () => {
  const prep = preparerFactureSav({
    item: { sav_description: 'Poêle en défaut E3', parts_detail: [
      { designation: 'Bougie', reference: 'B-1', quantite: 1, prix_ht: 24 },
      { designation: 'Joint', quantite: 1, prix_ht: 10, offert: true },
    ] },
    ledgerAccounts: { parts: '70709' },
    today: '2026-11-25',
  });
  assert.equal(prep.source, 'saisie');
  assert.deepEqual(prep.edits.map((e) => e.label), ['Intervention SAV', 'Bougie']);
  assert.equal(prep.edits[0].description, 'Poêle en défaut E3');
  assert.equal(prep.base.subject, 'Intervention SAV');

  const vide = modeleFactureSav(prep.base, [prep.edits[0]], { catalog });
  assert.ok(vide.errors.some((e) => e.code === 'montant_nul'));

  const rempli = modeleFactureSav(prep.base, [{ ...prep.edits[0], unitPriceHt: 80 }, prep.edits[1]], { catalog });
  assert.deepEqual(rempli.errors, []);
  assert.equal(rempli.totalTtc, 120); // 80 × 1,2 + 24
  assert.equal(rempli.lines[1].ledgerAccountId, 11);
});

test('devis sans ligne : avertissement, facture refusée tant qu’elle est vide', () => {
  const prep = preparerFactureSav({ item: {}, quote: { subject: '' }, quoteLines: [], today: '2026-11-25' });
  assert.ok(prep.base.warnings.some((w) => w.code === 'devis_vide'));
  const m = modeleFactureSav(prep.base, prep.edits);
  assert.ok(m.errors.some((e) => e.code === 'aucune_ligne'));
});
