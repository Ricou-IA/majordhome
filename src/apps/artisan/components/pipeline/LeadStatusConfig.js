/**
 * LeadStatusConfig.js
 * ============================================================================
 * Configuration pipeline : transitions autorisées, labels, causes de perte
 * Extrait de LeadModal.jsx pour réutilisation
 * ============================================================================
 */

// Labels catégories équipements (même que EquipmentFormModal)
export const EQUIPMENT_CATEGORY_LABELS = {
  poeles: 'Poêles',
  chaudieres: 'Chaudières',
  climatisation: 'Climatisation / PAC',
  eau_chaude: 'Eau chaude',
  energie: 'Énergie',
};

// Causes de perte prédéfinies
export const LOST_REASONS = [
  { value: 'Prix', label: 'Prix' },
  { value: 'Ghost', label: 'Ghost' },
  { value: 'Délai', label: 'Délai' },
  { value: 'Qualif', label: 'Qualif' },
  { value: 'Annulé', label: 'Annulé' },
  { value: 'Tech', label: 'Tech' },
];

/**
 * Transitions autorisées par statut
 * Nouveau → Contacté, RDV planifié, Perdu
 * Contacté → RDV planifié, Perdu
 * RDV planifié → Devis envoyé, Perdu
 * Devis envoyé → Gagné, Perdu
 * Gagné / Perdu → terminaux (pas de transition)
 */
export const ALLOWED_TRANSITIONS = {
  'Nouveau': ['Contacté', 'RDV planifié', 'Perdu'],
  'Contacté': ['RDV planifié', 'Perdu'],
  'RDV planifié': ['Devis envoyé', 'Perdu'],
  'Devis envoyé': ['Gagné', 'Perdu'],
  'Gagné': [],
  'Perdu': [],
};

/**
 * Retourne les statuts autorisés comme prochaine étape
 */
export function getAllowedNextStatuses(currentLabel, allStatuses) {
  const allowedLabels = ALLOWED_TRANSITIONS[currentLabel];
  if (!allowedLabels || allowedLabels.length === 0) return [];
  return allStatuses.filter((s) => allowedLabels.includes(s.label));
}
