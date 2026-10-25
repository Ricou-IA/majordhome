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
