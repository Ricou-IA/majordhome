// scripts/pennylane-quote-payload.test.mjs
// Corps du POST /quotes Pennylane v2 (src/lib/pennylaneQuotePayload.js) — schéma strict (additionalProperties: false).
// Incident 2026-10-25 : « These additional properties are not supported: label » (sections en { label } au lieu de
// { title, rank }), devis impossible à créer.
// Run : node --test scripts/pennylane-quote-payload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPennylaneQuotePayload, buildPennylaneQuoteUpdatePayload, regrouperChapitresPrixMasques } from '../src/lib/pennylaneQuotePayload.js';

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

test('description Pennylane = description libre puis caractéristiques, une par ligne ; clé absente si les deux sont vides', async () => {
  const { buildPennylaneQuoteUpdatePayload } = await import('../src/lib/pennylaneQuotePayload.js');
  const base = { line_type: 'product', quantity: 1, unit: 'pièce', unit_price_ht: 10, tva_rate: 20 };
  const entree = [
    { ...base, designation: 'A', description: 'Pose incluse', caracteristiques: ['Puissance : 8 kW'] },
    { ...base, designation: 'B', caracteristiques: ['Puissance : 8 kW', 'Garantie : 5 ans'] },
    { ...base, designation: 'C', description: 'Texte seul' },
    { ...base, designation: 'D' },
    { ...base, designation: 'E', description: '', caracteristiques: [] },
    { ...base, designation: 'F', description: null, caracteristiques: ['', 'Poids : 40 kg'] },
  ];
  const attendu = ['Pose incluse\nPuissance : 8 kW', 'Puissance : 8 kW\nGarantie : 5 ans', 'Texte seul', undefined, undefined, 'Poids : 40 kg'];
  const post = buildPennylaneQuotePayload(quote, entree, 42, NOW).invoice_lines;
  assert.deepEqual(post.map((l) => l.description), attendu);
  assert.equal('description' in post[3], false);
  assert.equal('description' in post[4], false);
  // renvoi (PUT) : même règle, sinon un devis renvoyé perdrait ses caractéristiques
  const put = buildPennylaneQuoteUpdatePayload(quote, entree, 42, { lineIds: [], sections: [] }, NOW).payload.invoice_lines.create;
  assert.deepEqual(put.map((l) => l.description), attendu);
  // aucune clé hors schéma : les caractéristiques n'ouvrent pas de propriété
  const permis = ['label', 'quantity', 'raw_currency_unit_price', 'unit', 'vat_rate', 'ledger_account_id', 'description', 'section_rank', 'discount'];
  for (const l of [...post, ...put]) for (const k of Object.keys(l)) assert.ok(permis.includes(k), `propriété hors schéma : ${k}`);
});

// ---------------------------------------------------------------------------
// Chapitre à prix masqués → une ligne par chapitre, articles en description (Eric, 2026-10-27)
// ---------------------------------------------------------------------------
const fumisterie = [
  { line_type: 'section_title', designation: 'POÊLE' },
  { line_type: 'product', designation: 'Poêle Rika', quantity: 1, unit: 'pièce', unit_price_ht: 3000, tva_rate: 5.5 },
  { line_type: 'section_title', designation: 'FUMISTERIE', hide_prices: true },
  { line_type: 'product', designation: 'FLEXIBLE - CHAPEAU P/GAINE - D 150', supplier_name: 'MODINOX / ALTEMA', reference: '2FLECHSI150', quantity: '1', unit: 'pièce', unit_price_ht: 75.3, tva_rate: 20, ledger_account_pl_id: 77, description: 'quantité provisoire' },
  { line_type: 'product', designation: 'PTR30+ LAQ - ELT DROIT - D 80 - LG 1000', supplier_name: 'MODINOX / ALTEMA', reference: '2PTRELD80', quantity: 7, unit: 'pièce', unit_price_ht: 186.2, tva_rate: 20, ledger_account_pl_id: 77, discount_percent: 10 },
  { line_type: 'product', designation: 'FLEXIBLE - POLYLISSE XT 316L - COUPE', supplier_name: 'MODINOX / ALTEMA', reference: '2FLEPOLIXT10150C', quantity: 6.5, unit: 'ml', unit_price_ht: 104.9, tva_rate: 20, ledger_account_pl_id: 77 },
  { line_type: 'product', designation: 'Support mural de départ', quantity: 1, unit: 'pièce', unit_price_ht: 200, tva_rate: 20 },
  { line_type: 'section_title', designation: 'POSE ET MISE EN SERVICE' },
  { line_type: 'labor', designation: 'Pose', quantity: 2, unit: 'h', unit_price_ht: 55, tva_rate: 10 },
];

