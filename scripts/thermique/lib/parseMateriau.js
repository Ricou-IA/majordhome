// Parseur des fiches matériaux du logiciel Thermique historique (Composants/<famille>/...).
import { unquote, parseFrNumber } from './sourceFiles.js';

/**
 * Format Composants/<famille>/.../<nom>.txt :
 * L1 source · L2 masse volumique kg/m³ · L3 λ W/(m·K) · L4 capacité J/(kg·K)
 * @returns {{nom,famille,lambda,masseVolumique,capacite,source}|null}
 */
export function parseMateriau(contenu, nom, famille) {
  const l = contenu.split(/\r?\n/).map(unquote);
  const lambda = parseFrNumber(l[2]);
  if (lambda == null || lambda <= 0 || lambda > 500) return null; // garde-fou physique
  return {
    nom, famille,
    lambda,
    masseVolumique: parseFrNumber(l[1]),
    capacite: parseFrNumber(l[3]),
    source: l[0] || null,
  };
}
