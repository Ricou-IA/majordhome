// scripts/pennylane-customer-requirements.test.mjs
// Champs d'une fiche client exigés par Pennylane (src/lib/pennylaneCustomerRequirements.js).
// Run : node --test scripts/pennylane-customer-requirements.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adressesEmail, emailsValides, champsClientManquantsPourPennylane, messageClientIncompletPennylane } from '../src/lib/pennylaneCustomerRequirements.js';

const cles = (client) => champsClientManquantsPourPennylane(client).map((m) => m.key);
const COMPLET = { first_name: 'A', last_name: 'B', address: 'x', postal_code: '81000', city: 'Albi' };

test('e-mail absent : Pennylane ne l\'exige pas, rien n\'est demandé', () => {
  for (const email of [undefined, null, '', '   ']) assert.deepEqual(cles({ ...COMPLET, email }), []);
});

test('adresses réellement refusables de la prod : e-mail demandé', () => {
  for (const email of [
    'pratpastat@gmail..com', // le 422 du 2026-11-04 (CLI-03819)
    'cedric.malroux@gmail',
    'germafrancoise@outlook',
    'eric.robert81000orange.fr',
    'angelique9292gmail.com',
    'mcs@laurent@gmail.com',
    'adeline.fraysse@-nmp',
    'mairie-réalmont@wanadoo.fr',
    'rivière.richard@outlook.fr',
    'a..b@gmail.com',
    '.a@gmail.com',
  ]) assert.deepEqual(cles({ ...COMPLET, email }), ['email'], email);
});

test('adresses valides : rien n\'est demandé', () => {
  for (const email of ['jean.dupont@gmail.com', 'J.Dupont+devis@Mairie-Albi.fr', ' a@b.fr ', "o'neil@orange.fr"]) {
    assert.deepEqual(cles({ ...COMPLET, email }), [], email);
  }
});

test('plusieurs adresses sur la fiche : valides ensemble, une seule mauvaise suffit à demander', () => {
  assert.deepEqual(cles({ ...COMPLET, email: 'a@veolia.com, b@veolia.com; c@veolia.com' }), []);
  assert.deepEqual(cles({ ...COMPLET, email: 'a@veolia.com, b@gmail..com' }), ['email']);
});

test('adressesEmail découpe la saisie pour le tableau `emails` de Pennylane', () => {
  assert.deepEqual(adressesEmail('a@x.fr, b@x.fr;c@x.fr  d@x.fr'), ['a@x.fr', 'b@x.fr', 'c@x.fr', 'd@x.fr']);
  assert.deepEqual(adressesEmail(' a@x.fr '), ['a@x.fr']);
  assert.deepEqual(adressesEmail(null), []);
  assert.deepEqual(adressesEmail(''), []);
});

test('emailsValides : vide accepté (e-mail facultatif)', () => {
  assert.equal(emailsValides(''), true);
  assert.equal(emailsValides(null), true);
  assert.equal(emailsValides('a@x.fr'), true);
  assert.equal(emailsValides('a@x..fr'), false);
});

test('e-mail demandé après les champs obligatoires, message en clair', () => {
  const m = champsClientManquantsPourPennylane({ first_name: 'A', last_name: 'B', address: 'x', postal_code: '81000', email: 'a@x..fr' });
  assert.deepEqual(m.map((x) => x.key), ['city', 'email']);
  assert.equal(messageClientIncompletPennylane(m), 'Fiche client incomplète pour Pennylane : ville, e-mail valide manquant(s)');
});

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
