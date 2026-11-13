// Tests des règles des pièces identifiées d'une fiche SAV (src/lib/catalogue/piecesIdentifiees.js).
// node --test scripts/catalogue/pieces-identifiees.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  photoPiece, retrouverLigne, quantitesParLigne, ligneDepuisIdentifiee, choixDepuisIdentifiees, quantiteAffichee,
} from '../../src/lib/catalogue/piecesIdentifiees.js';

const L = (x) => ({ id: 'l1', repere: '14', piece_reference: 'F6107098', piece_name: 'DEFLECTEUR POELE BALHAM', supplier_product_id: 'sp1', prix_public_ht: 58.64, catalog_item_id: 'ci1', ...x });
test('photoPiece : photo complète, repère vide = chaîne vide', () => {
  assert.deepEqual(photoPiece(L(), { equipmentId: 'e1', equipmentModelId: 'm1' }, 2), { equipment_id: 'e1', equipment_model_id: 'm1', part_line_id: 'l1', piece_reference: 'F6107098', piece_name: 'DEFLECTEUR POELE BALHAM', repere: '14', supplier_product_id: 'sp1', public_price_ht: 58.64, quantity: 2 });
  assert.equal(photoPiece(L({ repere: null }), { equipmentId: 'e1', equipmentModelId: 'm1' }, 1).repere, '');
});
test('retrouverLigne : après relevé (nouvel id), par référence + repère', () => {
  const sel = { part_line_id: 'ancien', piece_reference: 'f6107098', repere: '14' };
  assert.equal(retrouverLigne(sel, [L({ id: 'neuf' })]).id, 'neuf');
  assert.equal(retrouverLigne({ ...sel, repere: '15' }, [L({ id: 'neuf' })]), null);
  assert.equal(retrouverLigne(sel, null), null);
});
test('ligneDepuisIdentifiee : pièce disparue du relevé → ligne libre au prix photo', () => {
  const l = ligneDepuisIdentifiee({ part_line_id: 'x', piece_reference: 'ZZ1', piece_name: 'Joint', repere: '3', public_price_ht: 3.64, supplier_product_id: null }, []);
  assert.equal(l.catalog_item_id, null); assert.equal(l.prix_selon_appareil, true); assert.equal(l.prix_public_ht, 3.64);
});
test('choixDepuisIdentifiees : une entrée par pièce, quantité enregistrée', () => {
  const c = choixDepuisIdentifiees([{ equipment_id: 'e1', part_line_id: 'l1', piece_reference: 'F6107098', repere: '14', quantity: 2 }], { e1: [L()] });
  assert.equal(c.length, 1); assert.equal(c[0].quantite, 2); assert.equal(c[0].ligne.catalog_item_id, 'ci1');
  assert.deepEqual(choixDepuisIdentifiees(null, null), []);
});
test('quantitesParLigne / quantiteAffichee', () => {
  assert.deepEqual(quantitesParLigne([{ part_line_id: 'l1', piece_reference: 'F6107098', repere: '14', quantity: 3 }], [L()]), { l1: 3 });
  assert.equal(quantiteAffichee(2, undefined), 2); assert.equal(quantiteAffichee(2, 0), 0); assert.equal(quantiteAffichee(undefined, undefined), 0);
});
