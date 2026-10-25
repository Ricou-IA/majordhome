// scripts/devis-annexes.test.mjs
// Annexes jointes au PDF d'un devis (src/lib/devisAnnexes.js) — demande d'Eric (2026-10-25) : « ajouter dans le PDF
// la fiche technique de l'équipement si présente + brochure de l'entreprise si présente ».
// Run : node --test scripts/devis-annexes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annexesDevis, articlesEquipement } from '../src/lib/devisAnnexes.js';
import { buildDevisConfig } from '../src/lib/devisConfig.js';

const T = (d) => ({ line_type: 'section_title', designation: d });
const typeDe = (titre) => ({ 'ÉQUIPEMENT': 'equipement', OPTIONS: 'option', 'SÉCURITÉ ET ACCESSOIRES': 'stock' }[titre] || 'libre');
const lignes = [
  T('ÉQUIPEMENT'), { line_type: 'product', designation: 'Borne', catalog_item_id: 'borne' }, { line_type: 'product', designation: 'Borne bis', catalog_item_id: 'borne' },
  T('OPTIONS'), { line_type: 'product', designation: 'Abri', catalog_item_id: 'abri' },
  T('SÉCURITÉ ET ACCESSOIRES'), { line_type: 'product', designation: 'Disjoncteur', catalog_item_id: 'disj' },
];

test('articlesEquipement : articles des chapitres Équipement seulement, sans doublon, dans l\'ordre', () => {
  assert.deepEqual(articlesEquipement(lignes, typeDe), ['borne']);
  assert.deepEqual(articlesEquipement([{ line_type: 'product', catalog_item_id: 'x' }], typeDe), [], 'ligne hors chapitre : pas un équipement');
});

test('annexesDevis : une fiche technique PDF par équipement (celle de l\'article d\'abord), puis la brochure', () => {
  const documents = [
    { item_id: 'borne', origine: 'fournisseur', document_type: 'Fiche technique', mime_type: 'application/pdf', storage_path: 'org/p1/f.pdf', file_name: 'fiche-fournisseur.pdf' },
    { item_id: 'borne', origine: 'article', document_type: 'Fiche technique', mime_type: 'application/pdf', storage_path: 'org/articles/borne/f.pdf', file_name: 'Fiche Trydan.pdf' },
    { item_id: 'borne', origine: 'article', document_type: 'Notice', mime_type: 'application/pdf', storage_path: 'org/articles/borne/n.pdf', file_name: 'notice.pdf' },
    { item_id: 'abri', origine: 'article', document_type: 'Fiche technique', mime_type: 'application/pdf', storage_path: 'org/articles/abri/f.pdf', file_name: 'abri.pdf' },
  ];
  const a = annexesDevis({ lines: lignes, typeDe, documents, brochure: { storage_path: 'org/devis/brochure.pdf', file_name: 'Brochure Mayer.pdf' } });
  assert.deepEqual(a, [
    { label: 'Fiche Trydan.pdf', storage_path: 'org/articles/borne/f.pdf' },
    { label: 'Brochure Mayer.pdf', storage_path: 'org/devis/brochure.pdf' },
  ]);
});

test('annexesDevis : fiche non PDF (image) ignorée, aucune fiche ni brochure ⇒ liste vide', () => {
  const documents = [{ item_id: 'borne', origine: 'article', document_type: 'Fiche technique', mime_type: 'image/png', storage_path: 'x.png', file_name: 'x.png' }];
  assert.deepEqual(annexesDevis({ lines: lignes, typeDe, documents, brochure: null }), []);
});

test('buildDevisConfig : brochure = { storage_path, file_name } valide, sinon null', () => {
  assert.equal(buildDevisConfig({}).brochure, null);
  assert.deepEqual(buildDevisConfig({ devis: { brochure: { storage_path: 'org/devis/b.pdf', file_name: 'B.pdf' } } }).brochure, { storage_path: 'org/devis/b.pdf', file_name: 'B.pdf' });
  assert.equal(buildDevisConfig({ devis: { brochure: { file_name: 'B.pdf' } } }).brochure, null);
});
