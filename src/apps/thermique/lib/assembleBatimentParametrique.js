// src/apps/thermique/lib/assembleBatimentParametrique.js
// Assembleur PARAMÉTRIQUE (2026-07-09) : saisie (emprise + pièces paramétriques) → batiment résolu
// pour calculeBatiment. Module PUR. Remplace la chaîne géométrique deduireParois/assembleBatiment
// pour le mode 'parametrique' — le moteur physique (thermalEngine) reste inchangé.
import { surfaceCm2, perimetreCm } from './geometryEngine.js';

/** Dérivés d'une emprise dessinée : surface au sol (m²) et périmètre extérieur (m). */
export function empriseDerives(emprise) {
  const poly = emprise?.polygone;
  if (!Array.isArray(poly) || poly.length < 3) return { surfaceSol: 0, perimetre: 0 };
  return { surfaceSol: surfaceCm2(poly) / 10000, perimetre: perimetreCm(poly) / 100 };
}
