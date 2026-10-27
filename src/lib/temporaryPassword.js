// src/lib/temporaryPassword.js
// ============================================================================
// Mot de passe provisoire pour un membre (Settings → Équipe → « Réinitialiser le
// mot de passe »). Module PUR (aucun import), testé par
// `node --test scripts/temporary-password.test.mjs`.
//
// Alphabet sans caractères ambigus : pas de 0/O, 1/l/I — le mot de passe est
// transmis de vive voix et recopié à la main sur une tablette.
// ============================================================================

export const TEMPORARY_PASSWORD_LENGTH = 12;
export const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * Tire des entiers uniformes dans [0, max) par rejet (pas de biais modulo).
 * @param {number} count
 * @param {number} max
 * @param {(buf: Uint8Array) => Uint8Array} fillRandom - remplit le tableau d'octets aléatoires
 * @returns {number[]}
 */
function uniformIndices(count, max, fillRandom) {
  const limit = 256 - (256 % max);
  const out = [];
  while (out.length < count) {
    const buf = fillRandom(new Uint8Array(count * 2));
    for (let i = 0; i < buf.length && out.length < count; i++) {
      if (buf[i] < limit) out.push(buf[i] % max);
    }
  }
  return out;
}

/**
 * Génère un mot de passe provisoire lisible.
 * @param {object} [opts]
 * @param {number} [opts.length=12]
 * @param {(buf: Uint8Array) => Uint8Array} [opts.fillRandom] - défaut : `crypto.getRandomValues`
 * @returns {string}
 */
export function generateTemporaryPassword({ length = TEMPORARY_PASSWORD_LENGTH, fillRandom } = {}) {
  const fill = fillRandom || ((buf) => globalThis.crypto.getRandomValues(buf));
  const alphabet = TEMPORARY_PASSWORD_ALPHABET;
  return uniformIndices(length, alphabet.length, fill).map((i) => alphabet[i]).join('');
}
