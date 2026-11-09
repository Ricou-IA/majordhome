import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devisDeReference, montantDevisSav, effetDevisSurCarte, leadDepuisCarteSav } from '../src/lib/savDevis.js';

const q = (extra = {}) => ({ id: 'q', status: 'brouillon', total_ht: 100, created_at: '2026-11-09T10:00:00Z', ...extra });

test('devisDeReference : le plus récent non refusé, quel que soit l’ordre reçu', () => {
  assert.equal(devisDeReference(null), null);
  assert.equal(devisDeReference([]), null);
  const quotes = [
    q({ id: 'ancien', created_at: '2026-11-01T10:00:00Z', status: 'envoye' }),
    q({ id: 'refuse-recent', created_at: '2026-11-09T10:00:00Z', status: 'refuse' }),
    q({ id: 'milieu', created_at: '2026-11-05T10:00:00Z' }),
  ];
  assert.equal(devisDeReference(quotes).id, 'milieu');
  assert.equal(devisDeReference([q({ status: 'refuse' })]), null);
});

test('montantDevisSav : le devis fléché prime sur la saisie manuelle', () => {
  assert.equal(montantDevisSav({ sav_quotes: [q({ total_ht: '180.50' })], devis_amount: 999 }), 180.5);
  assert.equal(montantDevisSav({ sav_quotes: [], devis_amount: '250' }), 250);
  assert.equal(montantDevisSav({ devis_amount: null }), 0);
  assert.equal(montantDevisSav(null), 0);
});

test('montantDevisSav : un devis fléché à 0 € vaut 0, tous refusés ⇒ retour à la saisie manuelle', () => {
  assert.equal(montantDevisSav({ sav_quotes: [q({ total_ht: 0 })], devis_amount: 300 }), 0);
  assert.equal(montantDevisSav({ sav_quotes: [q({ status: 'refuse', total_ht: 500 })], devis_amount: 300 }), 300);
});

test('effetDevisSurCarte : envoyé ⇒ Devis envoyé depuis Demande seulement', () => {
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'demande', devis_status: null }, q({ status: 'envoye' })),
    { devisStatus: 'envoye', workflow: 'devis_envoye' });
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'a_planifier', devis_status: null }, q({ status: 'envoye' })),
    { devisStatus: 'envoye', workflow: null });
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'devis_envoye', devis_status: 'envoye' }, q({ status: 'envoye' })),
    { devisStatus: null, workflow: null });
});

test('effetDevisSurCarte : accepté ⇒ Pièces commandées, jamais de retour en arrière', () => {
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'devis_envoye', devis_status: 'envoye' }, q({ status: 'accepte' })),
    { devisStatus: 'accepte', workflow: 'pieces_commandees' });
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'demande', devis_status: null }, q({ status: 'accepte' })),
    { devisStatus: 'accepte', workflow: 'pieces_commandees' });
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'planifie', devis_status: 'envoye' }, q({ status: 'accepte' })),
    { devisStatus: 'accepte', workflow: null });
});

test('effetDevisSurCarte : refusé ne déplace pas la carte, brouillon et expiré ne changent rien', () => {
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'devis_envoye', devis_status: 'envoye' }, q({ status: 'refuse' })),
    { devisStatus: 'refuse', workflow: null });
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'demande', devis_status: null }, q()), { devisStatus: null, workflow: null });
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'demande', devis_status: null }, q({ status: 'expire' })), { devisStatus: null, workflow: null });
  assert.deepEqual(effetDevisSurCarte({ workflow_status: 'demande' }, null), { devisStatus: null, workflow: null });
});

test('leadDepuisCarteSav : pas d’id (aucun lead), identité et adresse du client', () => {
  const lead = leadDepuisCarteSav({
    client_id: 'cli-1', client_name: 'GRAHOVAC SYLVIE', client_first_name: 'SYLVIE', client_last_name: 'GRAHOVAC',
    client_address: '1497F CHEMIN DE L’EVEQUE', client_postal_code: '82290', client_city: 'MONTBETON',
    client_phone: '0611719929', client_email: 'a@b.fr',
  });
  assert.equal(lead.id, null);
  assert.equal(lead.client_id, 'cli-1');
  assert.equal(lead.first_name, 'SYLVIE');
  assert.equal(lead.last_name, 'GRAHOVAC');
  assert.equal(lead.postal_code, '82290');
  assert.equal(lead.email, 'a@b.fr');
});

test('leadDepuisCarteSav : sans prénom / nom séparés, le nom complet sert de nom', () => {
  const lead = leadDepuisCarteSav({ client_id: 'cli-2', client_name: 'SCI DES TILLEULS' });
  assert.equal(lead.last_name, 'SCI DES TILLEULS');
  assert.equal(lead.first_name, '');
});
