// scripts/temporary-password.test.mjs — mot de passe provisoire d'un membre (src/lib/temporaryPassword.js)
// node --test scripts/temporary-password.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTemporaryPassword, TEMPORARY_PASSWORD_ALPHABET, TEMPORARY_PASSWORD_LENGTH,
} from '../src/lib/temporaryPassword.js';

test('12 caractères par défaut, tous dans l’alphabet sans ambiguïté', () => {
  for (let i = 0; i < 50; i++) {
    const pw = generateTemporaryPassword();
    assert.equal(pw.length, TEMPORARY_PASSWORD_LENGTH);
    for (const c of pw) assert.ok(TEMPORARY_PASSWORD_ALPHABET.includes(c), `caractère inattendu « ${c} »`);
  }
});

test('aucun caractère ambigu dans l’alphabet', () => {
  for (const c of '0O1lI') assert.ok(!TEMPORARY_PASSWORD_ALPHABET.includes(c), `« ${c} » est ambigu`);
});

test('longueur paramétrable', () => {
  assert.equal(generateTemporaryPassword({ length: 20 }).length, 20);
});

test('tirage par rejet : les octets hors limite sont ignorés, pas repliés', () => {
  // 255 est hors limite (256 % 54 = 40 → limite 216) : il doit être sauté, pas transformé en 255 % 54.
  const seq = [255, 0, 255, 1, 2];
  let pos = 0;
  const fillRandom = (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = seq[pos++ % seq.length]; return buf; };
  const pw = generateTemporaryPassword({ length: 3, fillRandom });
  const a = TEMPORARY_PASSWORD_ALPHABET;
  assert.equal(pw, `${a[0]}${a[1]}${a[2]}`);
});
