/**
 * poele.schema.js — Schéma canonique des caractéristiques techniques "poêle"
 * ============================================================================
 * Source unique de vérité pour :
 *  - Le formulaire de saisie fiche produit (auto-généré)
 *  - Le mapping scraping web → champs canoniques (aliases)
 *  - L'affichage normalisé fiche produit / picker / espace client
 *  - L'export vers Pennylane (si besoin d'enrichir la description de ligne)
 *
 * Structure :
 *  - POELE_FUEL_TYPES : enum combustible (bois / granules / hybride)
 *  - POELE_GROUPS : regroupements pour l'UI (Puissance / Performance / ...)
 *  - POELE_CANONICAL_SPECS : tableau des champs canoniques (15-25 selon fuel_type)
 *    * chaque champ a applies_to[] — filtre dynamique selon fuel_type
 *    * aliases[] alimente le mapping scraping (labels fournisseurs → key canonique)
 *
 * Champs extras (hors canonique) : stockés dans specs.extras = [{label, value, unit?}]
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// CONSTANTES
// ----------------------------------------------------------------------------

export const POELE_FUEL_TYPES = [
  { value: 'bois', label: 'Bois' },
  { value: 'granules', label: 'Granulés' },
  { value: 'hybride', label: 'Hybride (bois + granulés)' },
];

export const POELE_GROUPS = [
  { key: 'power', label: 'Puissance' },
  { key: 'performance', label: 'Performance' },
  { key: 'emissions', label: 'Émissions' },
  { key: 'connections', label: 'Raccordements' },
  { key: 'safety', label: 'Distances de sécurité' },
  { key: 'dimensions', label: 'Dimensions & poids' },
  { key: 'features', label: 'Fonctions' },
  { key: 'finishing', label: 'Finitions & garantie' },
];

export const ENERGY_CLASSES = ['A++', 'A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];

export const INTERIOR_MATERIALS = [
  'Thermobéton',
  'Vermiculite',
  'Fonte',
  'Acier',
  'Céramique',
  'Pierre ollaire',
  'Chamotte',
];

// ----------------------------------------------------------------------------
// SCHÉMA CANONIQUE
// ----------------------------------------------------------------------------

const ALL_FUELS = ['bois', 'granules', 'hybride'];

/**
 * Liste ordonnée des champs canoniques.
 * Chaque champ décrit :
 *  - key         : clé stockée dans specs.canonical
 *  - label       : libellé FR (UI + fallback scraping)
 *  - unit        : unité affichée après la valeur (optionnel)
 *  - type        : number | boolean | enum | text
 *  - options     : valeurs autorisées si type=enum
 *  - required    : true si indispensable (validation UI)
 *  - applies_to  : fuel_types pour lesquels le champ est pertinent
 *  - group       : clé de POELE_GROUPS pour le regroupement visuel
 *  - aliases     : variantes de libellés rencontrées (pour mapping scraping)
 *  - hint        : aide saisie (optionnel)
 */
