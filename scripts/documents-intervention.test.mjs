// node --test scripts/documents-intervention.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  documentsDeChantier, receptionneSansPv, certificatsParIntervention, documentsDeCarte,
} from '../src/lib/documentsIntervention.js';

test('documentsDeChantier — rien tant que rien n’est signé', () => {
  assert.deepEqual(documentsDeChantier(null), []);
  assert.deepEqual(documentsDeChantier({ chantier_status: 'planification', pv_sent_at: '2026-11-20T10:00:00Z' }), []);
});

test('documentsDeChantier — PV signé en ligne, avec ou sans fichier', () => {
  const [pv] = documentsDeChantier({ pv_signed_at: '2026-11-20T22:45:00Z', pv_avec_reserves: false });
  assert.equal(pv.cle, 'pv_reception');
  assert.equal(pv.enLigne, true);
  assert.equal(pv.avecReserves, false);
  assert.equal(pv.signeLe, '2026-11-20T22:45:00Z');
  assert.equal(documentsDeChantier({ pv_signed_at: '2026-11-20T22:45:00Z', pv_reception_path: 'o/pv/x.pdf' }).length, 1);
});

test('documentsDeChantier — PV signé sur tablette : un fichier, pas de signature en ligne', () => {
  const [pv] = documentsDeChantier({ pv_reception_path: 'o/pv-reception/c/PV_Reception_sur_place.pdf' });
  assert.equal(pv.enLigne, false);
  assert.equal(pv.signeLe, null);
});

test('documentsDeChantier — réserves puis levée : deux documents, dans l’ordre', () => {
  const docs = documentsDeChantier({ pv_signed_at: '2026-11-20T10:00:00Z', pv_avec_reserves: true, pv_reserves_levees_at: '2026-12-09T15:00:00Z' });
  assert.deepEqual(docs.map((d) => d.cle), ['pv_reception', 'pv_levee']);
  assert.equal(docs[0].avecReserves, true);
  assert.equal(docs[1].signeLe, '2026-12-09T15:00:00Z');
  assert.equal(documentsDeChantier({ pv_reception_path: 'a.pdf', pv_levee_path: 'b.pdf' })[1].enLigne, false);
});

test('receptionneSansPv — réception validée sans document', () => {
  assert.equal(receptionneSansPv({ chantier_status: 'realise' }), true);
  assert.equal(receptionneSansPv({ chantier_status: 'facture' }), true);
  assert.equal(receptionneSansPv({ chantier_status: 'realise', pv_signed_at: '2026-11-20T10:00:00Z' }), false);
  assert.equal(receptionneSansPv({ chantier_status: 'planification' }), false);
  assert.equal(receptionneSansPv(null), false);
});

test('certificatsParIntervention — celui qui a son PDF passe devant un brouillon', () => {
  const index = certificatsParIntervention([
    { id: 'a', intervention_id: 'i1', pdf_storage_path: null },
    { id: 'b', intervention_id: 'i1', pdf_storage_path: 'o/cert/b.pdf' },
    { id: 'c', intervention_id: 'i2', pdf_storage_path: 'o/cert/c.pdf' },
    { id: 'd', intervention_id: 'i2', pdf_storage_path: 'o/cert/d.pdf' },
    { id: 'e', intervention_id: null, pdf_storage_path: 'x.pdf' },
  ]);
  assert.equal(index.get('i1').id, 'b');
  assert.equal(index.get('i2').id, 'c');
  assert.equal(index.size, 2);
  assert.equal(certificatsParIntervention(null).size, 0);
});

test('documentsDeCarte — un brouillon de certificat n’est pas un document', () => {
  assert.deepEqual(documentsDeCarte({ id: 'i' }, { pdf_storage_path: null }), []);
  assert.deepEqual(documentsDeCarte({ id: 'i' }, null), []);
});

test('documentsDeCarte — certificat complet, certificat allégé', () => {
  assert.deepEqual(documentsDeCarte({ id: 'i' }, { pdf_storage_path: 'o/c.pdf' }), [
    { cle: 'certificat', libelle: 'Certificat d’entretien', chemin: 'o/c.pdf', depot: 'certificats' },
  ]);
  assert.equal(documentsDeCarte({ id: 'i' }, { pdf_storage_path: 'o/c.pdf', mode: 'allege' })[0].libelle, 'Certificat d’entretien (lettre)');
});

test('documentsDeCarte — rapport SAV archivé, lu dans la trace de la carte', () => {
  const carte = { id: 'i', metadata: { rapport_sav: { path: 'o/p/i/rapport-intervention.pdf', edite_le: '2026-11-19T10:00:00Z' } } };
  assert.deepEqual(documentsDeCarte(carte, null), [
    { cle: 'rapport_sav', libelle: 'Rapport d’intervention', chemin: 'o/p/i/rapport-intervention.pdf', depot: 'interventions' },
  ]);
  assert.deepEqual(documentsDeCarte({ id: 'i', metadata: { rapport_sav: { path: '' } } }, null), []);
  // Un SAV avec entretien peut porter les deux.
  assert.equal(documentsDeCarte(carte, { pdf_storage_path: 'o/c.pdf' }).length, 2);
});