test('chapitre à prix masqués : une seule ligne au titre du chapitre, quantité 1, total HT du chapitre remises comprises', () => {
  const p = buildPennylaneQuotePayload(quote, fumisterie, 42, NOW);
  assert.deepEqual(p.invoice_line_sections.map((s) => s.title), ['POÊLE', 'FUMISTERIE', 'POSE ET MISE EN SERVICE']);
  assert.equal(p.invoice_lines.length, 3);
  const fum = p.invoice_lines[1];
  assert.equal(fum.label, 'FUMISTERIE');
  assert.equal(fum.quantity, 1);
  assert.equal(fum.unit, 'piece');
  assert.equal(fum.section_rank, 2);
  // 75,30 + 7 × 186,20 × 0,9 (= 1 173,06) + 6,5 × 104,90 (= 681,85) + 200
  assert.equal(fum.raw_currency_unit_price, '2130.21');
  assert.equal(fum.vat_rate, 'FR_200');
  assert.equal(fum.discount, undefined);
  // compte de vente non unanime (le support n'en a pas) → aucun compte imposé
  assert.equal(fum.ledger_account_id, undefined);
});

test('chapitre à prix masqués : chaque article en description « qté × désignation · fournisseur · référence », sans prix ni mentions du métré', () => {
  const p = buildPennylaneQuotePayload(quote, fumisterie, 42, NOW);
  assert.equal(p.invoice_lines[1].description, [
    'FLEXIBLE - CHAPEAU P/GAINE - D 150 · MODINOX / ALTEMA · 2FLECHSI150',
    '7 × PTR30+ LAQ - ELT DROIT - D 80 - LG 1000 · MODINOX / ALTEMA · 2PTRELD80',
    '6,5 ml · FLEXIBLE - POLYLISSE XT 316L - COUPE · MODINOX / ALTEMA · 2FLEPOLIXT10150C',
    'Support mural de départ',
  ].join('\n'));
  assert.ok(!p.invoice_lines[1].description.includes('quantité provisoire'));
  assert.ok(!p.invoice_lines[1].description.includes('€'));
});

test('chapitre à prix masqués : les autres chapitres restent ligne à ligne', () => {
  const p = buildPennylaneQuotePayload(quote, fumisterie, 42, NOW);
  assert.equal(p.invoice_lines[0].label, 'Poêle Rika');
  assert.equal(p.invoice_lines[2].label, 'Pose');
  assert.equal(p.invoice_lines[2].section_rank, 3);
});

test('chapitre à prix masqués mélangeant deux taux de TVA : une ligne par taux, libellé suffixé', () => {
  const lignes = [
    { line_type: 'section_title', designation: 'FUMISTERIE', hide_prices: true },
    { line_type: 'product', designation: 'A', quantity: 1, unit: 'pièce', unit_price_ht: 100, tva_rate: 20, ledger_account_pl_id: 5 },
    { line_type: 'product', designation: 'B', quantity: 2, unit: 'pièce', unit_price_ht: 50, tva_rate: 10 },
    { line_type: 'product', designation: 'C', quantity: 1, unit: 'pièce', unit_price_ht: 10, tva_rate: 20, ledger_account_pl_id: 5 },
  ];
  const p = buildPennylaneQuotePayload(quote, lignes, 42, NOW);
  assert.deepEqual(p.invoice_lines.map((l) => [l.label, l.raw_currency_unit_price, l.vat_rate, l.ledger_account_id]), [
    ['FUMISTERIE (TVA 20 %)', '110.00', 'FR_200', 5],
    ['FUMISTERIE (TVA 10 %)', '100.00', 'FR_100', undefined],
  ]);
});

test('regrouperChapitresPrixMasques : sans chapitre masqué, les lignes ressortent telles quelles', () => {
  assert.deepEqual(regrouperChapitresPrixMasques(lignes), lignes);
  assert.deepEqual(regrouperChapitresPrixMasques([]), []);
});

test('renvoi (PUT) : le chapitre à prix masqués part aussi en une ligne, rangé dans la section existante', () => {
  const { payload, sansSection } = buildPennylaneQuoteUpdatePayload(quote, fumisterie, 42, {
    lineIds: [1, 2], sections: [{ rank: 1, title: 'Poêle' }, { rank: 2, title: 'Fumisterie' }, { rank: 3, title: 'Pose et mise en service' }],
  }, NOW);
  assert.deepEqual(sansSection, []);
  assert.deepEqual(payload.invoice_lines.create.map((l) => [l.label, l.section_rank]), [['Poêle Rika', 1], ['FUMISTERIE', 2], ['Pose', 3]]);
  assert.equal(payload.invoice_lines.create[1].raw_currency_unit_price, '2130.21');
});
