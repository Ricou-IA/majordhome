// scripts/postgrest-utils.test.mjs
// Recherche PostgREST (src/lib/postgrestUtils.js) : une décimale saisie « 7,4 » doit trouver « 7,4 kW » comme « 7.4 kW ».
// L'échappement anti-injection retire la virgule : on la remplace AVANT par « _ » (joker d'un caractère, conservé).
// Run : node --test scripts/postgrest-utils.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapePostgrestSearchTerm, escapeSearchTermKeepingDecimals } from '../src/lib/postgrestUtils.js';

test('une décimale à virgule ou à point devient « _ » (trouve « 7,4 » comme « 7.4 »)', () => {
  assert.equal(escapeSearchTermKeepingDecimals('7,4'), '7_4');
  assert.equal(escapeSearchTermKeepingDecimals('7.4'), '7_4');
  assert.equal(escapeSearchTermKeepingDecimals('trydan 7,4 kw'), 'trydan 7_4 kw');
  assert.equal(escapeSearchTermKeepingDecimals('1,5,2'), '1_5_2');
});

test('le reste de l\'échappement anti-injection est inchangé', () => {
  assert.equal(escapeSearchTermKeepingDecimals('foo,is_archived.eq.false'), escapePostgrestSearchTerm('foo,is_archived.eq.false'));
  assert.equal(escapeSearchTermKeepingDecimals('a,b'), 'a b');
  assert.equal(escapeSearchTermKeepingDecimals('(x):*'), 'x');
  assert.equal(escapeSearchTermKeepingDecimals(null), '');
});
