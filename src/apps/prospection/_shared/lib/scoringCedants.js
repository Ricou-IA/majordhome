/**
 * scoringCedants.js — Algorithme de scoring pour prospects Cédants
 * Score 0-100 points, critères orientés acquisition.
 */

const CURRENT_YEAR = new Date().getFullYear();

const TARGET_NAF = ['43.22A', '43.22B', '43.21A'];
const TARGET_DEPARTEMENTS = ['81', '12', '31', '82', '46', '32'];

/**
 * Calcule le score d'un prospect pour le module Cédants.
 * @param {Object} prospect - Objet prospect (shape DB ou mapResultToProspect)
 * @returns {number} Score 0-100
 */
export function computeScoreCedants(prospect) {
  let score = 0;

  // 1. NAF CVC exact → +25
  if (prospect.naf && TARGET_NAF.includes(prospect.naf)) {
    score += 25;
  }

  // 2. Age dirigeant (proximite retraite) → max +20
  if (prospect.dirigeant_annee_naissance) {
    const age = CURRENT_YEAR - prospect.dirigeant_annee_naissance;
    if (age >= 55) score += 20;
    else if (age >= 50) score += 10;
    else if (age >= 45) score += 5;
  }

  // 3. CA → max +15
  if (prospect.ca_annuel) {
    if (prospect.ca_annuel > 500000) score += 15;
    else if (prospect.ca_annuel > 200000) score += 10;
    else if (prospect.ca_annuel > 100000) score += 5;
  }

  // 4. Effectif → max +10
  const effectif = parseEffectif(prospect.tranche_effectif_salarie);
  if (effectif > 5) score += 10;
  else if (effectif > 2) score += 5;

  // 5. Resultat net positif → +10
  if (prospect.resultat_net != null && prospect.resultat_net > 0) {
    score += 10;
  }

  // 6. Departement cible → +10
  if (prospect.departement && TARGET_DEPARTEMENTS.includes(prospect.departement)) {
    score += 10;
  }

  // 7. Anciennete → max +10
  if (prospect.date_creation) {
    const yearCreated = parseInt(prospect.date_creation.substring(0, 4), 10);
    if (yearCreated) {
      const anciennete = CURRENT_YEAR - yearCreated;
      if (anciennete > 10) score += 10;
      else if (anciennete > 5) score += 5;
    }
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Extrait un nombre approximatif d'effectifs depuis le label tranche.
 */
function parseEffectif(tranche) {
  if (!tranche) return 0;
  // Tente d'extraire le premier nombre
  const match = tranche.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}
