// scripts/pennylane-customer-requirements.test.mjs
// Champs d'une fiche client exigés par Pennylane (src/lib/pennylaneCustomerRequirements.js).
// Run : node --test scripts/pennylane-customer-requirements.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { champsClientManquantsPourPennylane, messageClientIncompletPennylane } from '../src/lib/pennylaneCustomerRequirements.js';

const cles = (client) => champsClientManquantsPourPennylane(client).map((m) => m.key);

test('particulier complet : rien ne manque', () => {
  assert.deepEqual(cles({ first_name: 'PHILIPPE', last_name: 'FONTA', address: '3 rue des Lilas', postal_code: '81370', city: 'Saint-Sulpice' }), []);
});

test('particulier converti depuis un lead sans adresse : adresse, code postal, ville', () => {
  assert.deepEqual(cles({ first_name: 'PHILIPPE', last_name: 'FONTA', address: null, postal_code: null, city: null }), ['address', 'postal_code', 'city']);
});

test('un complément d\'adresse seul suffit pour l\'adresse (même règle que le service)', () => {
  assert.deepEqual(cles({ first_name: 'A', last_name: 'B', address: '', address_complement: 'Bât. C', postal_code: '81000', city: 'Albi' }), []);
});

test('une adresse faite d\'espaces compte comme absente', () => {
  assert.deepEqual(cles({ first_name: 'A', last_name: 'B', address: '   ', postal_code: '81000', city: 'Albi' }), ['address']);
});

test('particulier sans nom : prénom et nom demandés avant l\'adresse', () => {
  assert.deepEqual(cles({ address: 'x', postal_code: '81000', city: 'Albi' }), ['first_name', 'last_name']);
});

test('entreprise : raison sociale exigée, pas le prénom / nom', () => {
  assert.deepEqual(cles({ client_category: 'entreprise', display_name: '', first_name: '', last_name: '', address: 'x', postal_code: '81000', city: 'Albi' }), ['company_name']);
  assert.deepEqual(cles({ client_category: 'entreprise', display_name: 'SDIS 81', address: 'x', postal_code: '81000', city: 'Albi' }), []);
});

test('client absent : tout manque, sans planter', () => {
  assert.deepEqual(cles(null), ['first_name', 'last_name', 'address', 'postal_code', 'city']);
});

test('les libellés sont en français et le message reprend celui du service', () => {
  const m = champsClientManquantsPourPennylane({ first_name: 'A', last_name: 'B' });
  assert.deepEqual(m.map((x) => x.label), ['adresse', 'code postal', 'ville']);
  assert.equal(messageClientIncompletPennylane(m), 'Fiche client incomplète pour Pennylane : adresse, code postal, ville manquant(s)');
});
