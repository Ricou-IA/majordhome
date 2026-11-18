// Chemin des fichiers de la fiche d'intervention (photos, signature) dans le dossier Storage
// `interventions` : le premier segment doit être l'organisation, sinon les règles d'accès refusent.
// Lancer : node --test scripts/intervention-storage-path.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInterventionStoragePath } from '../src/lib/interventionStoragePath.js';

const ORG = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
const PROJET = '11111111-1111-1111-1111-111111111111';
const INTERVENTION = '22222222-2222-2222-2222-222222222222';

test('le premier segment est l\'organisation, puis projet, intervention, fichier', () => {
  const chemin = buildInterventionStoragePath({ orgId: ORG, projectId: PROJET, interventionId: INTERVENTION, fileType: 'photo_before', extension: 'jpg', now: 1700000000000 });
  assert.equal(chemin, `${ORG}/${PROJET}/${INTERVENTION}/photo_before_1700000000000.jpg`);
  assert.equal(chemin.split('/')[0], ORG);
});

test('signature : même dossier, extension png', () => {
  const chemin = buildInterventionStoragePath({ orgId: ORG, projectId: PROJET, interventionId: INTERVENTION, fileType: 'signature', extension: 'png', now: 1 });
  assert.equal(chemin, `${ORG}/${PROJET}/${INTERVENTION}/signature_1.png`);
});

test('sans organisation valable : refus, jamais un chemin qui commence par le projet', () => {
  for (const orgId of [undefined, null, '', 'undefined', 'mayer']) {
    assert.throws(() => buildInterventionStoragePath({ orgId, projectId: PROJET, interventionId: INTERVENTION, fileType: 'photo_after' }), /organisation requise/);
  }
});

test('projet, intervention ou type manquant : refus', () => {
  assert.throws(() => buildInterventionStoragePath({ orgId: ORG, projectId: '', interventionId: INTERVENTION, fileType: 'photo_after' }), /requis/);
  assert.throws(() => buildInterventionStoragePath({ orgId: ORG, projectId: PROJET, interventionId: null, fileType: 'photo_after' }), /requis/);
  assert.throws(() => buildInterventionStoragePath({ orgId: ORG, projectId: PROJET, interventionId: INTERVENTION, fileType: '' }), /requis/);
});
