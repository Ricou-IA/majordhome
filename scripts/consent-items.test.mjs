// scripts/consent-items.test.mjs
// Tests de la liste de consentements v1 (src/apps/solaire/lib/consentItems.js — pur, brandé).
// Run : node --test scripts/consent-items.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentItems } from '../src/apps/solaire/lib/consentItems.js';

test('buildConsentItems — 2 items requis, texte brandé du nom de société', () => {
  const items = buildConsentItems('Mayer Énergie');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.key), ['dp_depot', 'enedis_raccordement']);
  assert.ok(items.every((i) => i.required === true));
  assert.match(items[0].legalText, /Mayer Énergie/);
  assert.match(items[0].legalText, /déclaration préalable/i);
  assert.match(items[1].legalText, /ENEDIS/);
});

test('buildConsentItems — nom vide → fallback neutre « Votre entreprise »', () => {
  const items = buildConsentItems('');
  assert.match(items[0].legalText, /Votre entreprise/);
});
