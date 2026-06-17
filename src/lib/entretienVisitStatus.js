/**
 * entretienVisitStatus.js
 * Dérive le statut d'affichage du bloc "Visite {année}" du modal entretien.
 * Source unique = visites enregistrées (contract_visits) + carte entretien active.
 *
 * Fix bug : une visite refusée (cancelled) de l'année courante est une TÂCHE CLOSE
 * (≠ "à faire") → 'non_realise'. Idem 'skipped'.
 *
 * @param {Object} p
 * @param {Array<{visit_year:number,status:string}>} [p.visits]
 * @param {{workflow_status?:string}|null} [p.activeCard]
 * @param {number} p.currentYear
 * @returns {'realise'|'non_realise'|'planifie'|'a_planifier'}
 */
export function deriveVisitBadgeStatus({ visits = [], activeCard = null, currentYear }) {
  const currentYearVisit = (visits || []).find((v) => v.visit_year === currentYear);
  if (currentYearVisit?.status === 'completed') return 'realise';
  if (currentYearVisit) return 'non_realise'; // cancelled / skipped / autre = tâche close
  if (activeCard?.workflow_status === 'planifie') return 'planifie';
  return 'a_planifier';
}