export const POELE_CANONICAL_SPECS = [
  // ================= Puissance =================
  {
    key: 'power_nominal_kw',
    label: 'Puissance nominale',
    unit: 'kW',
    type: 'number',
    required: true,
    applies_to: ALL_FUELS,
    group: 'power',
    aliases: [
      'puissance nominale', 'puissance', 'puissance utile', 'puissance thermique',
      'puissance de chauffe', 'nominal power', 'power', 'power output',
      'output thermique', 'potenza nominale', 'potenza',
    ],
  },
  {
    key: 'power_min_kw',
    label: 'Puissance min',
    unit: 'kW',
    type: 'number',
    applies_to: ['granules', 'hybride'],
    group: 'power',
    aliases: ['puissance min', 'puissance minimale', 'min power', 'minimum power'],
  },
  {
    key: 'power_max_kw',
    label: 'Puissance max',
    unit: 'kW',
    type: 'number',
    applies_to: ['granules', 'hybride'],
    group: 'power',
    aliases: ['puissance max', 'puissance maximale', 'max power', 'maximum power'],
  },

  // ================= Performance =================
  {
    key: 'efficiency_pct',
    label: 'Rendement',
    unit: '%',
    type: 'number',
    required: true,
    applies_to: ALL_FUELS,
    group: 'performance',
    aliases: ['rendement', 'efficacite', 'efficacité', 'efficiency', 'rendement energetique', 'rendement énergétique'],
  },
  {
    key: 'energy_class',
    label: 'Classe énergétique',
    type: 'enum',
    options: ENERGY_CLASSES,
    required: true,
    applies_to: ALL_FUELS,
    group: 'performance',
    aliases: ['classe energetique', 'classe énergétique', 'energy class', 'etiquette energie', 'étiquette énergie'],
  },
  {
    key: 'eco_design_2022',
    label: 'Eco Design 2022',
    type: 'boolean',
    applies_to: ALL_FUELS,
    group: 'performance',
    aliases: ['eco design 2022', 'ecodesign 2022', 'ecoconception 2022', 'ecoconception', 'ecodesign'],
  },
  {
    key: 'heating_surface_min_m2',
    label: 'Surface de chauffe min',
    unit: 'm²',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'performance',
    aliases: ['surface chauffe min', 'surface min', 'surface minimale'],
  },
  {
    key: 'heating_surface_max_m2',
    label: 'Surface de chauffe max',
    unit: 'm²',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'performance',
    aliases: [
      'surface de chauffage', 'surface chauffe', 'surface chauffe max',
      'surface max', 'heating surface', 'surface de chauffage env',
    ],
  },

  // ================= Émissions =================
  {
    key: 'dust_emission_mg_m3',
    label: 'Poussières fines',
    unit: 'mg/m³',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'emissions',
    aliases: ['poussieres fines', 'poussières fines', 'particules fines', 'pm', 'particulates', 'dust'],
  },
  {
    key: 'co_emission_pct',
    label: 'Émissions CO',
    unit: '%',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'emissions',
    aliases: ['emissions co', 'émissions co', 'co emissions', 'monoxyde de carbone'],
  },

  // ================= Raccordements =================
  {
    key: 'flue_outlet_diameter_mm',
    label: 'Sortie fumée',
    unit: 'mm Ø',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'connections',
    aliases: [
      'raccordement au conduit de fumée', 'raccordement conduit fumee',
      'raccordement fumee', 'sortie fumee', 'sortie fumée', 'buse fumee', 'buse fumée',
      'flue outlet', 'flue diameter', 'conduit de fumée sortie',
    ],
  },
  {
    key: 'air_intake_diameter_mm',
    label: 'Air frais',
    unit: 'mm Ø',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'connections',
    aliases: [
      'apport air frais', 'apport d\'air frais', 'air frais', 'entree air frais',
      'entrée air frais', 'fresh air', 'air intake', 'external air intake',
    ],
  },
  {
    key: 'has_direct_air_intake',
    label: 'Entrée air frais direct',
    type: 'boolean',
    applies_to: ALL_FUELS,
    group: 'connections',
    aliases: ['air frais direct', 'raccordement direct', 'air exterieur direct'],
    hint: 'Raccordement direct à l\'air extérieur (compatible maison BBC/RT2012)',
  },

  // ================= Distances sécurité =================
  {
    key: 'distance_back_cm',
    label: 'Distance arrière',
    unit: 'cm',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'safety',
    aliases: ['distance arriere', 'distance arrière', 'distance back', 'rear distance'],
  },
  {
    key: 'distance_side_cm',
    label: 'Distance latéral',
    unit: 'cm',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'safety',
    aliases: ['distance lateral', 'distance latéral', 'distance cote', 'distance côté', 'side distance'],
  },
  {
    key: 'distance_front_cm',
    label: 'Distance devant',
    unit: 'cm',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'safety',
    aliases: ['distance devant', 'distance avant', 'front distance'],
  },

  // ================= Dimensions & poids =================
  {
    key: 'weight_kg',
    label: 'Poids',
    unit: 'kg',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'dimensions',
    aliases: ['poids', 'weight'],
    hint: 'Version de base (variantes pierre dans extras ou variantes séparées)',
  },
  {
    key: 'height_mm',
    label: 'Hauteur',
    unit: 'mm',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'dimensions',
    aliases: ['hauteur', 'height'],
  },
  {
    key: 'width_mm',
    label: 'Largeur',
    unit: 'mm',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'dimensions',
    aliases: ['largeur', 'width', 'diametre', 'diamètre'],
  },
  {
    key: 'depth_mm',
    label: 'Profondeur',
    unit: 'mm',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'dimensions',
    aliases: ['profondeur', 'depth'],
  },

  // ================= Spécifique bois =================
  {
    key: 'log_length_cm',
    label: 'Longueur bûche max',
    unit: 'cm',
    type: 'number',
    applies_to: ['bois', 'hybride'],
    group: 'features',
    aliases: ['longueur buche', 'longueur bûche', 'log length', 'log capacity', 'longueur maximale buche'],
  },

  // ================= Spécifique granulés =================
  {
    key: 'pellet_tank_kg',
    label: 'Réservoir granulés',
    unit: 'kg',
    type: 'number',
    applies_to: ['granules', 'hybride'],
    group: 'features',
    aliases: ['reservoir granules', 'réservoir granulés', 'reservoir pellets', 'pellet tank', 'pellet hopper'],
  },
  {
    key: 'autonomy_min_h',
    label: 'Autonomie min',
    unit: 'h',
    type: 'number',
    applies_to: ['granules', 'hybride'],
    group: 'features',
    aliases: ['autonomie min', 'autonomie minimale'],
  },
  {
    key: 'autonomy_max_h',
    label: 'Autonomie max',
    unit: 'h',
    type: 'number',
    applies_to: ['granules', 'hybride'],
    group: 'features',
    aliases: ['autonomie max', 'autonomie maximale', 'autonomie'],
  },
  {
    key: 'electric_consumption_w',
    label: 'Conso. électrique',
    unit: 'W',
    type: 'number',
    applies_to: ['granules', 'hybride'],
    group: 'features',
    aliases: ['consommation electrique', 'consommation électrique', 'conso electrique', 'electric consumption'],
  },
  {
    key: 'sound_db',
    label: 'Niveau sonore',
    unit: 'dB',
    type: 'number',
    applies_to: ['granules', 'hybride'],
    group: 'features',
    aliases: ['niveau sonore', 'bruit', 'sound level', 'noise level'],
  },
  {
    key: 'has_remote',
    label: 'Télécommande',
    type: 'boolean',
    applies_to: ['granules', 'hybride'],
    group: 'features',
    aliases: ['telecommande', 'télécommande', 'remote control', 'remote'],
  },
  {
    key: 'has_wifi',
    label: 'Wifi / App',
    type: 'boolean',
    applies_to: ['granules', 'hybride'],
    group: 'features',
    aliases: ['wifi', 'application', 'app', 'smartphone', 'connecte', 'connecté'],
  },
  {
    key: 'programmable',
    label: 'Programmation',
    type: 'boolean',
    applies_to: ['granules', 'hybride'],
    group: 'features',
    aliases: ['programmation', 'programmable', 'timer'],
  },

  // ================= Finitions & garantie =================
  {
    key: 'interior_material',
    label: 'Matériau foyer',
    type: 'enum',
    options: INTERIOR_MATERIALS,
    applies_to: ALL_FUELS,
    group: 'finishing',
    aliases: ['materiau foyer', 'matériau foyer', 'interior material', 'intérieur', 'revetement interieur'],
  },
  {
    key: 'warranty_years',
    label: 'Garantie',
    unit: 'ans',
    type: 'number',
    applies_to: ALL_FUELS,
    group: 'finishing',
    aliases: ['garantie', 'warranty'],
  },
];

