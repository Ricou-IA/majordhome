/**
 * LeadStatusConfig.js
 * ============================================================================
 * Configuration pipeline : transitions autorisées
 * Extrait de LeadModal.jsx pour réutilisation
 * ============================================================================
 */

/**
 * Transitions autorisées par statut
 * Nouveau → Contacté, RDV planifié, Perdu
 * Contacté → RDV planifié, Perdu
 * RDV planifié → Contacté (régression, ex. RDV annulé), Devis envoyé, Perdu
 * Devis envoyé → Gagné, Perdu
 * Gagné / Perdu → terminaux (pas de transition)
 */
export const ALLOWED_TRANSITIONS = {
  'Nouveau': ['Contacté', 'RDV planifié', 'Devis envoyé', 'Perdu'],
  'Contacté': ['RDV planifié', 'Devis envoyé', 'Perdu'],
  'RDV planifié': ['Contacté', 'Devis envoyé', 'Perdu'],
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
