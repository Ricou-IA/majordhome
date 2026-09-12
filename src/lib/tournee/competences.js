// src/lib/tournee/competences.js
// ============================================================================
// Rôles de compétence des techniciens. Module PUR (Node, Vite, Deno), copié
// pour l'edge par `npm run sync:tournee-engine`. Reflété par le CHECK de
// majordhome.team_member_skills.role (migration 20260913_1).
//
// « Paramétrable pour plus tard » (Eric, 2026-09-12) = remplacer ce tableau et
// le CHECK par une table ; le moteur (proposer-contrat.js) ne change pas.
// Testé : node --test scripts/tournee/competences.test.mjs
// ============================================================================

/** Rôles connus : `entretien` (consommé par les tournées), `pose` (stocké, consommé par rien encore). */
export const SKILL_ROLES = ['entretien', 'pose'];

/** @param {unknown} role */
export const estRoleValide = (role) => SKILL_ROLES.includes(role);

/**
 * Compétences vides pour un technicien : rien coché = jamais proposé, quel que
 * soit le rôle. Sert de forme par défaut aux loaders.
 * @returns {{ entretien: string[], pose: string[] }}
 */
export const competencesVides = () => Object.fromEntries(SKILL_ROLES.map((r) => [r, []]));
