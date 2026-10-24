// scripts/company-documents.test.mjs — documents de l'entreprise (src/lib/companyDocuments.js)
// node --test scripts/company-documents.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANY_DOCUMENT_KINDS, normalizeCompanyDocuments, expiryStatus,
  buildCompanyDocumentPath, removedDocumentPaths, applyExtraction,
  qualificationsFromDocuments, resolveRgeCertifications, publicQualificationLabel,
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
  assert.deepEqual(out.certifications, [{
    path: 'o/branding/documents/certifications/1-qb.pdf', name: '1-qb.pdf', valid_until: null,
    intitule: '', numero: '', organisme: '', read_status: null,
  }]);
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

const vide = { path: 'p', name: 'n', valid_until: null, intitule: '', numero: '', organisme: '', read_status: null };

test("la lecture IA comble les vides sans écraser une saisie humaine", () => {
  const lu = { lisible: true, intitule: 'QualiBois Air', numero: 'QB 84566', organisme: "Qualit'EnR", valid_until: '2027-03-31' };
  assert.deepEqual(applyExtraction(vide, lu), { ...vide, intitule: 'QualiBois Air', numero: 'QB 84566', organisme: "Qualit'EnR", valid_until: '2027-03-31', read_status: 'ok' });
  const corrige = applyExtraction({ ...vide, numero: 'QB 99999' }, lu);
  assert.equal(corrige.numero, 'QB 99999');
});

test('lecture en échec ou document non reconnu : statut explicite, aucun champ inventé', () => {
  assert.deepEqual(applyExtraction(vide, null), { ...vide, read_status: 'echec' });
  const illisible = applyExtraction(vide, { lisible: false, intitule: null, numero: null, organisme: null, valid_until: null });
  assert.equal(illisible.read_status, 'illisible');
  assert.equal(illisible.intitule, '');
});

test('qualifications « intitulé + numéro », sans intitulé ni certificat expiré', () => {
  const today = new Date(2026, 9, 24);
  const docs = { certifications: [
    { ...vide, intitule: 'QualiBois Air', numero: 'QB 84566', valid_until: '2027-01-01' },
    { ...vide, intitule: 'QualiPAC', numero: '' },
    { ...vide, intitule: 'QualiPV', numero: 'QPV 1', valid_until: '2026-01-01' },
    { ...vide, intitule: '' },
  ] };
  assert.deepEqual(qualificationsFromDocuments(docs, today), ['QualiBois Air QB 84566', 'QualiPAC']);
});

test('source des qualifications : certificats déposés, sinon saisie manuelle historique', () => {
  assert.deepEqual(resolveRgeCertifications({ rge_certifications: ['QualiBois'] }), ['QualiBois']);
  assert.deepEqual(resolveRgeCertifications({}), []);
  const settings = {
    rge_certifications: ['QualiBois'],
    company_documents: { certifications: [{ path: 'x', intitule: 'QualiBois Air', numero: 'QB 84566' }] },
  };
  assert.deepEqual(resolveRgeCertifications(settings), ['QualiBois Air QB 84566']);
});

test("pas de mention « probatoire » dans le libellé montré aux clients", () => {
  assert.equal(publicQualificationLabel('Qualibois module Eau (probatoire)'), 'Qualibois module Eau');
  assert.equal(publicQualificationLabel('QualiPAC module chauffage et ECS (Probatoire)'), 'QualiPAC module chauffage et ECS');
  assert.equal(publicQualificationLabel('QualiPV - probatoire'), 'QualiPV');
  assert.equal(publicQualificationLabel('QualiSol [en cours de validité]'), 'QualiSol');
  assert.equal(publicQualificationLabel('QualiBois Air'), 'QualiBois Air');
  assert.deepEqual(
    qualificationsFromDocuments({ certifications: [{ intitule: 'Qualibois module Eau (probatoire)', numero: 'QB/84566', valid_until: null }] }),
    ['Qualibois module Eau QB/84566'],
  );
});
