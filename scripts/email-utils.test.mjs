// scripts/email-utils.test.mjs
// Adresses e-mail saisies sur une fiche (src/lib/emailUtils.js).
// Run : node --test scripts/email-utils.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adressesEmail, emailsValides, emailRefuse } from '../src/lib/emailUtils.js';

test('adresses invalides relevées en prod', () => {
  for (const email of [
    'pratpastat@gmail..com',
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
  ]) assert.equal(emailsValides(email), false, email);
});

test('adresses valides, y compris plusieurs sur une même fiche', () => {
  for (const email of [
    'jean.dupont@gmail.com',
    'J.Dupont+devis@Mairie-Albi.fr',
    ' a@b.fr ',
    "o'neil@orange.fr",
    'a@veolia.com, b@veolia.com; c@veolia.com',
  ]) assert.equal(emailsValides(email), true, email);
  assert.equal(emailsValides('a@veolia.com, b@gmail..com'), false);
});

test('vide accepté : l\'e-mail est facultatif', () => {
  for (const email of [undefined, null, '', '   ']) assert.equal(emailsValides(email), true);
});

test('adressesEmail découpe la saisie pour le tableau `emails` de Pennylane', () => {
  assert.deepEqual(adressesEmail('a@x.fr, b@x.fr;c@x.fr  d@x.fr'), ['a@x.fr', 'b@x.fr', 'c@x.fr', 'd@x.fr']);
  assert.deepEqual(adressesEmail(' a@x.fr '), ['a@x.fr']);
  assert.deepEqual(adressesEmail(null), []);
});

test('emailRefuse : nouvelle saisie invalide refusée', () => {
  assert.equal(emailRefuse('pratpastat@gmail..com'), true);
  assert.equal(emailRefuse('pratpastat@gmail..com', null), true);
  assert.equal(emailRefuse('nouvelle@gmail..com', 'ancienne@gmail.com'), true);
  assert.equal(emailRefuse('autre@gmail..com', 'ancienne@gmail..com'), true);
});

test('emailRefuse : une fiche ancienne n\'est pas prise en otage par son adresse inchangée', () => {
  assert.equal(emailRefuse('cedric.malroux@gmail', 'cedric.malroux@gmail'), false);
  assert.equal(emailRefuse(' cedric.malroux@gmail ', 'cedric.malroux@gmail'), false);
});

test('emailRefuse : valide ou vide jamais refusé', () => {
  assert.equal(emailRefuse('a@b.fr'), false);
  assert.equal(emailRefuse('', 'ancienne@gmail..com'), false);
  assert.equal(emailRefuse(null), false);
});
