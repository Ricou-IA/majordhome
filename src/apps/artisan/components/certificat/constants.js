/**
 * constants.js - Certificat d'Entretien & Ramonage
 * ============================================================================
 * Sections conditionnelles, labels contrôles/nettoyage/mesures par type
 * d'équipement. Source de vérité pour le wizard et le PDF.
 * ============================================================================
 */

// ============================================================================
// SECTIONS PAR PROFIL DE CERTIFICAT
// ============================================================================
// Liste FERMÉE niveau app (= ce que le wizard sait produire), reflétée par le
// CHECK de majordhome.equipment_categories.certificate_profile. Le gabarit d'un
// certificat vient de la CATÉGORIE de l'équipement (référentiel de l'org,
// Settings → Tarification → Catégories), plus d'un enum : `profilParCode()`
// de src/lib/equipmentReferential.js résout code de catégorie → profil, et un
// code inconnu tombe sur `generique` (affiché dans le wizard, jamais silencieux).
// La TVA par défaut vient elle aussi de la catégorie (default_vat_rate).

export const PROFIL_GENERIQUE = 'generique';

export const SECTIONS_PAR_PROFIL = {
  combustion_bois:    { showRamonage: true,  showFGaz: false, showBruleur: true,  showCendres: true,  mesuresLabel: 'combustion' },
  combustion_fossile: { showRamonage: true,  showFGaz: false, showBruleur: true,  showCendres: false, mesuresLabel: 'combustion' },
  pac:                { showRamonage: false, showFGaz: true,  showBruleur: false, showCendres: false, mesuresLabel: 'pac'        },
  ecs_thermo:         { showRamonage: false, showFGaz: true,  showBruleur: false, showCendres: false, mesuresLabel: 'ecs'        },
  ecs:                { showRamonage: false, showFGaz: false, showBruleur: false, showCendres: false, mesuresLabel: 'ecs'        },
  aeraulique:         { showRamonage: false, showFGaz: false, showBruleur: false, showCendres: false, mesuresLabel: 'aeraulique' },
  generique:          { showRamonage: false, showFGaz: false, showBruleur: false, showCendres: false, mesuresLabel: 'combustion' },
};

/** Sections d'un profil ; profil inconnu ou absent → générique. */
export function sectionsPourProfil(profil) {
  return SECTIONS_PAR_PROFIL[profil] || SECTIONS_PAR_PROFIL[PROFIL_GENERIQUE];
}

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
 * Retourne les items de nettoyage filtrés selon le profil de certificat
 */
export function getNettoyageItems(profil) {
  const config = sectionsPourProfil(profil);
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
 * Calcule les étapes à afficher selon le profil de certificat
 */
export function getSteps(profil) {
  const config = sectionsPourProfil(profil);

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
 * Type de document déduit du profil de certificat
 */
export function getTypeDocument(profil) {
  const config = sectionsPourProfil(profil);
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
