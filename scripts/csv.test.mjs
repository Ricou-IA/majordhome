import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/lib/csv.js';

test('toCsv — entete + ligne simple', () => {
  const out = toCsv([{ a: 1, b: 'x' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]);
  assert.equal(out, 'A,B\r\n1,x');
});

test('toCsv — echappe virgule, guillemet, retour ligne', () => {
  const out = toCsv([{ a: 'hello, "world"\nl2' }], [{ key: 'a', label: 'A' }]);
  assert.equal(out, 'A\r\n"hello, ""world""\nl2"');
});

test('toCsv — null/undefined -> vide, objet -> json', () => {
  const out = toCsv(
    [{ a: null, b: undefined, c: { q: 2 } }],
    [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]
  );
  assert.equal(out, 'A,B,C\r\n,,"{""q"":2}"');
});

test('toCsv — sans lignes -> entete seule', () => {
  assert.equal(toCsv([], [{ key: 'a', label: 'A' }]), 'A');
});
