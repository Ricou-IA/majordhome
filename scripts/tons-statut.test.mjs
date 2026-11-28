import test from 'node:test';
import assert from 'node:assert/strict';
import { TONS, toneFor } from '../src/lib/tonsStatut.js';

test('TONS : les cinq tons', () => {
  assert.deepEqual([...TONS], ['neutre', 'info', 'ok', 'attente', 'alerte']);
});

test('lead', () => {
  assert.equal(toneFor('lead', 'nouveau'), 'neutre');
  assert.equal(toneFor('lead', 'contacte'), 'info');
  assert.equal(toneFor('lead', 'rdv_planifie'), 'info');
  assert.equal(toneFor('lead', 'devis_envoye'), 'attente');
  assert.equal(toneFor('lead', 'gagne'), 'ok');
  assert.equal(toneFor('lead', 'perdu'), 'alerte');
});

test('devis', () => {
  assert.equal(toneFor('devis', 'draft'), 'neutre');
  assert.equal(toneFor('devis', 'pending'), 'info');
  assert.equal(toneFor('devis', 'pending', { joursSansRelance: 21 }), 'info');
  assert.equal(toneFor('devis', 'pending', { joursSansRelance: 22 }), 'attente');
  assert.equal(toneFor('devis', 'expired'), 'alerte');
  assert.equal(toneFor('devis', 'accepted'), 'ok');
  assert.equal(toneFor('devis', 'invoiced'), 'ok');
  assert.equal(toneFor('devis', 'refused'), 'alerte');
  assert.equal(toneFor('devis', 'denied'), 'alerte');
  assert.equal(toneFor('devis', 'canceled'), 'alerte');
});

test('chantier', () => {
  assert.equal(toneFor('chantier', 'gagne'), 'attente');
  assert.equal(toneFor('chantier', 'commande_a_faire'), 'attente');
  assert.equal(toneFor('chantier', 'commande_recue'), 'attente');
  assert.equal(toneFor('chantier', 'planification'), 'info');
  assert.equal(toneFor('chantier', 'realise'), 'ok');
  assert.equal(toneFor('chantier', 'facture'), 'ok');
});

test('contrat (contracts.status + états dérivés)', () => {
  assert.equal(toneFor('contrat', 'active'), 'ok');
  assert.equal(toneFor('contrat', 'pending'), 'neutre');
  assert.equal(toneFor('contrat', 'cancelled'), 'neutre');
  assert.equal(toneFor('contrat', 'proposal_sent'), 'attente');
  assert.equal(toneFor('contrat', 'archived'), 'neutre');
  assert.equal(toneFor('contrat', 'expired'), 'alerte');
  assert.equal(toneFor('contrat', 'a_renouveler'), 'attente');
});

test('entretien (workflow_status entretien + SAV)', () => {
  assert.equal(toneFor('entretien', 'demande'), 'alerte');
  assert.equal(toneFor('entretien', 'urgent'), 'alerte');
  assert.equal(toneFor('entretien', 'devis_envoye'), 'attente');
  assert.equal(toneFor('entretien', 'pieces_commandees'), 'attente');
  assert.equal(toneFor('entretien', 'demande_contrat'), 'attente');
  assert.equal(toneFor('entretien', 'a_planifier'), 'info');
  assert.equal(toneFor('entretien', 'planifie'), 'info');
  assert.equal(toneFor('entretien', 'certificat_a_faire'), 'info');
  assert.equal(toneFor('entretien', 'realise'), 'ok');
  assert.equal(toneFor('entretien', 'facture'), 'ok');
});

test('ne lève jamais : inconnu, vide, null, mauvais type', () => {
  assert.equal(toneFor('lead', 'statut_inconnu'), 'neutre');
  assert.equal(toneFor('devis', null), 'neutre');
  assert.equal(toneFor('devis', undefined), 'neutre');
  assert.equal(toneFor('devis', ''), 'neutre');
  assert.equal(toneFor('domaine_inconnu', 'x'), 'neutre');
  assert.equal(toneFor(undefined, 'x'), 'neutre');
  assert.equal(toneFor('lead', 'Gagné'), 'neutre'); // clés stockées, pas libellés
  assert.equal(toneFor('lead', ' gagne '), 'ok'); // espaces rognés
  assert.equal(toneFor('constructor', 'toString'), 'neutre');
  assert.equal(toneFor('lead', '__proto__'), 'neutre');
});

test('cee : verdict BAR-TH-112 d’un poêle (src/lib/cee/barTh112.js)', () => {
  assert.equal(toneFor('cee', 'conforme'), 'ok');
  assert.equal(toneFor('cee', 'hors_seuil'), 'alerte');
  assert.equal(toneFor('cee', 'incomplet'), 'attente');
  assert.equal(toneFor('cee', 'inconnu'), 'neutre');
});
