// scripts/company-documents.test.mjs — documents de l'entreprise (src/lib/companyDocuments.js)
// node --test scripts/company-documents.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANY_DOCUMENT_KINDS, normalizeCompanyDocuments, expiryStatus,
  buildCompanyDocumentPath, removedDocumentPaths,
} from '../src/lib/companyDocuments.js';

test('normalise un réglage absent en tableaux vides pour chaque nature', () => {
  const out = normalizeCompanyDocuments(undefined);
  assert.deepEqual(Object.keys(out), COMPANY_DOCUMENT_KINDS.map((k) => k.key));
  for (const list of Object.values(out)) assert.deepEqual(list, []);
});

test('écarte les entrées sans chemin et complète nom / date', () => {
  const out = normalizeCompanyDocuments({
    certifications: [{ path: 'o/branding/documents/certifications/1-qb.pdf' }, { name: 'sans chemin' }, null],
    attestation_assurance: 'pas un tableau',
  });
  assert.deepEqual(out.certifications, [{ path: 'o/branding/documents/certifications/1-qb.pdf', name: '1-qb.pdf', valid_until: null }]);
  assert.deepEqual(out.attestation_assurance, []);
});

test('validité : aucune, valide, bientôt (≤ 30 j), expirée', () => {
  const today = new Date(2026, 9, 24);
  assert.equal(expiryStatus(null, today), 'none');
  assert.equal(expiryStatus('n/a', today), 'none');
  assert.equal(expiryStatus('2027-01-01', today), 'valid');
  assert.equal(expiryStatus('2026-11-23', today), 'soon');
  assert.equal(expiryStatus('2026-10-24', today), 'soon');
  assert.equal(expiryStatus('2026-10-23', today), 'expired');
});

test('chemin horodaté, préfixé org, nom assaini', () => {
  assert.equal(
    buildCompanyDocumentPath('org-1', 'certifications', 'Qualibois ÉLITE 2026 (1).PDF', 42),
    'org-1/branding/documents/certifications/42-Qualibois-ELITE-2026-1.pdf',
  );
  assert.equal(buildCompanyDocumentPath('o', 'attestation_fluides', '###', 1), 'o/branding/documents/attestation_fluides/1-document');
});

test('chemins retirés entre deux états', () => {
  const before = { certifications: [{ path: 'a' }, { path: 'b' }], attestation_assurance: [{ path: 'c' }] };
  const after = { certifications: [{ path: 'b' }], attestation_assurance: [{ path: 'd' }] };
  assert.deepEqual(removedDocumentPaths(before, after), ['a', 'c']);
});
