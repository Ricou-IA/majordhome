// src/lib/orgRoles.js
// ============================================================================
// Profils « maison » — logique de PRÉSENTATION (module pur, aucun import).
// Un profil maison = libellé propre à l'org + modèle standard (base_role).
// Partout où le code teste un rôle, c'est le modèle qui est vu ; la grille Droits
// d'accès est la seule à distinguer le profil (spec 2026-10-06 § 2).
// Testé : node --test scripts/org-roles.test.mjs
// ============================================================================

export const ORG_ROLE_PREFIX = 'org:';
export const BASE_ROLES = ['team_leader', 'commercial', 'technicien'];

/** Ce que le modèle emporte HORS grille (gestes testés en dur dans le code). */
export const BASE_ROLE_HINTS = {
  team_leader: 'Hérite de tout ce que le code réserve aux responsables hors grille : avoirs, import Pennylane, envoi de factures, réglages d’équipe.',
  commercial: 'Vu comme un commercial par le planning (RDV commerciaux) et le pipeline ; aucun geste réservé aux responsables.',
  technicien: 'Vu comme un technicien par le planning (tournées, RDV techniques) ; profil le plus restreint hors grille.',
};

const STANDARD_ROLES = ['org_admin', 'team_leader', 'commercial', 'technicien'];
const dApres = (labels, baseRole) => `d’après ${labels[baseRole] || baseRole}`;
const actifs = (orgRoles) => (orgRoles || []).filter((r) => r.is_active !== false);

/** Valeur d'option d'un profil maison dans un <select> de rôle. */
export function roleChoiceValue(orgRole) {
  return `${ORG_ROLE_PREFIX}${orgRole.id}`;
}

/** Décode une valeur de <select> : rôle standard ou profil maison, null si inconnue. */
export function parseRoleChoice(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith(ORG_ROLE_PREFIX)) {
    const orgRoleId = value.slice(ORG_ROLE_PREFIX.length);
    return orgRoleId ? { kind: 'org', orgRoleId } : null;
  }
  if (STANDARD_ROLES.includes(value)) return { kind: 'standard', role: value };
  return null;
}

/** Options d'un <select> de rôle : standards puis profils maison ACTIFS. */
export function buildRoleOptions(standardRoles, labels, orgRoles) {
  return [
    ...standardRoles.map((role) => ({ value: role, label: labels[role] || role })),
    ...actifs(orgRoles).map((r) => ({ value: roleChoiceValue(r), label: `${r.label} (${dApres(labels, r.base_role)})` })),
  ];
}

/** Libellé d'un membre : son profil maison s'il en porte un, sinon son rôle standard. */
export function memberRoleDisplay(effectiveRole, orgRole, labels) {
  if (orgRole) return { label: orgRole.label, sub: dApres(labels, orgRole.base_role) };
  return { label: labels[effectiveRole] || effectiveRole, sub: null };
}

/** Colonnes de la grille Droits d'accès : standards puis profils maison ACTIFS. */
export function permissionColumns(editableRoles, labels, orgRoles) {
  return [
    ...editableRoles.map((role) => ({ key: role, role, code: null, label: labels[role] || role, sub: null, orgRole: null })),
    ...actifs(orgRoles).map((r) => ({
      key: r.code, role: r.base_role, code: r.code, label: r.label, sub: dApres(labels, r.base_role), orgRole: r,
    })),
  ];
}
