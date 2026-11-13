// src/lib/catalogue/piecesIdentifiees.js
// Règles PURES des pièces identifiées d'une fiche SAV (table majordhome.sav_part_selections) : photo d'une ligne de
// nomenclature, retrouvaille dans la nomenclature actuelle (un relevé change les id), entrées de devis. Aucun import
// React / Supabase. Testé dans scripts/catalogue/pieces-identifiees.test.mjs.
//
// Une « sélection » = ligne de sav_part_selections : equipment_id, equipment_model_id, part_line_id, piece_reference,
// piece_name, repere ('' si aucun), supplier_product_id, public_price_ht, quantity.
// Une « ligne » = ligne de la vue majordhome_equipment_model_parts.

import { cle, prixPublicPiece } from './nomenclature.js';

/**
 * Photo d'une ligne de nomenclature au moment où la pièce est identifiée.
 * @param {object} ligne ligne de majordhome_equipment_model_parts
 * @param {{equipmentId: string, equipmentModelId: string}} ctx équipement et modèle concernés
 * @param {number} quantite quantité identifiée
 * @returns {{equipment_id: string, equipment_model_id: string, part_line_id: string, piece_reference: string, piece_name: string, repere: string, supplier_product_id: (string|null), public_price_ht: (number|null), quantity: number}}
 */
export function photoPiece(ligne, { equipmentId, equipmentModelId } = {}, quantite) {
  return {
    equipment_id: equipmentId,
    equipment_model_id: equipmentModelId,
    part_line_id: ligne?.id,
    piece_reference: ligne?.piece_reference,
    piece_name: ligne?.piece_name,
    repere: ligne?.repere == null ? '' : String(ligne.repere),
    supplier_product_id: ligne?.supplier_product_id ?? null,
    public_price_ht: prixPublicPiece(ligne),
    quantity: quantite,
  };
}

/**
 * Retrouve dans la nomenclature actuelle la ligne d'une pièce enregistrée : par `part_line_id`, sinon (après un
 * nouveau relevé, les id changent) par même référence ET même repère.
 * @param {object} selection
 * @param {object[]} lignes
 * @returns {object|null}
 */
export function retrouverLigne(selection, lignes) {
  if (!selection || !Array.isArray(lignes)) return null;
  const parId = selection.part_line_id ? lignes.find((l) => l.id === selection.part_line_id) : null;
  if (parId) return parId;
  const ref = cle(selection.piece_reference);
  if (!ref) return null;
  const rep = String(selection.repere ?? '');
  return lignes.find((l) => cle(l.piece_reference) === ref && String(l.repere ?? '') === rep) || null;
}

/**
 * Les pièces identifiées projetées sur la nomenclature affichée : quantité par id de ligne actuel.
 * @param {object[]} selections
 * @param {object[]} lignes
 * @returns {Object<string, number>}
 */
export function quantitesParLigne(selections, lignes) {
  const out = {};
  for (const s of selections || []) {
    const l = retrouverLigne(s, lignes);
    if (l) out[l.id] = (out[l.id] || 0) + (Number(s.quantity) || 0);
  }
  return out;
}

/**
 * Ligne exploitable pour un devis : la ligne actuelle si retrouvée, sinon une ligne libre au prix de la photo
 * (pièce disparue du relevé).
 * @param {object} selection
 * @param {object[]} lignes
 * @returns {object}
 */
export function ligneDepuisIdentifiee(selection, lignes) {
  const l = retrouverLigne(selection, lignes);
  if (l) return l;
  return {
    id: null,
    repere: selection?.repere ?? '',
    piece_reference: selection?.piece_reference,
    piece_name: selection?.piece_name,
    supplier_product_id: selection?.supplier_product_id ?? null,
    prix_public_ht: selection?.public_price_ht ?? null,
    prix_selon_appareil: true,
    catalog_item_id: null,
    unit: 'pièce',
  };
}

/**
 * Entrées de `lignesDevisAvecPieces` : une par pièce identifiée, avec sa quantité enregistrée.
 * @param {object[]} selections
 * @param {Object<string, object[]>} lignesParEquipement nomenclature actuelle par id d'équipement
 * @returns {{ligne: object, quantite: number}[]}
 */
export function choixDepuisIdentifiees(selections, lignesParEquipement) {
  return (selections || []).map((s) => ({
    ligne: ligneDepuisIdentifiee(s, lignesParEquipement?.[s.equipment_id] || []),
    quantite: Number(s.quantity) || 0,
  }));
}

/**
 * Quantité à afficher : l'écriture en vol (`enCours`) si définie, sinon la valeur en base, sinon 0.
 * @param {number|undefined} enBase
 * @param {number|undefined} enCours
 * @returns {number}
 */
export function quantiteAffichee(enBase, enCours) {
  if (enCours !== undefined && enCours !== null) return enCours;
  return enBase ?? 0;
}
