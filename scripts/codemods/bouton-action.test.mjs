import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remplacerBoutonAction } from './bouton-action.mjs';

test('primary-700 + texte blanc passe sur primary-600', () => {
  assert.equal(remplacerBoutonAction('className="bg-primary-700 text-white hover:bg-primary-800"'),
    'className="bg-primary-600 text-white hover:bg-primary-700"');
});
test('bouton bleu aligné', () => {
  assert.equal(remplacerBoutonAction('className="bg-blue-600 text-white hover:bg-blue-700"'),
    'className="bg-primary-600 text-white hover:bg-primary-700"');
  assert.equal(remplacerBoutonAction('className="bg-indigo-500 px-3 text-white"'),
    'className="bg-primary-600 px-3 text-white"');
});
test('sans texte blanc dans la même chaîne : rien ne change', () => {
  assert.equal(remplacerBoutonAction('className="bg-blue-50 text-blue-700"'), 'className="bg-blue-50 text-blue-700"');
  assert.equal(remplacerBoutonAction('className="bg-primary-700"'), 'className="bg-primary-700"');
});
test('chaque littéral est traité seul', () => {
  const src = 'cn("bg-primary-700 text-white", ok && "bg-primary-700")';
  assert.equal(remplacerBoutonAction(src), 'cn("bg-primary-600 text-white", ok && "bg-primary-700")');
  assert.equal(remplacerBoutonAction('`bg-sky-600 text-white ${x}`'), '`bg-primary-600 text-white ${x}`');
});
test('text-white-ish ne compte pas', () => {
  assert.equal(remplacerBoutonAction('"bg-blue-600 text-white/80"'), '"bg-blue-600 text-white/80"');
});
