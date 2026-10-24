/**
 * batterie.schema.js — Schéma canonique des caractéristiques « batterie de stockage »
 * ============================================================================
 * Même contrat que poele.schema.js (filterByFuelType / groupFields / buildEmptyCanonical) pour le formulaire du
 * drawer. Les clés sont celles posées par les relevés fournisseurs (src/lib/catalogue/suitecommerce.js,
 * woocommerce.js) : ce que le relevé apporte s'affiche, le reste se complète à la main (spec tranche 2 § 6).
 * Pas de combustible : applies_to vaut toujours ['*'].
 * ============================================================================
 */

export const BATTERIE_GROUPS = [
  { key: 'identity', label: 'Identité' },
  { key: 'performance', label: 'Performance' },
  { key: 'warranty', label: 'Garanties' },
  { key: 'dimensions', label: 'Dimensions & poids' },
  { key: 'documents', label: 'Documents' },
];

export const BATTERIE_CANONICAL_SPECS = [
  { key: 'mpn', label: 'Référence fabricant', type: 'text', group: 'identity', applies_to: ['*'], aliases: ['mpn', 'référence fabricant', 'ref fabricant'] },
  { key: 'fabricant', label: 'Fabricant', type: 'text', group: 'identity', applies_to: ['*'], aliases: ['fabricant', 'marque', 'manufacturer'] },
  { key: 'type_batterie', label: 'Type', type: 'text', group: 'identity', applies_to: ['*'], aliases: ['type', 'battery type'], hint: 'AC, DC, AC&DC (onduleur inclus)' },
  { key: 'technologie_cellules', label: 'Technologie des cellules', type: 'text', group: 'identity', applies_to: ['*'], aliases: ['cellules', 'cell technology', 'chimie'], hint: 'LFP (lithium fer phosphate), NMC…' },
  { key: 'energie_utile_kwh', label: 'Énergie utile', unit: 'kWh', type: 'number', required: true, group: 'performance', applies_to: ['*'], aliases: ['énergie utile', 'capacité utile', 'usable energy', 'capacité'] },
  { key: 'puissance_kw', label: 'Puissance', unit: 'kW', type: 'number', group: 'performance', applies_to: ['*'], aliases: ['puissance', 'power', 'puissance de sortie'] },
  { key: 'garantie_produit_ans', label: 'Garantie produit', unit: 'ans', type: 'number', group: 'warranty', applies_to: ['*'], aliases: ['garantie', 'garantie produit', 'product warranty'] },
  { key: 'garantie_perf_ans', label: 'Garantie de performance', unit: 'ans', type: 'number', group: 'warranty', applies_to: ['*'], aliases: ['garantie performance', 'performance warranty'] },
  { key: 'dimensions_cm', label: 'Dimensions (L × l × H)', unit: 'cm', type: 'text', group: 'dimensions', applies_to: ['*'], aliases: ['dimensions', 'encombrement'] },
  { key: 'poids_kg', label: 'Poids', unit: 'kg', type: 'number', group: 'dimensions', applies_to: ['*'], aliases: ['poids', 'weight', 'masse'] },
  { key: 'fiche_technique_fr', label: 'Fiche technique (lien)', type: 'text', group: 'documents', applies_to: ['*'], aliases: ['fiche technique', 'datasheet', 'data sheet'] },
];

/** Pas de combustible pour une batterie : tous les champs s'appliquent. */
export function filterByFuelType() {
  return BATTERIE_CANONICAL_SPECS;
}

/** Regroupe les champs par groupe (affichage formulaire par section). */
export function groupFields(fields) {
  const result = {};
  for (const group of BATTERIE_GROUPS) result[group.key] = { ...group, fields: [] };
  for (const field of fields) {
    const g = field.group || 'identity';
    if (!result[g]) result[g] = { key: g, label: g, fields: [] };
    result[g].fields.push(field);
  }
  return Object.values(result).filter((g) => g.fields.length > 0);
}

export function buildEmptyCanonical() {
  const out = {};
  for (const f of BATTERIE_CANONICAL_SPECS) out[f.key] = null;
  return out;
}

export function formatSpecValue(key, value) {
  if (value == null || value === '') return '—';
  const f = BATTERIE_CANONICAL_SPECS.find((x) => x.key === key);
  return f?.unit ? `${value} ${f.unit}` : String(value);
}
