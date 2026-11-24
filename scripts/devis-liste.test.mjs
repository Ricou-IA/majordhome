import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrerDevis, compterDevis, statutDevis, STATUTS_DEVIS } from '../src/lib/devisListe.js';

const rows = [
  { id: 1, quote_number: 'DEV-2026-0001', client_display_name: 'Élise DUPONT', subject: 'Poêle à granulés', client_city: 'Gaillac', status: 'brouillon' },
  { id: 2, quote_number: 'DEV-2026-0002', client_display_name: 'Marc Martin', subject: 'PAC air-eau', client_city: 'Albi', status: 'envoye' },
  { id: 3, quote_number: 'DEV-2026-0003', client_display_name: 'Elise Durand', subject: 'Tubage', client_city: 'Lisle', status: 'envoye' },
];

test('la recherche ignore casse et accents, sur numéro, client, objet et ville', () => {
  assert.deepEqual(filtrerDevis(rows, { q: 'elise' }).map((d) => d.id), [1, 3]);
  assert.deepEqual(filtrerDevis(rows, { q: 'POELE' }).map((d) => d.id), [1]);
  assert.deepEqual(filtrerDevis(rows, { q: '0002' }).map((d) => d.id), [2]);
  assert.deepEqual(filtrerDevis(rows, { q: 'albi' }).map((d) => d.id), [2]);
});

test('statut et recherche se cumulent', () => {
  assert.deepEqual(filtrerDevis(rows, { statut: 'envoye', q: 'élise' }).map((d) => d.id), [3]);
  assert.deepEqual(filtrerDevis(rows, { statut: 'envoye' }).map((d) => d.id), [2, 3]);
  assert.equal(filtrerDevis(rows, {}).length, 3);
});

test('les compteurs suivent la recherche en cours', () => {
  const c = compterDevis(rows, 'elise');
  assert.equal(c.tous, 2);
  assert.equal(c.brouillon, 1);
  assert.equal(c.envoye, 1);
  assert.equal(c.accepte, 0);
  assert.equal(compterDevis(rows).tous, 3);
});

test('un statut inconnu reste affiché par son code, ton neutre', () => {
  assert.equal(statutDevis('envoye').label, 'Envoyé');
  assert.deepEqual(statutDevis('xyz'), { value: 'xyz', label: 'xyz', ton: 'neutre' });
  assert.equal(STATUTS_DEVIS.length, 5);
});
