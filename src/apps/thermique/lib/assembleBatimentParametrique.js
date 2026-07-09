// src/apps/thermique/lib/assembleBatimentParametrique.js
// Assembleur PARAMÉTRIQUE (2026-07-09) : saisie (emprise + pièces paramétriques) → batiment résolu
// pour calculeBatiment. Module PUR. Remplace la chaîne géométrique deduireParois/assembleBatiment
// pour le mode 'parametrique' — le moteur physique (thermalEngine) reste inchangé.
import { surfaceCm2, perimetreCm } from './geometryEngine.js';
import { uDefautPour } from './refDataResolvers.js';

/** Dérivés d'une emprise dessinée : surface au sol (m²) et périmètre extérieur (m). */
export function empriseDerives(emprise) {
  const poly = emprise?.polygone;
  if (!Array.isArray(poly) || poly.length < 3) return { surfaceSol: 0, perimetre: 0 };
  return { surfaceSol: surfaceCm2(poly) / 10000, perimetre: perimetreCm(poly) / 100 };
}

const TYPE_U_DEFAUT = { murs: 'mur', plancherBas: 'plancherBas', plafondToiture: 'plafond' };

/** U résolu pour une famille sur une pièce : exception (pièce×famille) > famille (défaut année | valeur). */
export function resoudUFamille(compositions, famille, pieceId, { uDefauts, annee }) {
  const excP = compositions?.exceptions?.parois?.[`${pieceId}:${famille}`];
  if (excP && Number.isFinite(excP.u)) return excP.u;
  const fam = compositions?.familles?.[famille] ?? {};
  if (fam.mode === 'defaut' && TYPE_U_DEFAUT[famille]) {
    return uDefautPour(uDefauts, TYPE_U_DEFAUT[famille], annee);
  }
  return Number.isFinite(fam.u) ? fam.u : null;
}
