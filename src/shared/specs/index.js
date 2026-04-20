/**
 * specs/index.js — Registre des schémas canoniques par catégorie produit
 * ============================================================================
 * Centralise l'accès aux schémas de caractéristiques techniques.
 * Extensible : ajouter un nouveau schéma (vmc, pac, clim…) ne nécessite
 * qu'un nouveau fichier + une entrée dans CATEGORY_SCHEMAS.
 * ============================================================================
 */

import * as poeleSchema from './poele.schema';

// Registre : catégorie → module de schéma
export const CATEGORY_SCHEMAS = {
  poele: poeleSchema,
  // À venir : vmc, pac, clim, chauffe_eau, electricite
};

/**
 * Retourne le module de schéma pour une catégorie donnée.
 * null si la catégorie n'est pas supportée (produit hors scope enrichissement).
 */
export function getSchemaForCategory(category) {
  if (!category) return null;
  return CATEGORY_SCHEMAS[category] || null;
}

/**
 * true si la catégorie supporte l'enrichissement (specs canoniques + variants).
 */
export function supportsEnrichment(category) {
  return !!getSchemaForCategory(category);
}

// Re-exports pour confort d'import dans les composants
export {
  POELE_FUEL_TYPES,
  POELE_GROUPS,
  POELE_CANONICAL_SPECS,
  ENERGY_CLASSES,
  INTERIOR_MATERIALS,
  filterByFuelType,
  groupFields,
  buildEmptyCanonical,
  matchLabelToCanonicalKey,
  parseSpecValue,
  parseRangeValue,
  formatSpecValue,
  validateCanonical,
  getKeySpecs,
} from './poele.schema';
