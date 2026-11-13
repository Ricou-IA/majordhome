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

/**
 * Quantités de la nomenclature affichée pour UN équipement : seules ses pièces identifiées comptent (deux appareils
 * du même modèle ne s'additionnent pas sur une même ligne).
 * @param {object[]} selections toutes les pièces identifiées de la fiche
 * @param {string} equipmentId équipement affiché
 * @param {object[]} lignes nomenclature affichée
 * @returns {Object<string, number>}
 */
export function quantitesPourEquipement(selections, equipmentId, lignes) {
  return quantitesParLigne((selections || []).filter((s) => s.equipment_id === equipmentId), lignes);
}

/**
 * Photo d'une pièce déjà enregistrée, à une autre quantité (+ / − / retrait depuis la liste) : mêmes champs que
 * `photoPiece`, rien d'autre (ni id, ni auteur, ni dates).
 * @param {object} selection ligne de sav_part_selections
 * @param {number} quantite nouvelle quantité (0 = retrait)
 * @returns {{equipment_id: string, equipment_model_id: (string|null), part_line_id: (string|null), piece_reference: string, piece_name: string, repere: string, supplier_product_id: (string|null), public_price_ht: (number|null), quantity: number}}
 */
export function photoDepuisIdentifiee(selection, quantite) {
  return {
    equipment_id: selection?.equipment_id,
    equipment_model_id: selection?.equipment_model_id ?? null,
    part_line_id: selection?.part_line_id ?? null,
    piece_reference: selection?.piece_reference,
    piece_name: selection?.piece_name,
    repere: selection?.repere == null ? '' : String(selection.repere),
    supplier_product_id: selection?.supplier_product_id ?? null,
    public_price_ht: selection?.public_price_ht ?? null,
    quantity: Math.max(0, Number(quantite) || 0),
  };
}

const deuxChiffres = (n) => String(n).padStart(2, '0');

/**
 * Mention « par Prénom, le jj/mm » d'une pièce identifiée. Prénom = membre de l'équipe dont `user_id` est l'auteur
 * (`added_by`), sinon « — ».
 * @param {object} selection
 * @param {Array<{user_id?: string, first_name?: string}>} membres
 * @returns {string}
 */
export function mentionIdentification(selection, membres) {
  const membre = selection?.added_by ? (membres || []).find((m) => m?.user_id === selection.added_by) : null;
  const prenom = membre?.first_name?.trim() || '—';
  const d = selection?.added_at ? new Date(selection.added_at) : null;
  if (!d || Number.isNaN(d.getTime())) return `par ${prenom}`;
  return `par ${prenom}, le ${deuxChiffres(d.getDate())}/${deuxChiffres(d.getMonth() + 1)}`;
}

/**
 * Modèles dont la nomenclature sert au devis : ceux, actuels, des équipements qui portent une pièce identifiée.
 * @param {object[]} selections
 * @param {Array<{id: string, equipment_model_id?: string|null}>} equipements
 * @returns {string[]} id de modèles, sans doublon
 */
export function modelesPourDevis(selections, equipements) {
  const avecPieces = new Set((selections || []).map((s) => s.equipment_id));
  const ids = (equipements || []).filter((e) => avecPieces.has(e.id) && e.equipment_model_id).map((e) => e.equipment_model_id);
  return [...new Set(ids)];
}

/**
 * Nomenclature actuelle par équipement (entrée de `choixDepuisIdentifiees`) : un équipement sans modèle, ou dont la
 * nomenclature n'est pas chargée, n'a pas de lignes — ses pièces partent en lignes libres au prix de la photo.
 * @param {Array<{id: string, equipment_model_id?: string|null}>} equipements
 * @param {Object<string, object[]>} partsParModele
 * @returns {Object<string, object[]>}
 */
export function nomenclaturesParEquipement(equipements, partsParModele) {
  const out = {};
  for (const e of equipements || []) out[e.id] = (e.equipment_model_id && partsParModele?.[e.equipment_model_id]) || [];
  return out;
}

/**
 * La liste des pièces identifiées est-elle modifiable ? Seulement quand elle est CONNUE : en chargement ou en échec,
 * l'écran afficherait 0 partout et un « + » écraserait une quantité déjà enregistrée (upsert). Inconnue ⇒ verrouillée.
 * @param {{ peutIdentifier?: boolean, chargement?: boolean, erreur?: unknown }} etat
 * @returns {boolean}
 */
export function selectionModifiable({ peutIdentifier, chargement, erreur } = {}) {
  return !!peutIdentifier && !chargement && !erreur;
}

/**
 * Peut-on créer le devis depuis les pièces identifiées ? Une nomenclature en échec n'est PAS une pièce disparue du
 * relevé : on refuse plutôt que d'envoyer toutes les pièces en lignes libres (sans article, prix de vente ni marge).
 * @param {{ familleActive?: boolean, chargementSelections?: boolean, erreurSelections?: unknown, chargementNomenclatures?: boolean, erreurNomenclatures?: unknown, nbSelections?: number }} etat
 * @returns {{ pret: boolean, raison: (string|null) }} `raison` = texte à afficher quand ce n'est pas prêt
 */
export function etatDevisPieces({
  familleActive, chargementSelections, erreurSelections, chargementNomenclatures, erreurNomenclatures, nbSelections,
} = {}) {
  if (!familleActive) return { pret: false, raison: 'Famille de devis « Dépannage / SAV » inactive (Réglages → Devis)' };
  if (erreurSelections) return { pret: false, raison: 'Pièces identifiées indisponibles, réessayez' };
  if (erreurNomenclatures) return { pret: false, raison: 'Liste de pièces indisponible, réessayez' };
  if (chargementSelections || chargementNomenclatures) return { pret: false, raison: 'Chargement de la liste de pièces…' };
  if (!(nbSelections > 0)) return { pret: false, raison: 'Aucune pièce identifiée' };
  return { pret: true, raison: null };
}
