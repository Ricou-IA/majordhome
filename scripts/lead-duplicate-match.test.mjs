import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhoneKey,
  normalizeEmailKey,
  normalizeNameKey,
  buildDuplicateProbe,
  matchLeadDuplicates,
} from '../src/lib/leadDuplicateMatch.js';

// ============================================================================
// normalizePhoneKey
// ============================================================================

test('normalizePhoneKey — formats FR équivalents vers la même clé', () => {
  assert.equal(normalizePhoneKey('06 10 36 56 72'), '0610365672');
  assert.equal(normalizePhoneKey('0610365672'), '0610365672');
  assert.equal(normalizePhoneKey('06.10.36.56.72'), '0610365672');
  assert.equal(normalizePhoneKey('06-10-36-56-72'), '0610365672');
  assert.equal(normalizePhoneKey('+33 6 10 36 56 72'), '0610365672');
  assert.equal(normalizePhoneKey('0033610365672'), '0610365672');
  assert.equal(normalizePhoneKey('33610365672'), '0610365672');
});

test('normalizePhoneKey — inexploitable → null', () => {
  assert.equal(normalizePhoneKey(null), null);
  assert.equal(normalizePhoneKey(''), null);
  assert.equal(normalizePhoneKey('bonjour'), null);
  assert.equal(normalizePhoneKey('06 10'), null); // trop court
});

test('normalizePhoneKey — numéro étranger laissé tel quel', () => {
  assert.equal(normalizePhoneKey('+34 612 345 678'), '34612345678');
});

// ============================================================================
// normalizeEmailKey / normalizeNameKey
// ============================================================================

test('normalizeEmailKey — trim + lowercase, exige un @', () => {
  assert.equal(normalizeEmailKey(' RodoSophie@Gmail.com '), 'rodosophie@gmail.com');
  assert.equal(normalizeEmailKey('pas-un-email'), null);
  assert.equal(normalizeEmailKey(''), null);
  assert.equal(normalizeEmailKey(null), null);
});

test('normalizeNameKey — exige nom ET prénom', () => {
  assert.deepEqual(normalizeNameKey('Sophie', 'Rodoru'), { first: 'SOPHIE', last: 'RODORU' });
  assert.equal(normalizeNameKey('', 'Rodoru'), null);
  assert.equal(normalizeNameKey('Sophie', ''), null);
  assert.equal(normalizeNameKey(null, null), null);
});

// ============================================================================
// buildDuplicateProbe
// ============================================================================

test('buildDuplicateProbe — null si aucun axe exploitable', () => {
  assert.equal(buildDuplicateProbe({}), null);
  assert.equal(buildDuplicateProbe({ phone: '06', email: 'x', firstName: 'A' }), null);
});

test('buildDuplicateProbe — un seul axe suffit', () => {
  const probe = buildDuplicateProbe({ phone: '06 10 36 56 72' });
  assert.equal(probe.phoneKey, '0610365672');
  assert.equal(probe.emailKey, null);
  assert.equal(probe.nameKey, null);
});

// ============================================================================
// matchLeadDuplicates
// ============================================================================

const CANDIDATES = [
  { id: 'a', first_name: 'SOPHIE', last_name: 'RODORU', phone: '06 10 36 56 72', email: 'rodosophie@gmail.com' },
  { id: 'b', first_name: 'MICHEL', last_name: 'RODORU', phone: '07 00 00 00 00', email: null },
  { id: 'c', first_name: null, last_name: 'DURAND', phone: null, email: 'durand@free.fr' },
];

test('matchLeadDuplicates — match téléphone malgré formats différents', () => {
  const probe = buildDuplicateProbe({ phone: '+33610365672' });
  const out = matchLeadDuplicates(CANDIDATES, probe);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a');
  assert.deepEqual(out[0].matchReasons, ['phone']);
});

test('matchLeadDuplicates — cumul des raisons (phone + email + nom)', () => {
  const probe = buildDuplicateProbe({
    phone: '0610365672', email: 'RODOSOPHIE@GMAIL.COM', firstName: 'sophie', lastName: 'rodoru',
  });
  const out = matchLeadDuplicates(CANDIDATES, probe);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].matchReasons, ['phone', 'email', 'name']);
});

test('matchLeadDuplicates — homonyme de famille seul ne matche PAS', () => {
  // Même nom de famille, prénom différent : pas un doublon (père/fils, fratrie).
  const probe = buildDuplicateProbe({ firstName: 'Sophie', lastName: 'Rodoru' });
  const out = matchLeadDuplicates(CANDIDATES, probe);
  assert.equal(out.length, 1); // seul 'a' (prénom identique), pas 'b'
  assert.equal(out[0].id, 'a');
});

test('matchLeadDuplicates — candidat sans prénom ne matche pas par nom', () => {
  const probe = buildDuplicateProbe({ firstName: 'Jean', lastName: 'Durand' });
  assert.equal(matchLeadDuplicates(CANDIDATES, probe).length, 0);
});

test('matchLeadDuplicates — probe null ou candidats invalides → []', () => {
  assert.deepEqual(matchLeadDuplicates(CANDIDATES, null), []);
  assert.deepEqual(matchLeadDuplicates(null, buildDuplicateProbe({ phone: '0610365672' })), []);
});
