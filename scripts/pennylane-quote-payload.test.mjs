// scripts/pennylane-quote-payload.test.mjs
// Corps du POST /quotes Pennylane v2 (src/lib/pennylaneQuotePayload.js) — schéma strict (additionalProperties: false).
// Incident 2026-10-25 : « These additional properties are not supported: label » (sections en { label } au lieu de
// { title, rank }), devis impossible à créer.
// Run : node --test scripts/pennylane-quote-payload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPennylaneQuotePayload } from '../src/lib/pennylaneQuotePayload.js';

const quote = { id: 'q-1', subject: 'Fourniture et pose d\'une borne V2C', validity_days: 30, global_discount_percent: 0 };
const lignes = [
  { line_type: 'section_title', designation: 'ÉQUIPEMENT' },
  { line_type: 'product', designation: 'Borne Trydan 7,4 kW', quantity: '1', unit: 'pièce', unit_price_ht: 640, tva_rate: 5.5, ledger_account_pl_id: 123 },
  { line_type: 'section_title', designation: 'OPTIONS' },
  { line_type: 'section_title', designation: 'POSE ET MISE EN SERVICE' },
  { line_type: 'labor', designation: 'Pose', quantity: 2, unit: 'h', unit_price_ht: 55, tva_rate: 10, discount_percent: 10 },
];
const NOW = new Date('2026-10-25T10:00:00Z');

test('sections : { title, rank } numérotées à partir de 1, chapitres vides retirés, lignes rangées par rang', () => {
  const p = buildPennylaneQuotePayload(quote, lignes, 42, NOW);
  assert.deepEqual(p.invoice_line_sections, [{ title: 'ÉQUIPEMENT', rank: 1 }, { title: 'POSE ET MISE EN SERVICE', rank: 2 }]);
  assert.deepEqual(p.invoice_lines.map((l) => l.section_rank), [1, 2]);
  for (const s of p.invoice_line_sections) assert.deepEqual(Object.keys(s).sort(), ['rank', 'title']);
});

test('ligne standard : quantité numérique, aucune propriété hors schéma (pas de product_id), remise de ligne en relative', () => {
  const p = buildPennylaneQuotePayload(quote, lignes, 42, NOW);
  const [borne, pose] = p.invoice_lines;
  assert.equal(borne.quantity, 1);
  assert.equal(typeof borne.quantity, 'number');
  assert.equal(borne.raw_currency_unit_price, '640.00');
  assert.equal(borne.vat_rate, 'FR_55');
  assert.equal(borne.unit, 'piece');
  assert.equal(borne.ledger_account_id, 123);
  const permis = ['label', 'quantity', 'raw_currency_unit_price', 'unit', 'vat_rate', 'ledger_account_id', 'description', 'section_rank', 'discount'];
  for (const l of p.invoice_lines) for (const k of Object.keys(l)) assert.ok(permis.includes(k), `propriété hors schéma : ${k}`);
  assert.equal('discount' in borne, false);
  assert.deepEqual(pose.discount, { type: 'relative', value: '10.00' });
  assert.equal(pose.unit, 'hour');
  assert.equal(pose.vat_rate, 'FR_100');
});

test('en-tête : dates, client, référence externe, remise globale au format { type, value }', () => {
  const p = buildPennylaneQuotePayload({ ...quote, global_discount_percent: 5 }, lignes, 42, NOW);
  assert.equal(p.customer_id, 42);
  assert.equal(p.date, '2026-10-25');
  assert.equal(p.deadline, '2026-11-24');
  assert.equal(p.external_reference, 'q-1');
  assert.equal(p.pdf_invoice_subject, 'Fourniture et pose d\'une borne V2C');
  assert.deepEqual(p.discount, { type: 'relative', value: '5.00' });
  assert.equal('discount' in buildPennylaneQuotePayload(quote, lignes, 42, NOW), false);
});

test('lignes avant tout chapitre : sans section_rank ; devis sans chapitre : pas de invoice_line_sections', () => {
  const p = buildPennylaneQuotePayload(quote, [{ line_type: 'product', designation: 'X', quantity: 1, unit: 'forfait', unit_price_ht: 10, tva_rate: 20 }], 42, NOW);
  assert.equal('invoice_line_sections' in p, false);
  assert.equal('section_rank' in p.invoice_lines[0], false);
  assert.equal(p.invoice_lines[0].unit, 'flat_rate');
});

test('modification (PUT) : anciennes lignes supprimées, nouvelles créées dans l\'ordre, rangées dans les sections EXISTANTES par titre', async () => {
  const { buildPennylaneQuoteUpdatePayload } = await import('../src/lib/pennylaneQuotePayload.js');
  const lignesModifiees = [
    { line_type: 'section_title', designation: 'ÉQUIPEMENT' },
    { line_type: 'product', designation: 'Borne Trydan 7,4 kW', quantity: 1, unit: 'pièce', unit_price_ht: 600, tva_rate: 5.5 },
    { line_type: 'section_title', designation: 'NOUVEAU CHAPITRE' },
    { line_type: 'product', designation: 'Abri', quantity: 1, unit: 'pièce', unit_price_ht: 90, tva_rate: 5.5 },
    { line_type: 'section_title', designation: 'Pose et mise en service' },
    { line_type: 'labor', designation: 'Pose', quantity: 1, unit: 'forfait', unit_price_ht: 225, tva_rate: 5.5, discount_percent: 5 },
  ];
  const existant = { lineIds: [11, 12, 13], sections: [{ rank: 1, title: 'ÉQUIPEMENT' }, { rank: 2, label: 'POSE ET MISE EN SERVICE' }] };
  const { payload, sansSection } = buildPennylaneQuoteUpdatePayload({ ...quote, global_discount_percent: 0 }, lignesModifiees, 42, existant, NOW);
  assert.deepEqual(payload.invoice_lines.delete, [{ id: 11 }, { id: 12 }, { id: 13 }]);
  assert.deepEqual(payload.invoice_lines.create.map((l) => [l.label, l.section_rank]), [['Borne Trydan 7,4 kW', 1], ['Abri', undefined], ['Pose', 2]]);
  assert.equal('section_rank' in payload.invoice_lines.create[1], false);
  assert.deepEqual(payload.invoice_lines.create[2].discount, { type: 'relative', value: '5.00' });
  assert.deepEqual(sansSection, ['NOUVEAU CHAPITRE']);
  assert.equal('invoice_line_sections' in payload, false, 'le PUT n\'accepte pas de sections');
  assert.deepEqual(payload.discount, { type: 'relative', value: '0.00' }, 'remise globale retirée : explicitement 0');
  assert.equal(payload.deadline, '2026-11-24');
  assert.equal(payload.customer_id, 42);
  const permis = ['date', 'deadline', 'customer_id', 'currency', 'language', 'pdf_invoice_subject', 'discount', 'external_reference', 'invoice_lines'];
  for (const k of Object.keys(payload)) assert.ok(permis.includes(k), `propriété hors schéma : ${k}`);
});
