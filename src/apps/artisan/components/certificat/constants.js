/**
 * constants.js - Certificat d'Entretien & Ramonage
 * ============================================================================
 * Sections conditionnelles, labels contrôles/nettoyage/mesures par type
 * d'équipement. Source de vérité pour le wizard et le PDF.
 * ============================================================================
 */

// ============================================================================
// SECTIONS PAR TYPE D'ÉQUIPEMENT
// ============================================================================

export const SECTIONS_PAR_EQUIPEMENT = {
  pac_air_eau:        { showRamonage: false, showFGaz: true,  showBruleur: false, showCendres: false, mesuresLabel: 'pac',        tvaDefaut: 5.5 },
  pac_air_air:        { showRamonage: false, showFGaz: true,  showBruleur: false, showCendres: false, mesuresLabel: 'pac',        tvaDefaut: 5.5 },
  climatisation:      { showRamonage: false, showFGaz: true,  showBruleur: false, showCendres: false, mesuresLabel: 'pac',        tvaDefaut: 20  },
  poele:              { showRamonage: true,  showFGaz: false, showBruleur: true,  showCendres: true,  mesuresLabel: 'combustion', tvaDefaut: 5.5 },
  chaudiere_bois:     { showRamonage: true,  showFGaz: false, showBruleur: true,  showCendres: true,  mesuresLabel: 'combustion', tvaDefaut: 5.5 },
  chaudiere_fioul:    { showRamonage: true,  showFGaz: false, showBruleur: true,  showCendres: false, mesuresLabel: 'combustion', tvaDefaut: 10  },
  chaudiere_gaz:      { showRamonage: true,  showFGaz: false, showBruleur: true,  showCendres: false, mesuresLabel: 'combustion', tvaDefaut: 10  },
  chauffe_eau_thermo: { showRamonage: false, showFGaz: true,  showBruleur: false, showCendres: false, mesuresLabel: 'ecs',        tvaDefaut: 10  },
  ballon_ecs:         { showRamonage: false, showFGaz: false, showBruleur: false, showCendres: false, mesuresLabel: 'ecs',        tvaDefaut: 10  },
  vmc:                { showRamonage: false, showFGaz: false, showBruleur: false, showCendres: false, mesuresLabel: 'aeraulique', tvaDefaut: 10  },
  autre:              { showRamonage: false, showFGaz: false, showBruleur: false, showCendres: false, mesuresLabel: 'combustion', tvaDefaut: 20  },
};

// ============================================================================
// LABELS TYPE ÉQUIPEMENT
// ============================================================================

export const EQUIPMENT_CATEGORY_LABELS = {
  pac_air_eau:        'PAC Air-Eau',
  pac_air_air:        'PAC Air-Air',
  climatisation:      'Climatisation',
  poele:              'Poêle',
  chaudiere_bois:     'Chaudière bois',
  chaudiere_fioul:    'Chaudière fioul',
  chaudiere_gaz:      'Chaudière gaz',
  chauffe_eau_thermo: 'Chauffe-eau thermodynamique',
  ballon_ecs:         'Ballon ECS',
  vmc:                'VMC',
  autre:              'Autre',
};

// ============================================================================
// CONTRÔLES SÉCURITÉ
// ============================================================================

export const CONTROLES_SECURITE_ITEMS = [
  { key: 'dispositifs_securite',    label: 'Dispositifs de sécurité' },
  { key: 'analyse_combustion',      label: 'Analyse de combustion' },
  { key: 'etancheite_circuit',      label: 'Étanchéité du circuit' },
  { key: 'pression_circuit_bar',    label: 'Pression du circuit', hasNumericField: true, numericLabel: 'Pression (bar)', numericKey: 'pression_circuit_bar' },
  { key: 'pression_conforme',       label: 'Pression conforme' },
  { key: 'alimentation_electrique', label: 'Alimentation électrique' },
  { key: 'regulation_thermostat',   label: 'Régulation / thermostat' },
  { key: 'vannes_robinets',         label: 'Vannes et robinets' },
  { key: 'vase_expansion_bar',      label: 'Vase d\'expansion', hasNumericField: true, numericLabel: 'Pression vase (bar)', numericKey: 'vase_expansion_bar' },
  { key: 'vase_expansion_conforme', label: 'Vase d\'expansion conforme' },
  { key: 'bruleur_allumeur',        label: 'Brûleur / allumeur' },
];

