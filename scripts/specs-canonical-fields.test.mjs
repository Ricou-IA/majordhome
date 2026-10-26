// scripts/specs-canonical-fields.test.mjs
// canonicalFieldsForCategory (src/shared/specs/index.js) : champs de schéma d'une catégorie pour les caractéristiques d'un devis.
// index.js importe ses schémas sans extension (résolution Vite) : un hook de résolution minimal l'accepte sous Node.
// Run : node --test scripts/specs-canonical-fields.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.')) return next(specifier + '.js', context); throw e; }
}`));

const { canonicalFieldsForCategory } = await import('../src/shared/specs/index.js');

test('poêle : liste non vide, sans champ documents', () => {
  const champs = canonicalFieldsForCategory('poele');
  assert.ok(champs.length > 0);
  assert.ok(champs.every((f) => f.group !== 'documents'));
});

test('batterie et photovoltaïque ont aussi leur schéma', () => {
  assert.ok(canonicalFieldsForCategory('batterie').length > 0);
  assert.ok(canonicalFieldsForCategory('photovoltaique').length > 0);
});

test('catégorie sans schéma ou nulle : liste vide', () => {
  assert.deepEqual(canonicalFieldsForCategory('climatisation'), []);
  assert.deepEqual(canonicalFieldsForCategory(null), []);
});
