import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMobileFR } from '../src/lib/phoneUtils.js';
import { formatPhoneDisplay } from '../src/lib/utils.js';

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

test('formatPhoneDisplay — un numéro national compact est aéré XX XX XX XX XX', () => {
  assert.equal(formatPhoneDisplay('0682347660'), '06 82 34 76 60');
  assert.equal(formatPhoneDisplay('06 82 34 76 60'), '06 82 34 76 60'); // déjà formaté : idempotent
  assert.equal(formatPhoneDisplay('06.82.34.76.60'), '06 82 34 76 60');
  assert.equal(formatPhoneDisplay('05-63-12-34-56'), '05 63 12 34 56'); // fixe aussi
});

test('formatPhoneDisplay — tout ce qui n’est pas 10 chiffres est rendu tel quel, jamais tronqué', () => {
  assert.equal(formatPhoneDisplay('+33682347660'), '+33682347660');
  assert.equal(formatPhoneDisplay('0682347660 / 0563123456'), '0682347660 / 0563123456');
  assert.equal(formatPhoneDisplay('0682347660 poste 12'), '0682347660 poste 12');
  assert.equal(formatPhoneDisplay('06 82 34'), '06 82 34'); // saisie en cours
  assert.equal(formatPhoneDisplay(''), '');
  assert.equal(formatPhoneDisplay(null), '');
  assert.equal(formatPhoneDisplay(undefined), '');
});
