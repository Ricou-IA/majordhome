import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserArticle } from '../../src/lib/importArticles/normaliser.js';

const MAINTENANT = new Date(2026, 10, 28, 12);
const lire = (champ, brut) => normaliserArticle(champ, brut, MAINTENANT);
const ok = (valeur) => ({ valeur, illisible: false });
const KO = { valeur: null, illisible: true };
const VIDE = { valeur: null, illisible: false };

test('prix', () => {
  assert.deepEqual(lire('prix_vente', '1 234,50 €'), ok(1234.5));
  assert.deepEqual(lire('prix_vente', '1.234,50'), ok(1234.5));
  assert.deepEqual(lire('prix_vente', '12,5'), ok(12.5));
  assert.deepEqual(lire('prix_vente', '12.50'), ok(12.5));
  assert.deepEqual(lire('prix_vente', '1 234'), ok(1234));
  assert.deepEqual(lire('prix_vente', '1 234 €'), ok(1234));
  assert.deepEqual(lire('prix_vente', '1,234.50'), KO);
  assert.deepEqual(lire('prix_vente', '12 %'), KO);
  assert.deepEqual(lire('prix_vente', 'abc'), KO);
  assert.deepEqual(lire('prix_vente', '-3'), KO);
  assert.deepEqual(lire('prix_vente', ''), VIDE);
  assert.deepEqual(lire('prix_vente', null), VIDE);
});

test('TVA', () => {
  for (const v of ['20', '20 %', '0,2', '0.2']) assert.deepEqual(lire('tva', v), ok(20), v);
  for (const v of ['5,5', '0,055']) assert.deepEqual(lire('tva', v), ok(5.5), v);
  assert.deepEqual(lire('tva', '10'), ok(10));
  assert.deepEqual(lire('tva', '0'), ok(0));
  assert.deepEqual(lire('tva', '7'), KO);
  assert.deepEqual(lire('tva', 'x'), KO);
  assert.deepEqual(lire('tva', ' '), VIDE);
});

test('EAN', () => {
  assert.deepEqual(lire('ean', '3 760 123 456 789'), ok('3760123456789'));
  assert.deepEqual(lire('ean', '3760123456789'), ok('3760123456789'));
  // Un export CSV d'un tableur écrit parfois un grand nombre en notation scientifique.
  assert.deepEqual(lire('ean', '3.760123456789E12'), ok('3760123456789'));
  assert.deepEqual(lire('ean', '-'), KO);
  assert.deepEqual(lire('ean', '12AB'), KO);
  assert.deepEqual(lire('ean', '123'), KO);
  assert.deepEqual(lire('ean', ''), VIDE);
});

test('date', () => {
  assert.deepEqual(lire('date_prix', '2026-03-15'), ok('2026-03-15'));
  assert.deepEqual(lire('date_prix', '15/03/2026'), ok('2026-03-15'));
  assert.deepEqual(lire('date_prix', '2026-03-15T00:00:00'), ok('2026-03-15'));
  assert.deepEqual(lire('date_prix', '2026-03-15 00:00:00'), ok('2026-03-15'));
  assert.deepEqual(lire('date_prix', '2026-03-15T00:00:00.000Z'), ok('2026-03-15'));
  assert.deepEqual(lire('date_prix', '2027-01-01'), KO);
  assert.deepEqual(lire('date_prix', '01/01/2027'), KO);
  assert.deepEqual(lire('date_prix', '32/13/2026'), KO);
  assert.deepEqual(lire('date_prix', '2026-02-30'), KO);
  assert.deepEqual(lire('date_prix', 'demain'), KO);
  assert.deepEqual(lire('date_prix', ''), VIDE);
  assert.deepEqual(lire('date_prix', '2026-11-28'), ok('2026-11-28'));
});

test('texte et valeur', () => {
  assert.deepEqual(lire('designation', '  Poêle  '), ok('Poêle'));
  assert.deepEqual(lire('designation', ''), VIDE);
  assert.deepEqual(lire('designation', '   '), VIDE);
  assert.deepEqual(lire('nature', ' Pièce '), ok('Pièce'));
  assert.deepEqual(lire('nature', null), VIDE);
});
