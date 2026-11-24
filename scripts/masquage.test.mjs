import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masquerIban, masquerIdentifiant } from '../src/lib/masquage.js';

test('IBAN : pays et clé, puis les quatre derniers caractères', () => {
  assert.equal(masquerIban('FR76 3000 6000 0112 3456 7890 189'), 'FR76 •••• •••• 0189');
  assert.equal(masquerIban('fr7630006000011234567890189'), 'FR76 •••• •••• 0189');
  assert.equal(masquerIban(''), '');
  assert.equal(masquerIban(null), '');
  assert.equal(masquerIban('FR76'), '•••• ••••');
});

test('identifiant : préfixe technique gardé, fin visible, jamais en clair', () => {
  const id = 'agent_3101m42037pbepbvh52d81h8nn8w';
  const m = masquerIdentifiant(id);
  assert.equal(m, 'agent_•••• 8nn8w');
  assert.ok(!m.includes('3101m42037'));
  assert.equal(masquerIdentifiant(''), '');
  assert.equal(masquerIdentifiant('abc'), '••••');
});