// ----------------------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------------------

/**
 * Retourne les champs canoniques pertinents pour un fuel_type donné.
 * Si fuelType est null/undefined, retourne tous les champs communs (applies_to inclut tous les fuels).
 */
export function filterByFuelType(fuelType) {
  if (!fuelType) {
    return POELE_CANONICAL_SPECS.filter((f) =>
      ALL_FUELS.every((fuel) => f.applies_to.includes(fuel))
    );
  }
  return POELE_CANONICAL_SPECS.filter((f) => f.applies_to.includes(fuelType));
}

/**
 * Regroupe les champs par groupe (pour affichage formulaire par section).
 */
export function groupFields(fields) {
  const result = {};
  for (const group of POELE_GROUPS) {
    result[group.key] = { ...group, fields: [] };
  }
  for (const field of fields) {
    const g = field.group || 'features';
    if (!result[g]) result[g] = { key: g, label: g, fields: [] };
    result[g].fields.push(field);
  }
  return Object.values(result).filter((g) => g.fields.length > 0);
}

/**
 * Construit un objet specs vide (toutes clés → null) pour un fuel_type.
 * Utile pour initialiser un formulaire.
 */
export function buildEmptyCanonical(fuelType) {
  const out = {};
  for (const field of filterByFuelType(fuelType)) {
    out[field.key] = field.type === 'boolean' ? false : null;
  }
  return out;
}

/**
 * Normalise un libellé pour comparaison (lowercase, sans accents, espaces uniformes).
 */
