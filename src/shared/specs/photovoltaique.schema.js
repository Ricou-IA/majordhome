/**
 * photovoltaique.schema.js — Schéma canonique des caractéristiques « photovoltaïque »
 * (modules, onduleurs, fixation, coffrets, bornes relevés chez les grossistes)
 * ============================================================================
 * Même contrat que poele.schema.js (filterByFuelType / groupFields / buildEmptyCanonical) pour le formulaire du
 * drawer. Clés posées par les relevés fournisseurs (src/lib/catalogue/*.js) : ce que le relevé apporte s'affiche,
 * le reste se complète à la main (spec tranche 2 § 6). Pas de combustible : applies_to vaut toujours ['*'].
 * ============================================================================
 */

export const PHOTOVOLTAIQUE_GROUPS = [
  { key: 'identity', label: 'Identité' },
  { key: 'performance', label: 'Performance' },
  { key: 'warranty', label: 'Garanties' },
  { key: 'dimensions', label: 'Dimensions & poids' },
  { key: 'documents', label: 'Documents' },
];

export const PHOTOVOLTAIQUE_CANONICAL_SPECS = [
  { key: 'mpn', label: 'Référence fabricant', type: 'text', group: 'identity', applies_to: ['*'], aliases: ['mpn', 'référence fabricant'] },
  { key: 'fabricant', label: 'Fabricant', type: 'text', group: 'identity', applies_to: ['*'], aliases: ['fabricant', 'marque', 'manufacturer'] },
  { key: 'puissance_wc', label: 'Puissance crête', unit: 'Wc', type: 'number', group: 'performance', applies_to: ['*'], aliases: ['puissance crête', 'puissance', 'watt', 'wc', 'wp'] },
  { key: 'puissance_kw', label: 'Puissance (onduleur)', unit: 'kW', type: 'number', group: 'performance', applies_to: ['*'], aliases: ['puissance nominale', 'kw'] },
  { key: 'garantie_produit_ans', label: 'Garantie produit', unit: 'ans', type: 'number', group: 'warranty', applies_to: ['*'], aliases: ['garantie', 'garantie produit', 'product warranty'] },
  { key: 'garantie_perf_ans', label: 'Garantie de performance', unit: 'ans', type: 'number', group: 'warranty', applies_to: ['*'], aliases: ['garantie performance', 'performance warranty'] },
  { key: 'dimensions_cm', label: 'Dimensions (L × l × H)', unit: 'cm', type: 'text', group: 'dimensions', applies_to: ['*'], aliases: ['dimensions', 'encombrement'] },
  { key: 'poids_kg', label: 'Poids', unit: 'kg', type: 'number', group: 'dimensions', applies_to: ['*'], aliases: ['poids', 'weight', 'masse'] },
  { key: 'fiche_technique_fr', label: 'Fiche technique (lien)', type: 'text', group: 'documents', applies_to: ['*'], aliases: ['fiche technique', 'datasheet', 'data sheet'] },
];

export function filterByFuelType() {
  return PHOTOVOLTAIQUE_CANONICAL_SPECS;
}

export function groupFields(fields) {
  const result = {};
  for (const group of PHOTOVOLTAIQUE_GROUPS) result[group.key] = { ...group, fields: [] };
  for (const field of fields) {
    const g = field.group || 'identity';
    if (!result[g]) result[g] = { key: g, label: g, fields: [] };
    result[g].fields.push(field);
  }
  return Object.values(result).filter((g) => g.fields.length > 0);
}

export function buildEmptyCanonical() {
  const out = {};
  for (const f of PHOTOVOLTAIQUE_CANONICAL_SPECS) out[f.key] = null;
  return out;
}

export function formatSpecValue(key, value) {
  if (value == null || value === '') return '—';
  const f = PHOTOVOLTAIQUE_CANONICAL_SPECS.find((x) => x.key === key);
  return f?.unit ? `${value} ${f.unit}` : String(value);
}
