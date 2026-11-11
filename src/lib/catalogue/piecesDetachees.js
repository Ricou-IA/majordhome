// src/lib/catalogue/piecesDetachees.js
// Règles PURES des pièces détachées côté écrans (devis, fiche fournisseur). Testées dans
// scripts/catalogue/invicta-pieces.test.mjs. Spec :
// docs/superpowers/specs/2026-11-11-pieces-detachees-invicta-releve-nomenclature-design.md § 5.5, § 5.6, § 7 bis.

/** Catégorie produit des pièces détachées (lignes fournisseur et articles). */
export const CATEGORIE_PIECE_DETACHEE = 'piece_detachee';

/**
 * Les pièces détachées n'ont pas leur place dans le choix d'un équipement ou d'une option (quelques milliers
 * d'articles de nature « accessoire ») : elles sont écartées de ces chapitres, et proposées partout ailleurs.
 * @param {string} typeChapitre type du chapitre de devis
 * @returns {boolean}
 */
export function exclurePiecesDetachees(typeChapitre) {
  return typeChapitre === 'equipement' || typeChapitre === 'option';
}

/**
 * Référence portée par la ligne de devis d'un article : sa référence interne si elle existe ; sinon, pour une
 * pièce détachée, la référence du fournisseur (c'est elle qu'on commande) ; sinon rien.
 * @param {{ code?: string|null, category?: string|null, source_product_id?: string|null }} item article
 * @param {Record<string, string>} [referencesParLigne] référence fournisseur par id de ligne source
 * @returns {string}
 */
export function referenceLigneArticle(item, referencesParLigne = {}) {
  const code = String(item?.code || '').trim();
  if (code) return code;
  if (item?.category !== CATEGORIE_PIECE_DETACHEE || !item?.source_product_id) return '';
  return String(referencesParLigne[item.source_product_id] || '').trim();
}

/**
 * Remise sur les pièces saisie dans la fiche fournisseur → pourcentage valide, ou null si la saisie ne l'est pas.
 * @param {string|number|null|undefined} saisie
 * @returns {number|null} nombre dans [0, 100[ arrondi à 2 décimales
 */
export function remisePiecesValide(saisie) {
  const texte = String(saisie ?? '').trim().replace(',', '.');
  if (texte === '') return null;
  const n = Number(texte);
  if (!Number.isFinite(n) || n < 0 || n >= 100) return null;
  return Math.round(n * 100) / 100;
}

/**
 * `connector_config` à enregistrer depuis la fiche fournisseur : les réglages de la boutique connectée, plus le
 * réglage des pièces détachées CONSERVÉ (il n'est jamais effacé par l'enregistrement de la fiche) avec la remise saisie.
 * @param {object} base réglages de la boutique (`{ sca_path, site_id }` ou `{}`)
 * @param {object|null|undefined} piecesExistant `connector_config.pieces` actuel
 * @param {string|number|null|undefined} remiseSaisie
 * @returns {object}
 */
export function connectorConfigAvecPieces(base, piecesExistant, remiseSaisie) {
  if (!piecesExistant || typeof piecesExistant !== 'object') return { ...(base || {}) };
  const remise = remisePiecesValide(remiseSaisie);
  return { ...(base || {}), pieces: { ...piecesExistant, remise_pct: remise ?? piecesExistant.remise_pct ?? 0 } };
}
