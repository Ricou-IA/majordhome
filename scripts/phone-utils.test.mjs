import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMobileFR } from '../src/lib/phoneUtils.js';

test('isMobileFR — mobiles nationaux 06/07', () => {
  assert.equal(isMobileFR('0612345678'), true);
  assert.equal(isMobileFR('0712345678'), true);
  assert.equal(isMobileFR('06 12 34 56 78'), true);
  assert.equal(isMobileFR('06.12.34.56.78'), true);
});

test('isMobileFR — formats internationaux', () => {
  assert.equal(isMobileFR('+33612345678'), true);
  assert.equal(isMobileFR('0033712345678'), true);
  assert.equal(isMobileFR('33612345678'), true);
});

test('isMobileFR — rejette fixes et invalides', () => {
  assert.equal(isMobileFR('0512345678'), false); // fixe 05
  assert.equal(isMobileFR('0123456789'), false); // fixe 01
  assert.equal(isMobileFR(''), false);
  assert.equal(isMobileFR(null), false);
  assert.equal(isMobileFR(undefined), false);
  assert.equal(isMobileFR('bonjour'), false);
});
