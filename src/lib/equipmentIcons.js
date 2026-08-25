/**
 * equipmentIcons.js - Majord'home Artisan
 * ============================================================================
 * Module PUR (aucun import React/Supabase) : classement des équipements client
 * en « kinds » visuels pour l'identité entretien (cartes contrats, Programmation,
 * planning, cartes clients).
 *
 * Kinds :
 *   - 'buche'  : bois bûches      (poêle à bois / insert, chaudière bois)
 *   - 'flamme' : granulés         (poêles à granulés, chaudière granulés)
 *   - 'flocon' : climatisation/PAC (PAC air/air, PAC air/eau, gainable)
 *
 * Règle produit : si le combustible est indistinguable (poêle/chaudière sans
 * type tarifaire précis, poêle hydro), on n'affiche RIEN — jamais de devinette.
 * Le froid fait exception : la catégorie ENUM suffit (une clim reste une clim).
 *
 * Le type précis vient de pricing_equipment_types.code (equipment_type_id) ;
 * l'ENUM equipments.category ne distingue pas bois/granulés (cf. CLAUDE.md).
 *
 * Testé via : node --test scripts/equipment-icons.test.mjs
 * ============================================================================
 */

/** Ordre d'affichage stable des icônes */
export const KIND_ORDER = ['buche', 'flamme', 'flocon'];

/** Labels génériques (tooltip de secours quand le type précis manque) */
export const KIND_LABELS = {
  buche: 'Bois bûches',
  flamme: 'Granulés',
  flocon: 'Climatisation / PAC',
};

// Codes pricing_equipment_types → kind (source unique du mapping)
const KIND_BY_TYPE_CODE = {
  poele_bois_insert: 'buche',
  chaudiere_bois: 'buche',
  poele_granules_elec: 'flamme',
  poele_granules_sans_elec: 'flamme',
  chaudiere_granules: 'flamme',
  pac_air_air: 'flocon',
  pac_air_eau: 'flocon',
  gainable: 'flocon',
  // poele_hydro : ambigu bois/granulés → volontairement absent (pas d'icône)
};

// Catégories ENUM sans ambiguïté (le froid n'a pas de variante combustible)
const KIND_BY_CATEGORY = {
  pac_air_air: 'flocon',
  pac_air_eau: 'flocon',
  climatisation: 'flocon',
};

/**
 * Classe un équipement en kind visuel.
 * @param {{ type_code?: string|null, category?: string|null }|null} row
 * @returns {'buche'|'flamme'|'flocon'|null} null = non identifiable ou hors périmètre
 */
export function equipmentKind(row) {
  if (!row) return null;
  const byCode = row.type_code ? KIND_BY_TYPE_CODE[row.type_code] : null;
  if (byCode) return byCode;
  // Fallback catégorie : uniquement les catégories non ambiguës (froid)
  return (row.category && KIND_BY_CATEGORY[row.category]) || null;
}

/**
 * Groupe les lignes de la vue majordhome_client_equipment_kinds par client.
 * 1 icône par équipement identifiable (2 poêles granulés = 2 flammes),
 * triées bûche → flamme → flocon. Les clients sans équipement identifiable
 * sont absents de la map.
 *
 * @param {Array<{ client_id: string, type_code?: string|null, category?: string|null, type_label?: string|null }>|null} rows
 * @returns {Map<string, Array<{ kind: string, label: string }>>}
 */
export function buildKindsByClient(rows) {
  const map = new Map();
  if (!Array.isArray(rows)) return map;

  for (const row of rows) {
    const kind = equipmentKind(row);
    if (!kind || !row.client_id) continue;
    if (!map.has(row.client_id)) map.set(row.client_id, []);
    map.get(row.client_id).push({ kind, label: row.type_label || KIND_LABELS[kind] });
  }

  const order = (k) => KIND_ORDER.indexOf(k.kind);
  for (const kinds of map.values()) {
    kinds.sort((a, b) => order(a) - order(b));
  }
  return map;
}