function normalizeLabel(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mappe un libellé brut (scrapé/importé) vers une clé canonique.
 * Retourne null si aucun match.
 *
 * Exemples :
 *   "PUISSANCE NOMINALE" → 'power_nominal_kw'
 *   "Rendement"          → 'efficiency_pct'
 *   "Raccordement au conduit de fumée (sortie)" → 'flue_outlet_diameter_mm'
 */
export function matchLabelToCanonicalKey(label) {
  const norm = normalizeLabel(label);
  if (!norm) return null;

  // Match exact sur label principal d'abord
  for (const field of POELE_CANONICAL_SPECS) {
    if (normalizeLabel(field.label) === norm) return field.key;
  }

  // Match sur aliases
  for (const field of POELE_CANONICAL_SPECS) {
    const aliases = field.aliases || [];
    for (const alias of aliases) {
      if (normalizeLabel(alias) === norm) return field.key;
    }
  }

  // Match partiel : alias inclus dans le label (ex: "raccordement au conduit de fumée (sortie)" contient "raccordement fumee")
  for (const field of POELE_CANONICAL_SPECS) {
    const aliases = [field.label, ...(field.aliases || [])];
    for (const alias of aliases) {
      const nAlias = normalizeLabel(alias);
      if (nAlias.length > 3 && norm.includes(nAlias)) return field.key;
    }
  }

  return null;
}

/**
 * Parse une valeur brute (string) en tenant compte du type du champ.
 * "7,0 kW" → 7.0 pour type=number
 * "Oui" / "Yes" / "true" → true pour type=boolean
 */
export function parseSpecValue(key, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  const field = POELE_CANONICAL_SPECS.find((f) => f.key === key);
  if (!field) return rawValue;

  const raw = String(rawValue).trim();

  if (field.type === 'number') {
    // "7,0 kW" → "7.0" → 7.0 ; "env. 100-140 m²" → on prend le premier nombre trouvé
    const cleaned = raw.replace(',', '.').replace(/[^\d.\-]/g, ' ').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;
    const n = parseFloat(parts[0]);
    return isNaN(n) ? null : n;
  }

  if (field.type === 'boolean') {
    const lc = raw.toLowerCase();
    if (['oui', 'yes', 'true', 'vrai', '1', 'x', '✓'].includes(lc)) return true;
    if (['non', 'no', 'false', 'faux', '0', ''].includes(lc)) return false;
    return null;
  }

  if (field.type === 'enum') {
    // Match tolérant à la casse
    const match = (field.options || []).find((opt) =>
      normalizeLabel(opt) === normalizeLabel(raw)
    );
    return match || raw;
  }

  return raw;
}

/**
 * Parse une plage "env. 100-140 m²" en deux valeurs.
 * Retourne { min, max } ou { min: null, max: null } si pas de plage.
 */
export function parseRangeValue(rawValue) {
  if (!rawValue) return { min: null, max: null };
  const cleaned = String(rawValue).replace(',', '.');
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*[-–à]\s*(\d+(?:\.\d+)?)/);
  if (match) {
    return { min: parseFloat(match[1]), max: parseFloat(match[2]) };
  }
  const single = cleaned.match(/(\d+(?:\.\d+)?)/);
  return { min: null, max: single ? parseFloat(single[1]) : null };
}

/**
 * Formate une valeur pour affichage (avec unité).
 * "7" + unit="kW" → "7 kW"
 * null → "—"
 */
export function formatSpecValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  const field = POELE_CANONICAL_SPECS.find((f) => f.key === key);
  if (!field) return String(value);

  if (field.type === 'boolean') return value ? 'Oui' : 'Non';

  if (field.type === 'number') {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return '—';
    const formatted = Number.isInteger(num) ? num.toString() : num.toFixed(1).replace('.', ',');
    return field.unit ? `${formatted} ${field.unit}` : formatted;
  }

  return String(value);
}

/**
 * Valide un objet canonical : retourne { valid, missing: string[] }.
 */
export function validateCanonical(canonical, fuelType) {
  const fields = filterByFuelType(fuelType);
  const missing = [];
  for (const f of fields) {
    if (f.required) {
      const v = canonical?.[f.key];
      if (v === null || v === undefined || v === '') missing.push(f.label);
    }
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Retourne les 3-4 specs clés pour affichage compact (picker, card).
 * Puissance / Rendement / Classe énergétique + une spécifique au fuel.
 */
export function getKeySpecs(canonical, fuelType) {
  if (!canonical) return [];
  const keys = ['power_nominal_kw', 'efficiency_pct', 'energy_class'];
  if (fuelType === 'bois') keys.push('log_length_cm');
  if (fuelType === 'granules' || fuelType === 'hybride') keys.push('autonomy_max_h');

  return keys
    .map((key) => {
      const field = POELE_CANONICAL_SPECS.find((f) => f.key === key);
      if (!field) return null;
      const value = canonical[key];
      if (value === null || value === undefined || value === '') return null;
      return { key, label: field.label, value, formatted: formatSpecValue(key, value) };
    })
    .filter(Boolean);
}
