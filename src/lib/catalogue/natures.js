// src/lib/catalogue/natures.js
// Natures d'un article Majord'home (catalog_items.product_kind, CHECK de la migration 20261027_1) — elles décident du
// chapitre de devis où l'article est proposé (décisions d'Eric, 2026-10-25). Module PUR (aucun import).

/** Natures qu'on choisit en créant un article (consumable n'existe que pour les lignes fournisseur importées). */
export const NATURES_ARTICLE = Object.freeze([
  Object.freeze({ value: 'main', label: 'Équipement' }),
  Object.freeze({ value: 'accessory', label: 'Option' }),
  Object.freeze({ value: 'stock', label: 'Matériel stocké' }),
  Object.freeze({ value: 'main_oeuvre', label: 'Main d’œuvre' }),
]);

/** Natures de la fiche article : celles qu'on crée + `consumable` (lignes importées), libellés courts. */
export const NATURES_FICHE = Object.freeze([
  ...NATURES_ARTICLE.slice(0, 2),
  Object.freeze({ value: 'consumable', label: 'Consommable' }),
  ...NATURES_ARTICLE.slice(2),
]);

const NATURE_PAR_CHAPITRE = Object.freeze({ equipement: 'main', option: 'accessory', stock: 'stock', main_oeuvre: 'main_oeuvre' });
const UNITES_ARTICLE = Object.freeze(['pièce', 'ml', 'm²', 'forfait', 'h']);

/**
 * Nature d'un article créé depuis un chapitre de devis (type du chapitre, devisConfig) ; défaut : équipement.
 * @param {string | undefined} typeChapitre
 * @returns {string}
 */
export function natureDepuisChapitre(typeChapitre) {
  return NATURE_PAR_CHAPITRE[typeChapitre] || 'main';
}

/**
 * Article à créer depuis une ligne libre du devis (retour d'Eric 2026-10-25 : proposer la création des articles).
 * Prix de vente = prix unitaire de la ligne ; unité inconnue de la base ⇒ pièce ; catégorie de la famille seulement
 * pour un équipement ou une option (le matériel stocké et la main d'œuvre servent toutes les familles).
 * Sans libellé ⇒ null.
 * @param {{ designation?: string, unit?: string, unit_price_ht?: unknown }} ligne
 * @param {string | undefined} typeChapitre
 * @param {string | null} categorie
 * @returns {{ name: string, productKind: string, unit: string, sellingPriceHt: number, category: string | null } | null}
 */
export function articleDepuisLigne(ligne, typeChapitre, categorie) {
  const name = String(ligne?.designation || '').trim();
  if (!name) return null;
  const productKind = natureDepuisChapitre(typeChapitre);
  return {
    name, productKind,
    unit: UNITES_ARTICLE.includes(ligne.unit) ? ligne.unit : 'pièce',
    sellingPriceHt: Number(String(ligne.unit_price_ht ?? '').replace(',', '.')) || 0,
    category: productKind === 'main' || productKind === 'accessory' ? (categorie || null) : null,
  };
}

/**
 * Index des lignes du devis à proposer en article : libres ou de main d'œuvre, nommées, sans article.
 * @param {Array<{ line_type: string, is_freeform?: boolean, designation?: string, catalog_item_id?: string | null }>} lines
 * @returns {number[]}
 */
export function lignesSansArticle(lines) {
  return (lines || []).reduce((acc, l, i) => {
    const libre = l.is_freeform || l.line_type === 'labor';
    if (l.line_type !== 'section_title' && libre && !l.catalog_item_id && String(l.designation || '').trim()) acc.push(i);
    return acc;
  }, []);
}
