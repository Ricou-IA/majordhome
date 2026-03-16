/**
 * scoringCommercial.js — Algorithme de scoring pour prospects Commerciaux
 * Score 0-100 points, critères orientés prospection commerciale.
 */

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Calcule le score d'un prospect pour le module Commercial.
 * @param {Object} prospect - Objet prospect (shape DB ou mapResultToProspect)
 * @param {Object} [options]
 * @param {string[]} [options.targetNaf] - Codes NAF cibles (configurables)
 * @param {string[]} [options.targetDepartements] - Departements cibles
 * @returns {number} Score 0-100
 */
export function computeScoreCommercial(prospect, options = {}) {
  const { targetNaf = [], targetDepartements = [] } = options;
  let score = 0;

  // 1. NAF pertinent → +20
  if (prospect.naf && targetNaf.length > 0 && targetNaf.includes(prospect.naf)) {
    score += 20;
  }

  // 2. Departement proche → +20
  if (prospect.departement && targetDepartements.length > 0) {
    if (targetDepartements.includes(prospect.departement)) {
      score += 20;
    }
  }

  // 3. CA cible → max +15
  if (prospect.ca_annuel) {
    if (prospect.ca_annuel > 500000) score += 15;
    else if (prospect.ca_annuel > 200000) score += 10;
    else if (prospect.ca_annuel > 50000) score += 5;
  }

  // 4. Effectif → max +15
  const effectif = parseEffectif(prospect.tranche_effectif_salarie);
  if (effectif > 10) score += 15;
  else if (effectif > 5) score += 10;
  else if (effectif > 0) score += 5;

  // 5. Sante financiere → +10
  if (prospect.resultat_net != null && prospect.resultat_net > 0) {
    score += 10;
  }

  // 6. Employeur → +10
  if (effectif > 0) {
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
  const match = tranche.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}
