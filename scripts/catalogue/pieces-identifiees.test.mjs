// Tests des règles des pièces identifiées d'une fiche SAV (src/lib/catalogue/piecesIdentifiees.js).
// node --test scripts/catalogue/pieces-identifiees.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  photoPiece, retrouverLigne, quantitesParLigne, ligneDepuisIdentifiee, choixDepuisIdentifiees,
  quantitesPourEquipement, photoDepuisIdentifiee, mentionIdentification, modelesPourDevis, nomenclaturesParEquipement,
  selectionModifiable, etatDevisPieces, dedoublonnerPhotos, messagePiecesRangees,
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
test('quantitesParLigne', () => {
  assert.deepEqual(quantitesParLigne([{ part_line_id: 'l1', piece_reference: 'F6107098', repere: '14', quantity: 3 }], [L()]), { l1: 3 });
});

test('quantitesPourEquipement : deux appareils du même modèle ne s\'additionnent pas', () => {
  const sels = [
    { equipment_id: 'e1', part_line_id: 'l1', piece_reference: 'F6107098', repere: '14', quantity: 2 },
    { equipment_id: 'e2', part_line_id: 'l1', piece_reference: 'F6107098', repere: '14', quantity: 3 },
  ];
  assert.deepEqual(quantitesPourEquipement(sels, 'e1', [L()]), { l1: 2 });
  assert.deepEqual(quantitesPourEquipement(sels, 'e3', [L()]), {});
  assert.deepEqual(quantitesPourEquipement(null, 'e1', [L()]), {});
});
test('photoDepuisIdentifiee : mêmes champs que photoPiece, sans id ni auteur, quantité ≥ 0', () => {
  const sel = { id: 'x', org_id: 'o', added_by: 'u', added_at: '2026-11-12', ...photoPiece(L(), { equipmentId: 'e1', equipmentModelId: 'm1' }, 2) };
  assert.deepEqual(photoDepuisIdentifiee(sel, 3), photoPiece(L(), { equipmentId: 'e1', equipmentModelId: 'm1' }, 3));
  assert.equal(photoDepuisIdentifiee(sel, -1).quantity, 0);
  assert.equal(photoDepuisIdentifiee({ ...sel, repere: null }, 1).repere, '');
});
test('mentionIdentification : prénom du membre, sinon « — » ; date jj/mm', () => {
  const added_at = new Date(2026, 10, 5, 10, 30).toISOString();
  const membres = [{ user_id: 'u1', first_name: 'Philippe' }];
  assert.equal(mentionIdentification({ added_by: 'u1', added_at }, membres), 'par Philippe, le 05/11');
  assert.equal(mentionIdentification({ added_by: 'u2', added_at }, membres), 'par —, le 05/11');
  assert.equal(mentionIdentification({ added_by: null, added_at: null }, membres), 'par —');
});
test('modelesPourDevis / nomenclaturesParEquipement : seulement les appareils qui portent une pièce', () => {
  const eqs = [{ id: 'e1', equipment_model_id: 'm1' }, { id: 'e2', equipment_model_id: 'm1' }, { id: 'e3', equipment_model_id: null }, { id: 'e4', equipment_model_id: 'm4' }];
  const sels = [{ equipment_id: 'e1' }, { equipment_id: 'e2' }, { equipment_id: 'e3' }];
  assert.deepEqual(modelesPourDevis(sels, eqs), ['m1']);
  assert.deepEqual(nomenclaturesParEquipement(eqs, { m1: [L()] }), { e1: [L()], e2: [L()], e3: [], e4: [] });
});

test('selectionModifiable : liste inconnue (chargement ou échec) ⇒ verrouillée', () => {
  assert.equal(selectionModifiable({ peutIdentifier: true }), true);
  assert.equal(selectionModifiable({ peutIdentifier: true, chargement: true }), false);
  assert.equal(selectionModifiable({ peutIdentifier: true, erreur: new Error('x') }), false);
  assert.equal(selectionModifiable({ peutIdentifier: false }), false);
  assert.equal(selectionModifiable(), false);
});
test('etatDevisPieces : nomenclature en échec ⇒ refus explicite, jamais des lignes libres', () => {
  const base = { familleActive: true, nbSelections: 2 };
  assert.deepEqual(etatDevisPieces(base), { pret: true, raison: null });
  assert.deepEqual(etatDevisPieces({ ...base, erreurNomenclatures: new Error('réseau') }), { pret: false, raison: 'Liste de pièces indisponible, réessayez' });
  assert.equal(etatDevisPieces({ ...base, erreurSelections: new Error('x') }).pret, false);
  assert.equal(etatDevisPieces({ ...base, chargementNomenclatures: true }).pret, false);
  assert.equal(etatDevisPieces({ ...base, chargementSelections: true }).pret, false);
  assert.equal(etatDevisPieces({ ...base, nbSelections: 0 }).pret, false);
  assert.match(etatDevisPieces({ ...base, familleActive: false }).raison, /inactive/);
});

test('dedoublonnerPhotos : une photo par équipement + référence + repère, la dernière l\'emporte', async () => {
  const p = (x) => ({ equipment_id: 'e1', piece_reference: 'R1', repere: '14', quantity: 1, ...x });
  const out = dedoublonnerPhotos([p(), p({ repere: '15' }), p({ quantity: 3 }), p({ equipment_id: 'e2' })]);
  assert.equal(out.length, 3);
  assert.equal(out.find((x) => x.equipment_id === 'e1' && x.repere === '14').quantity, 3);
  assert.deepEqual(dedoublonnerPhotos([p({ repere: null }), p({ repere: '', quantity: 2 })]).map((x) => x.quantity), [2]);
  assert.deepEqual(dedoublonnerPhotos(null), []);
});

test('messagePiecesRangees : singulier / pluriel', () => {
  assert.equal(messagePiecesRangees(1), '1 pièce mise sur la demande SAV');
  assert.equal(messagePiecesRangees(3), '3 pièces mises sur la demande SAV');
});
