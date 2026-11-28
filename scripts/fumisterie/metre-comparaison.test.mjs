// Comparaison des fabricants à l'écran : réserves en clair, synthèse seulement quand tout est chiffré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reservesFabricant, syntheseComparaison } from '../../src/apps/artisan/components/devis/metre/metreModel.js';

const col = (o) => ({ supplierId: 'a', nom: 'MODINOX', erreur: null, aChiffrer: 0, ambigus: 0, validee: true, prixVerifies: true, totaux: { vente_ht: 1000 }, ...o });

test('reservesFabricant', () => {
  assert.deepEqual(reservesFabricant(col()), []);
  assert.deepEqual(reservesFabricant(col({ aChiffrer: 2, ambigus: 1 })), ['2 pièces sans prix', '1 pièce à départager']);
  assert.deepEqual(reservesFabricant(col({ validee: false, prixVerifies: false, nom: 'DINAK' })), ['Correspondance de gamme à confirmer', 'Tarifs DINAK non vérifiés']);
  assert.deepEqual(reservesFabricant(col({ erreur: 'Relevé incomplet : x' })), ['Relevé à corriger']);
  for (const r of reservesFabricant(col({ aChiffrer: 0, ambigus: 0, validee: false }))) assert.doesNotMatch(r, /ambigu|0 ·/);
});

test('syntheseComparaison', () => {
  const a = col({ supplierId: 'a', nom: 'MODINOX', totaux: { vente_ht: 890 } });
  const b = col({ supplierId: 'b', nom: 'DINAK', totaux: { vente_ht: 1000 } });
  assert.equal(syntheseComparaison({ colonnes: [a, b], complete: true, moinsCher: 'a' }), 'Le moins cher : MODINOX (−11 %).');
  assert.equal(syntheseComparaison({ colonnes: [a, b], complete: false, moinsCher: null }), 'Comparaison impossible tant que des pièces n’ont pas de prix ou sont à départager.');
  assert.equal(syntheseComparaison({ colonnes: [a, col({ erreur: 'x' })], complete: false, moinsCher: null }), 'Comparaison impossible tant que le relevé est à corriger.');
  assert.equal(syntheseComparaison({ colonnes: [a, col({ supplierId: 'b', totaux: { vente_ht: 890 } })], complete: true, moinsCher: 'a' }), 'Les fabricants sont au même prix.');
});
