/**
 * permissions.js - Majord'home Artisan
 * ============================================================================
 * Système de permissions centralisé.
 * - computeEffectiveRole : calcule le rôle effectif depuis profile + membership
 * - buildPermissionMap : transforme les rows DB en lookup map
 * - hasPermission : check d'accès rapide
 * - Constantes RESOURCES / ACTIONS pour l'UI éditeur
 *
 * @version 1.0.0 - Sprint 7 — Droits & Accès
 * ============================================================================
 */

// =============================================================================
// CONSTANTES
// =============================================================================

/** Rôles effectifs possibles */
export const EFFECTIVE_ROLES = ['org_admin', 'team_leader', 'commercial', 'technicien'];

/** Rôles éditables dans la matrice (org_admin a toujours tout) */
export const EDITABLE_ROLES = ['team_leader', 'commercial', 'technicien'];

/** Ressources disponibles avec labels FR */
export const RESOURCES = [
  { key: 'dashboard',  label: 'Dashboard' },
  { key: 'clients',    label: 'Clients' },
  { key: 'pipeline',   label: 'Pipeline' },
  { key: 'chantiers',  label: 'Chantiers' },
  { key: 'planning',   label: 'Planning' },
  { key: 'entretiens', label: 'Entretiens' },
  { key: 'territoire', label: 'Territoire' },
  { key: 'cedants',    label: 'Cédants' },
  { key: 'prospection_commerciale', label: 'Prospection' },
  { key: 'devis',      label: 'Devis' },
  { key: 'tasks',      label: 'Tâches' },
  { key: 'meta_ads',   label: 'Meta Ads' },
  { key: 'settings',   label: 'Paramètres' },
];

/** Actions disponibles avec labels FR */
export const ACTIONS = [
  { key: 'view',     label: 'Voir' },
  { key: 'create',   label: 'Créer' },
  { key: 'edit',     label: 'Modifier' },
  { key: 'edit_own', label: 'Modifier (les siens)' },
  { key: 'delete',   label: 'Supprimer' },
  { key: 'assign',   label: 'Assigner' },
];

/** Labels FR pour les rôles effectifs */
export const ROLE_LABELS = {
  org_admin: 'Administrateur',
  team_leader: 'Responsable',
  commercial: 'Commercial',
  technicien: 'Technicien',
};

/** Mapping rôle effectif → valeurs DB (app_role, business_role, membership.role) */
export const ROLE_DB_MAPPING = {
  org_admin:   { app_role: 'org_admin',   business_role: null,         membership_role: 'org_admin' },
  team_leader: { app_role: 'team_leader', business_role: null,         membership_role: 'team_leader' },
  commercial:  { app_role: 'user',        business_role: 'Commercial', membership_role: 'member' },
  technicien:  { app_role: 'user',        business_role: 'Technicien', membership_role: 'member' },
};

// =============================================================================
// EFFECTIVE ROLE
// =============================================================================

/**
 * Calcule le rôle effectif unique à partir du profil et du membership.
 * Ordre de priorité : org_admin > team_leader > commercial > technicien (default)
 *
 * @param {Object|null} profile - core.profiles row (app_role, business_role)
 * @param {Object|null} membership - core.organization_members row (role)
 * @returns {string} - 'org_admin' | 'team_leader' | 'commercial' | 'technicien'
 */
export function computeEffectiveRole(profile, membership) {
  const appRole = profile?.app_role;
  const businessRole = profile?.business_role;
  const membershipRole = membership?.role;

  // Admin
  if (appRole === 'org_admin' || membershipRole === 'org_admin') {
    return 'org_admin';
  }

  // Team leader
  if (appRole === 'team_leader' || membershipRole === 'team_leader') {
    return 'team_leader';
  }

  // Commercial (business_role discrimine parmi les users)
  if (
    businessRole &&
    typeof businessRole === 'string' &&
    businessRole.toLowerCase() === 'commercial'
  ) {
    return 'commercial';
  }

  // Default : technicien
  return 'technicien';
}

// =============================================================================
// PERMISSION MAP
// =============================================================================

/**
 * Transforme un array de rows DB en lookup map.
 * Clé : "role:resource:action" → boolean
 *
 * @param {Array} rows - Rows depuis majordhome.role_permissions
 * @returns {Object} - Ex: { 'commercial:pipeline:view': true, ... }
 */
export function buildPermissionMap(rows) {
  const map = {};
  for (const row of rows) {
    const key = `${row.role}:${row.resource}:${row.action}`;
    map[key] = row.allowed;
  }
  return map;
}

/**
 * Vérifie si un rôle a la permission pour une resource/action.
 * org_admin a TOUJOURS accès (hardcoded pour éviter un lock-out).
 *
 * @param {Object} permissionMap - Map issue de buildPermissionMap
 * @param {string} role - Rôle effectif
 * @param {string} resource - Ex: 'pipeline', 'clients'
 * @param {string} action - Ex: 'view', 'create', 'edit', 'delete'
 * @returns {boolean}
 */
export function hasPermission(permissionMap, role, resource, action) {
  // Sécurité : org_admin = accès total (même si DB corrompu)
  if (role === 'org_admin') return true;

  const key = `${role}:${resource}:${action}`;
  return permissionMap[key] === true;
}

/**
 * Récupère les actions autorisées pour un rôle sur une resource.
 *
 * @param {Object} permissionMap - Map issue de buildPermissionMap
 * @param {string} role - Rôle effectif
 * @param {string} resource - Ex: 'pipeline'
 * @returns {Object} - Ex: { view: true, create: false, edit: false, ... }
 */
export function getResourcePermissions(permissionMap, role, resource) {
  if (role === 'org_admin') {
    // Admin : tout autorisé
    const result = {};
    for (const a of ACTIONS) {
      result[a.key] = true;
    }
    return result;
  }

  const result = {};
  for (const a of ACTIONS) {
    const key = `${role}:${resource}:${a.key}`;
    result[a.key] = permissionMap[key] === true;
  }
  return result;
}