// ============================================================================
// NETTOYAGE COMPOSANTS
// ============================================================================

export const NETTOYAGE_ITEMS = [
  { key: 'corps_chauffe',        label: 'Corps de chauffe' },
  { key: 'filtre_air',           label: 'Filtre à air' },
  { key: 'bac_condensats',       label: 'Bac à condensats' },
  { key: 'chambre_combustion',   label: 'Chambre de combustion' },
  { key: 'bruleur_photocellule', label: 'Brûleur / photocellule', requiresBruleur: true },
  { key: 'circuit_air',          label: 'Circuit d\'air' },
  { key: 'bac_cendres_vis',      label: 'Bac à cendres / vis', requiresCendres: true },
  { key: 'ventilateurs',         label: 'Ventilateurs' },
  { key: 'caisson_electrique',   label: 'Caisson électrique' },
];

/**
 * Retourne les items de nettoyage filtrés selon le type d'équipement
 */
export function getNettoyageItems(equipmentCategory) {
  const config = SECTIONS_PAR_EQUIPEMENT[equipmentCategory] || SECTIONS_PAR_EQUIPEMENT.autre;
  return NETTOYAGE_ITEMS.filter(item => {
    if (item.requiresBruleur && !config.showBruleur) return false;
    if (item.requiresCendres && !config.showCendres) return false;
    return true;
  });
}

// ============================================================================
// MESURES PAR TYPE
// ============================================================================

export const MESURES_PAR_TYPE = {
  pac: [
    { key: 'temperature_depart_c',      label: 'Température départ',    unit: '°C' },
    { key: 'temperature_retour_c',      label: 'Température retour',    unit: '°C' },
    { key: 'delta_t_c',                 label: 'Delta T',               unit: '°C' },
    { key: 'temperature_interieure_c',  label: 'Température intérieure', unit: '°C' },
    { key: 'temperature_exterieure_c',  label: 'Température extérieure', unit: '°C' },
    { key: 'cop_mesure',                label: 'COP mesuré',            unit: '' },
    { key: 'consommation_kwh',          label: 'Consommation',          unit: 'kWh' },
  ],
  combustion: [
    { key: 'temperature_depart_c',       label: 'Température départ',     unit: '°C' },
    { key: 'temperature_retour_c',       label: 'Température retour',     unit: '°C' },
    { key: 'delta_t_c',                  label: 'Delta T',                unit: '°C' },
    { key: 'temperature_interieure_c',   label: 'Température intérieure', unit: '°C' },
    { key: 'temperature_exterieure_c',   label: 'Température extérieure', unit: '°C' },
    { key: 'taux_co2_fumees_pct',        label: 'Taux CO₂ fumées',       unit: '%' },
    { key: 'taux_co_fumees_ppm',         label: 'Taux CO fumées',        unit: 'ppm' },
    { key: 'rendement_combustion_pct',   label: 'Rendement combustion',  unit: '%' },
  ],
  ecs: [
    { key: 'temperature_depart_c',      label: 'Température départ eau', unit: '°C' },
    { key: 'temperature_retour_c',      label: 'Température retour',     unit: '°C' },
    { key: 'temperature_interieure_c',  label: 'Température ambiante',   unit: '°C' },
    { key: 'consommation_kwh',          label: 'Consommation',           unit: 'kWh' },
  ],
  aeraulique: [
    { key: 'temperature_interieure_c',  label: 'Température intérieure', unit: '°C' },
    { key: 'temperature_exterieure_c',  label: 'Température extérieure', unit: '°C' },
    { key: 'consommation_kwh',          label: 'Consommation',           unit: 'kWh' },
  ],
};

// ============================================================================
// CERTIFICATIONS TECHNICIEN
// ============================================================================

export const CERTIFICATIONS_TECHNICIEN = [
  'QualiPAC',
  'QualiBois',
  'QualiPV',
  'F-Gaz cat. I',
  'F-Gaz cat. II',
];

// ============================================================================
// COMBUSTIBLES
// ============================================================================

