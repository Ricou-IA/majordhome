import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remplacerGris } from './gris.mjs';

test('gris et slate passent sur secondary, variantes comprises', () => {
  assert.equal(remplacerGris('className="bg-gray-100 text-slate-500 hover:border-gray-200"'),
    'className="bg-secondary-100 text-secondary-500 hover:border-secondary-200"');
});

test('suffixes d\'opacité et dégradés conservés', () => {
  assert.equal(remplacerGris('className="divide-slate-100 ring-gray-300/50 from-slate-50"'),
    'className="divide-secondary-100 ring-secondary-300/50 from-secondary-50"');
  assert.equal(remplacerGris('border-t-gray-200 border-x-slate-300'),
    'border-t-secondary-200 border-x-secondary-300');
});

test('ce qui n\'est pas une classe utilitaire reste intact', () => {
  assert.equal(remplacerGris("import x from 'gray-matter'"), "import x from 'gray-matter'");
  assert.equal(remplacerGris("const c = '#64748b'"), "const c = '#64748b'");
  assert.equal(remplacerGris("label: 'slate-500'"), "label: 'slate-500'");
  assert.equal(remplacerGris('mon-bg-gray-100'), 'mon-bg-gray-100');
});
