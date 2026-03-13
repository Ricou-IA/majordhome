/**
 * FicheTechniqueConfig.js - Majord'home Artisan
 * ============================================================================
 * Constantes de configuration pour la Fiche Technique Terrain.
 * Pattern identique à LeadStatusConfig.js
 * ============================================================================
 */

// Types de bâtiment
export const BUILDING_TYPES = [
  { value: 'maison_individuelle', label: 'Maison individuelle' },
  { value: 'appartement', label: 'Appartement' },
  { value: 'immeuble', label: 'Immeuble' },
  { value: 'local_commercial', label: 'Local commercial' },
  { value: 'batiment_industriel', label: 'Bâtiment industriel' },
  { value: 'autre', label: 'Autre' },
];

// Qualité isolation
export const INSULATION_TYPES = [
  { value: 'bonne', label: 'Bonne' },
  { value: 'moyenne', label: 'Moyenne' },
  { value: 'faible', label: 'Faible' },
  { value: 'inconnue', label: 'Inconnue' },
];

// Types de vitrage
export const GLAZING_TYPES = [
  { value: 'simple', label: 'Simple vitrage' },
  { value: 'double', label: 'Double vitrage' },
  { value: 'triple', label: 'Triple vitrage' },
  { value: 'mixte', label: 'Mixte' },
  { value: 'inconnu', label: 'Inconnu' },
];

// DPE
export const DPE_RATINGS = [
  { value: 'A', label: 'A', color: '#319834' },
  { value: 'B', label: 'B', color: '#33a357' },
  { value: 'C', label: 'C', color: '#cbdb2a' },
  { value: 'D', label: 'D', color: '#f2e600' },
  { value: 'E', label: 'E', color: '#f0b200' },
  { value: 'F', label: 'F', color: '#eb8235' },
  { value: 'G', label: 'G', color: '#d7221f' },
];

// Énergie existante
export const ENERGY_TYPES = [
  { value: 'gaz', label: 'Gaz naturel' },
  { value: 'fioul', label: 'Fioul' },
  { value: 'electrique', label: 'Électricité' },
  { value: 'bois', label: 'Bois / Granulés' },
  { value: 'pompe_chaleur', label: 'Pompe à chaleur' },
  { value: 'autre', label: 'Autre' },
  { value: 'aucune', label: 'Aucune' },
];

// État équipement existant
export const EQUIPMENT_CONDITIONS = [
  { value: 'bon', label: 'Bon état' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'mauvais', label: 'Mauvais' },
  { value: 'hors_service', label: 'Hors service' },
];

// Type ECS
export const ECS_TYPES = [
  { value: 'ballon_electrique', label: 'Ballon électrique' },
  { value: 'chaudiere_integree', label: 'Chaudière intégrée' },
  { value: 'thermodynamique', label: 'Thermodynamique' },
  { value: 'solaire', label: 'Solaire' },
  { value: 'instantane', label: 'Instantané' },
  { value: 'autre', label: 'Autre' },
  { value: 'aucun', label: 'Aucun' },
];

// Type de climatisation existante
export const AC_TYPES = [
  { value: 'gainable', label: 'Gainable' },
  { value: 'split', label: 'Split' },
];

// Accès extérieur
export const OUTDOOR_ACCESS = [
  { value: 'facile', label: 'Facile' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'difficile', label: 'Difficile' },
  { value: 'impossible', label: 'Impossible' },
];

// Catégories de photos
export const PHOTO_CATEGORIES = [
  { value: 'facade', label: 'Façade / Accès' },
  { value: 'installation', label: 'Installation existante' },
  { value: 'implantation_zone', label: "Zone d'implantation" },
  { value: 'electrical_panel', label: 'Tableau électrique' },
  { value: 'other', label: 'Autre' },
];

// Suites à donner
export const NEXT_STEPS = [
  { key: 'next_devis', label: 'Établir un devis' },
  { key: 'next_etude_technique', label: 'Étude technique complémentaire' },
  { key: 'next_visite_complementaire', label: 'Visite complémentaire nécessaire' },
  { key: 'next_dossier_aides', label: "Monter le dossier d'aides" },
  { key: 'next_rdv_signature', label: 'RDV signature' },
];

// Statut de la fiche
export const FICHE_STATUS_CONFIG = {
  not_started: { label: 'Non renseignée', color: 'bg-gray-100 text-gray-600', dotColor: '#9ca3af' },
  in_progress: { label: 'En cours', color: 'bg-amber-100 text-amber-700', dotColor: '#d97706' },
  completed: { label: 'Complétée', color: 'bg-emerald-100 text-emerald-700', dotColor: '#059669' },
};

/**
 * Calcule le statut de la fiche en fonction des champs remplis.
 * Helper pur (pas d'appel DB).
 */
export function computeVisitStatus(visit) {
  if (!visit) return 'not_started';

  // Champs « relevé technique » considérés comme importants
  const technicalFields = [
    'existing_energy', 'existing_equipment_type', 'existing_condition',
    'outdoor_access', 'electrical_panel_ok',
  ];

  const hasAnyTechnical = technicalFields.some((f) => visit[f] != null && visit[f] !== '');
  const hasKeyPoints = !!visit.key_points?.trim();
  const hasRecommendation = !!visit.product_recommendation?.trim();

  // Tous les champs techniques remplis + synthèse = completed
  const allTechnicalFilled = technicalFields.every((f) => visit[f] != null && visit[f] !== '');
  if (allTechnicalFilled && hasKeyPoints && hasRecommendation) {
    return 'completed';
  }

  // Au moins un champ rempli = in_progress
  const anyField = hasAnyTechnical || hasKeyPoints || hasRecommendation
    || visit.building_type || visit.existing_observations?.trim()
    || visit.specific_constraints?.trim();

  if (anyField) return 'in_progress';

  return 'not_started';
}
