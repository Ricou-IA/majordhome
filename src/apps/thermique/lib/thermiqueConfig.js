// src/apps/thermique/lib/thermiqueConfig.js
// Constantes app + défauts org du module Thermique — module PUR (aucun import).
// Les valeurs org vivent dans core.organizations.settings.thermique (page /settings/thermique).
// ⚠ org_update_settings merge JSONB niveau 1 → toujours sauver l'objet `thermique` COMPLET.

/** Types de pièce (D1/D2). principale → dimensionne les débits VMC ; humide → débit soufflé 0. */
export const TYPES_PIECE = [
  { id: 'sejour',    label: 'Séjour',        principale: true,  humide: false, chauffeeParDefaut: true },
  { id: 'chambre',   label: 'Chambre',       principale: true,  humide: false, chauffeeParDefaut: true },
  { id: 'cuisine',   label: 'Cuisine',       principale: false, humide: true,  chauffeeParDefaut: true },
  { id: 'sdb',       label: 'Salle de bain', principale: false, humide: true,  chauffeeParDefaut: true },
  { id: 'wc',        label: 'WC',            principale: false, humide: true,  chauffeeParDefaut: true },
  { id: 'buanderie', label: 'Buanderie',     principale: false, humide: true,  chauffeeParDefaut: true },
  { id: 'bureau',    label: 'Bureau',        principale: false, humide: false, chauffeeParDefaut: true },
  { id: 'entree',    label: 'Entrée / dégagement', principale: false, humide: false, chauffeeParDefaut: true },
  { id: 'garage',    label: 'Garage',        principale: false, humide: false, chauffeeParDefaut: false },
  { id: 'cellier',   label: 'Cellier',       principale: false, humide: false, chauffeeParDefaut: false },
  { id: 'autre',     label: 'Autre',         principale: false, humide: false, chauffeeParDefaut: true },
];

export function typePieceInfo(id) {
  return TYPES_PIECE.find((t) => t.id === id) ?? TYPES_PIECE.find((t) => t.id === 'autre');
}

/** Garde-fou W/m² par période (R3) — ordres de grandeur métier, alerte NON bloquante.
 * Labels alignés EXACTEMENT sur resolvePeriode (refDataResolvers.js). */
export const PLAGES_VRAISEMBLANCE = {
  'avant 1974': { min: 60, max: 220 },
  '1975-1977':  { min: 50, max: 180 },
  '1978-1982':  { min: 45, max: 160 },
  '1983-1988':  { min: 40, max: 140 },
  '1989-2000':  { min: 35, max: 120 },
  '2001-2005':  { min: 30, max: 110 },
  '2006-2012':  { min: 25, max: 95 },
  'après 2012': { min: 15, max: 80 },
};

export const REGIMES_EAU = [35, 45, 55]; // °C départ (R11 — constante app v1)

/** Dimensions standard proposées à la pose (cm) — modifiables dans le panneau ouverture. */
export const DIMENSIONS_OUVERTURES = {
  fenetre:        { largeur: 120, hauteur: 130 },
  'porte-fenetre': { largeur: 240, hauteur: 220 },
  porte:          { largeur: 90,  hauteur: 220 },
};

/** Défauts org (éditables /settings/thermique). θint : spec §4 (séjour 20, SdB 24…). */
export const DEFAULTS_THERMIQUE = Object.freeze({
  theta_int_defauts: Object.freeze({
    sejour: 20, chambre: 18, cuisine: 20, sdb: 24, wc: 18, buanderie: 16,
    bureau: 20, entree: 18, garage: 16, cellier: 16, autre: 19,
  }),
  delta_utb: Object.freeze({ 'non-isole': 0.15, iti: 0.10, ite: 0.05 }), // W/(m²·K), D6
  f_rh: 11,                  // W/m² (EN 12831 annexe, abaissement nocturne standard)
  theta_non_chauffage: 16,   // °C (spec §5, défaut climat.json)
  prix_kwh: 0.1952,          // €/kWh élec base (tarifs-energie.json elec-base 2025)
  facteur_ajustement: 1.0,   // conso (apports gratuits/intermittence), à calibrer phase A/B
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Config effective = défauts ⊕ settings.thermique (deep merge sur les 2 tables, shallow sinon).
 * settings.thermique / ses tables malformés (string, array) → ignorés (retour aux défauts). */
export function buildThermiqueConfig(settings) {
  const org = isPlainObject(settings?.thermique) ? settings.thermique : {};
  const thetaOrg = isPlainObject(org.theta_int_defauts) ? org.theta_int_defauts : {};
  const deltaOrg = isPlainObject(org.delta_utb) ? org.delta_utb : {};
  return {
    ...DEFAULTS_THERMIQUE,
    ...org,
    theta_int_defauts: { ...DEFAULTS_THERMIQUE.theta_int_defauts, ...thetaOrg },
    delta_utb: { ...DEFAULTS_THERMIQUE.delta_utb, ...deltaOrg },
  };
}
