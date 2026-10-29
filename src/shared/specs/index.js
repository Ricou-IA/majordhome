/**
 * specs/index.js — Registre des schémas canoniques par catégorie produit
 * ============================================================================
 * Centralise l'accès aux schémas de caractéristiques techniques.
 * Extensible : ajouter un nouveau schéma (vmc, pac, clim…) ne nécessite
 * qu'un nouveau fichier + une entrée dans CATEGORY_SCHEMAS.
 * ============================================================================
 */

import * as poeleSchema from './poele.schema';
import * as batterieSchema from './batterie.schema';
import * as photovoltaiqueSchema from './photovoltaique.schema';

// Registre : catégorie → module de schéma
const CATEGORY_SCHEMAS = {
  poele: poeleSchema,
  batterie: batterieSchema,            // 2026-10-24 : clés posées par les relevés fournisseurs
  photovoltaique: photovoltaiqueSchema, // idem (modules, onduleurs, fixation, bornes)
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
 * Champs de schéma d'une catégorie, pour mettre en forme les caractéristiques d'un article (devis) :
 * la liste COMPLÈTE `<CAT>_CANONICAL_SPECS`, sans les champs `group === 'documents'` (liens, pas des
 * caractéristiques — même filtre que `champsDuSchema`). Pas de filtrage par combustible : seules les valeurs
 * renseignées s'impriment. `[]` pour une catégorie sans schéma ou nulle.
 */
export function canonicalFieldsForCategory(category) {
  const schema = getSchemaForCategory(category);
  const fields = schema && Object.entries(schema).find(([name]) => name.endsWith('_CANONICAL_SPECS'))?.[1];
  return Array.isArray(fields) ? fields.filter((f) => f && f.group !== 'documents') : [];
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
