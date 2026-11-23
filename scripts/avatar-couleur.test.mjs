import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_AVATAR, couleurAvatar, initiales } from '../src/lib/avatarCouleur.js';

test('la couleur d’un avatar est déterministe et prise dans la palette', () => {
  assert.equal(couleurAvatar('abc'), couleurAvatar('abc'));
  assert.ok(PALETTE_AVATAR.includes(couleurAvatar('x-1')));
  assert.equal(PALETTE_AVATAR.length, 6);
});

test('un identifiant vide ou absent ne lève pas', () => {
  assert.ok(PALETTE_AVATAR.includes(couleurAvatar('')));
  assert.ok(PALETTE_AVATAR.includes(couleurAvatar(null)));
  assert.ok(PALETTE_AVATAR.includes(couleurAvatar(undefined)));
});

test('les identifiants se répartissent sur plusieurs teintes', () => {
  const vues = new Set(Array.from({ length: 50 }, (_, i) => couleurAvatar(`id-${i}`)));
  assert.ok(vues.size >= 4);
});

test('initiales : deux lettres au plus, majuscules, « ? » si rien', () => {
  assert.equal(initiales('Philippe Mayer'), 'PM');
  assert.equal(initiales('  eric  '), 'E');
  assert.equal(initiales(''), '?');
  assert.equal(initiales(null), '?');
  assert.equal(initiales('Jean Pierre Dupont'), 'JD');
});
