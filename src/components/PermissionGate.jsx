/**
 * PermissionGate.jsx - Majord'home Artisan
 * ============================================================================
 * Composant déclaratif pour le rendu conditionnel basé sur les permissions.
 *
 * Usage :
 *   <PermissionGate resource="clients" action="delete">
 *     <DeleteButton />
 *   </PermissionGate>
 *
 *   <PermissionGate resource="pipeline" action="create" fallback={<span>Accès restreint</span>}>
 *     <NewLeadButton />
 *   </PermissionGate>
 *
 * @version 1.0.0 - Sprint 7 — Droits & Accès
 * ============================================================================
 */

import { useCanAccess } from '@hooks/usePermissions';

/**
 * Affiche ses children uniquement si l'utilisateur a la permission.
 *
 * @param {string} resource - Ex: 'pipeline', 'clients'
 * @param {string} action - Ex: 'view', 'create', 'edit', 'delete'
 * @param {React.ReactNode} [fallback=null] - Contenu alternatif si non autorisé
 * @param {React.ReactNode} children - Contenu si autorisé
 */
export function PermissionGate({ resource, action, fallback = null, children }) {
  const { can } = useCanAccess();

  if (!can(resource, action)) {
    return fallback;
  }

  return children;
}

export default PermissionGate;
