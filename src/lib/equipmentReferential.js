/**
 * equipmentReferential.js - Majord'home Artisan
 * ============================================================================
 * Module PUR (aucun import React/Supabase) : index et libellés du référentiel
 * équipements d'une organisation — catégories (`majordhome_equipment_categories`)
 * → types (`majordhome_pricing_equipment_types`, via `category_id`).
 *
 * C'est l'UNIQUE point de vocabulaire du front : plus de constante locale de
 * libellés (enum, familles), tout vient des lignes de l'org. Un id inconnu
 * s'affiche « Non catégorisé » / « Type inconnu », jamais une valeur devinée.
 *
 * Testé via : node --test scripts/equipment-referential.test.mjs
 * ============================================================================
 */

/** Gabarits de certificat (liste fermée niveau app — CHECK `equipment_categories.certificate_profile`). */
export const CERTIFICATE_PROFILES = [
  { value: 'combustion_bois', label: 'Combustion bois', description: 'ramonage, brûleur, cendres, mesures de combustion' },
  { value: 'combustion_fossile', label: 'Combustion gaz / fioul', description: 'ramonage, brûleur, mesures de combustion' },
  { value: 'pac', label: 'PAC / climatisation', description: 'F-Gaz, mesures PAC' },
  { value: 'ecs_thermo', label: 'Chauffe-eau thermodynamique', description: 'F-Gaz, mesures eau chaude' },
  { value: 'ecs', label: 'Eau chaude sanitaire', description: 'mesures eau chaude' },
  { value: 'aeraulique', label: 'Aéraulique (VMC)', description: 'mesures aérauliques' },
  { value: 'generique', label: 'Générique', description: 'contrôles et nettoyage seulement' },
];
export const PROFIL_GENERIQUE = 'generique';
export const LABEL_NON_CATEGORISE = 'Non catégorisé';
export const LABEL_TYPE_INCONNU = 'Type inconnu';

const parOrdre = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.label || '').localeCompare(String(b.label || ''), 'fr');

/**
 * Index d'un référentiel. Toutes les listes sont triées (sort_order puis libellé).
 *
 * @param {{ categories?: Array<{ id, code, label, sort_order?, is_active?, certificate_profile?, default_vat_rate? }>,
 *           equipmentTypes?: Array<{ id, label, category_id, sort_order?, is_active? }> }} referentiel
 */
export function indexReferentiel({ categories = [], equipmentTypes = [] } = {}) {
  const categoriesOrdonnees = [...categories].sort(parOrdre);
  const typesOrdonnes = [...equipmentTypes].sort(parOrdre);
  const categoriesById = new Map(categoriesOrdonnees.map((c) => [c.id, c]));
  const categoriesByCode = new Map(categoriesOrdonnees.map((c) => [c.code, c]));
  const typesById = new Map(typesOrdonnes.map((t) => [t.id, t]));
  const typesParCategorie = new Map();
  for (const t of typesOrdonnes) {
    const key = t.category_id ?? null;
    if (!typesParCategorie.has(key)) typesParCategorie.set(key, []);
    typesParCategorie.get(key).push(t);
  }
  return {
    categories: categoriesOrdonnees,
    equipmentTypes: typesOrdonnes,
    categoriesById,
    categoriesByCode,
    typesById,
    typesParCategorie,
    labelCategorie: (id) => categoriesById.get(id)?.label ?? LABEL_NON_CATEGORISE,
    labelType: (id) => typesById.get(id)?.label ?? null,
    /** Gabarit de certificat d'un code de catégorie ; code inconnu → générique (à AFFICHER, cf. wizard). */
    profilParCode: (code) => categoriesByCode.get(code)?.certificate_profile ?? PROFIL_GENERIQUE,
    /** TVA par défaut d'un code de catégorie ; inconnu → null. */
    tvaParCode: (code) => {
      const v = categoriesByCode.get(code)?.default_vat_rate;
      return v == null ? null : Number(v);
    },
    /** La catégorie est-elle connue de l'org ? (un certificat ancien peut porter un code disparu) */
    codeConnu: (code) => categoriesByCode.has(code),
  };
}

/**
 * Regroupe des types par catégorie pour un <select> à <optgroup>. Les types
 * dont la catégorie manque (inactive, supprimée) forment un dernier groupe
 * « Non catégorisé » : un type n'est jamais perdu par un écran.
 *
 * @param {ReturnType<typeof indexReferentiel>} index
 * @param {Array} [types=index.equipmentTypes]
 * @returns {Array<{ category: object|null, label: string, types: Array }>}
 */
export function grouperTypesParCategorie(index, types = index.equipmentTypes) {
  const parCat = new Map();
  for (const t of [...types].sort(parOrdre)) {
    const cat = index.categoriesById.get(t.category_id) || null;
    const key = cat ? cat.id : null;
    if (!parCat.has(key)) parCat.set(key, { category: cat, label: cat ? cat.label : LABEL_NON_CATEGORISE, types: [] });
    parCat.get(key).types.push(t);
  }
  const groupes = [...parCat.values()];
  return groupes.sort((a, b) => {
    if (!a.category) return 1;
    if (!b.category) return -1;
    return parOrdre(a.category, b.category);
  });
}

/**
 * Libellé d'un équipement : son type s'il est typé, sinon sa catégorie, sinon « Équipement ».
 * @param {{ equipment_type_id?: string|null, category_id?: string|null }} equipement
 * @param {ReturnType<typeof indexReferentiel>} index
 */
export function libelleEquipement(equipement, index) {
  if (!equipement) return 'Équipement';
  const type = equipement.equipment_type_id ? index.typesById.get(equipement.equipment_type_id) : null;
  if (type) return type.label;
  if (equipement.equipment_type_id) return LABEL_TYPE_INCONNU;
  const cat = equipement.category_id ? index.categoriesById.get(equipement.category_id) : null;
  return cat ? cat.label : 'Équipement';
}

/**
 * Forme attendue par le moteur de tournées (`typesParCategorie` : catégorie → ids de types).
 * @param {ReturnType<typeof indexReferentiel>} index
 * @returns {Map<string, string[]>}
 */
export function typeIdsParCategorie(index) {
  const out = new Map();
  for (const [catId, types] of index.typesParCategorie) {
    if (catId == null) continue;
    out.set(catId, types.map((t) => t.id));
  }
  return out;
}
