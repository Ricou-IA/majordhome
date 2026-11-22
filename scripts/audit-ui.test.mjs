import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compterMotifs, ECRANS_GEOMETRIE_FIXE } from './audit-ui.mjs';

test('un exemple de chaque motif', () => {
  assert.deepEqual(compterMotifs('<p className="text-[10px] text-blue-600">🔥</p>'),
    { petitTexte: 1, couleurEnDur: 1, ancienBleu: 0, emoji: 1 });
});
test('ancien bleu, insensible à la casse', () => {
  assert.equal(compterMotifs('color: "#0369a1"').ancienBleu, 1);
  assert.equal(compterMotifs('color: "#0369A1"').ancienBleu, 1);
});
test('12 px et plus ne sont pas un petit texte', () => {
  assert.equal(compterMotifs('className="text-[12px] text-st-info"').petitTexte, 0);
  assert.equal(compterMotifs('className="text-[11.5px]"').petitTexte, 1);
});
test('une classe de couleur en dur compte une fois, variantes comprises', () => {
  assert.equal(compterMotifs('className="bg-sky-100 text-indigo-700 border-slate-200"').couleurEnDur, 3);
  assert.equal(compterMotifs('className="hover:bg-blue-600"').couleurEnDur, 1);
  assert.equal(compterMotifs('className="md:hover:text-gray-500"').couleurEnDur, 1);
  assert.equal(compterMotifs('className="bg-secondary-100 text-primary-600"').couleurEnDur, 0);
});
test('la liste blanche porte des chemins relatifs avec des /', () => {
  assert.ok(ECRANS_GEOMETRIE_FIXE.length > 0);
  for (const p of ECRANS_GEOMETRIE_FIXE) assert.match(p, /^src\/[^\\]+$/);
});
