import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PV_DOSSIER_STATUSES,
  statusRank,
  canAdvance,
} from '../src/apps/solaire/lib/pvDossierStatus.js';

test('les 7 états sont ordonnés, offre en premier', () => {
  assert.equal(PV_DOSSIER_STATUSES[0], 'offre');
  assert.equal(PV_DOSSIER_STATUSES.length, 7);
  assert.equal(PV_DOSSIER_STATUSES.at(-1), 'projet_en_service');
});

test('statusRank : rang croissant, null si inconnu', () => {
  assert.equal(statusRank('offre'), 0);
  assert.equal(statusRank('dossier_valide'), 1);
  assert.equal(statusRank('inconnu'), null);
});

test('canAdvance : autorise strictement vers l’avant', () => {
  assert.equal(canAdvance('offre', 'dossier_valide'), true);
  assert.equal(canAdvance('offre', 'projet_en_service'), true);
});

test('canAdvance : refuse la régression et le sur-place', () => {
  assert.equal(canAdvance('dossier_valide', 'offre'), false);
  assert.equal(canAdvance('offre', 'offre'), false);
});

test('canAdvance : refuse un état inconnu des deux côtés', () => {
  assert.equal(canAdvance('offre', 'inconnu'), false);
  assert.equal(canAdvance('inconnu', 'offre'), false);
});