export const COMBUSTIBLES = [
  { value: 'granules',  label: 'Granulés' },
  { value: 'buches',    label: 'Bûches' },
  { value: 'gaz',       label: 'Gaz naturel' },
  { value: 'propane',   label: 'Propane' },
  { value: 'fioul',     label: 'Fioul' },
  { value: 'autre',     label: 'Autre' },
];

// ============================================================================
// FLUIDES FRIGORIGÈNES
// ============================================================================

export const FLUIDES_FRIGORIGENES = [
  { value: 'R32',   label: 'R32' },
  { value: 'R410A', label: 'R410A' },
  { value: 'R407C', label: 'R407C' },
  { value: 'R134a', label: 'R134a' },
  { value: 'R290',  label: 'R290 (Propane)' },
  { value: 'autre', label: 'Autre' },
];

// ============================================================================
// TVA
// ============================================================================

export const TVA_OPTIONS = [
  { value: 5.5,  label: '5,5 %' },
  { value: 10,   label: '10 %' },
  { value: 20,   label: '20 %' },
];

// ============================================================================
// MÉTHODES RAMONAGE
// ============================================================================

export const METHODES_RAMONAGE = [
  { value: 'mecanique',  label: 'Mécanique' },
  { value: 'chimique',   label: 'Chimique' },
  { value: 'aspiration', label: 'Aspiration' },
  { value: 'autre',      label: 'Autre' },
];

export const TAUX_DEPOTS = [
  { value: 'faible',    label: 'Faible' },
  { value: 'moyen',     label: 'Moyen' },
  { value: 'important', label: 'Important' },
  { value: 'critique',  label: 'Critique' },
];

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Calcule les étapes à afficher selon le type d'équipement
 */
export function getSteps(equipmentCategory) {
  const config = SECTIONS_PAR_EQUIPEMENT[equipmentCategory] || SECTIONS_PAR_EQUIPEMENT.autre;

  const steps = [
    { id: 'equipement',  label: 'Équipement' },
    { id: 'infos',       label: 'Infos' },
    { id: 'controles',   label: 'Contrôles' },
    { id: 'nettoyage',   label: 'Nettoyage' },
  ];

  if (config.showRamonage) steps.push({ id: 'ramonage', label: 'Ramonage' });
  if (config.showFGaz)     steps.push({ id: 'fgaz',     label: 'F-Gaz' });

  steps.push(
    { id: 'mesures',   label: 'Mesures' },
    { id: 'pieces',    label: 'Pièces' },
    { id: 'bilan',     label: 'Bilan' },
    { id: 'signature', label: 'Signature' },
  );

  return steps;
}

/**
 * Type de document déduit du type d'équipement
 */
export function getTypeDocument(equipmentCategory) {
  const config = SECTIONS_PAR_EQUIPEMENT[equipmentCategory] || SECTIONS_PAR_EQUIPEMENT.autre;
  if (config.showRamonage && config.showFGaz) return 'entretien_ramonage';
  if (config.showRamonage) return 'entretien_ramonage';
  return 'entretien';
}

/**
 * Initialise les données vides du formulaire
 */
export function getEmptyFormData() {
  return {
    // Équipement snapshot
    equipement_type: '',
    equipement_marque: '',
    equipement_modele: '',
    equipement_numero_serie: '',
    equipement_annee: null,
    equipement_puissance_kw: null,
    equipement_fluide: '',
    equipement_charge_kg: null,
    combustible: '',

    // Technicien
    technicien_id: null,
    technicien_nom: '',
    technicien_certifications: ['QualiPAC', 'QualiBois'],
    technicien_num_fgaz: '',

    // Données entretien
    donnees_entretien: {
      controles_securite: {},
      nettoyage: {},
      fgaz: null,
    },

    // Ramonage (nullable)
    donnees_ramonage: null,

    // Mesures
    mesures: {},

    // Pièces
    pieces_remplacees: [],

    // Bilan
    bilan_conformite: 'conforme',
    anomalies_detail: '',
    action_corrective: '',
    recommandations: '',
    prochaine_intervention: `${new Date().getFullYear() + 1}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    tva_taux: 5.5,

    // Date
    date_intervention: '',
    type_document: 'entretien',
  };
}
