/**
 * usePermissions.js - Majord'home Artisan
 * ============================================================================
 * Hooks React Query pour le système de permissions.
 *
 * - usePermissions(orgId) : charge la permission map depuis la DB
 * - useCanAccess() : hook convenience avec can(resource, action)
 * - useOrgMembers(orgId) : liste des membres pour la gestion d'équipe
 *
 * @version 1.0.0 - Sprint 7 — Droits & Accès
 * ============================================================================
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { permissionsService } from '@services/permissions.service';
import { buildPermissionMap, hasPermission } from '@lib/permissions';
import { permissionKeys } from '@hooks/cacheKeys';

// Re-export for backward compatibility
export { permissionKeys } from '@hooks/cacheKeys';

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Charge la matrice de permissions pour une organisation.
 * Retourne un permissionMap (lookup rapide) + les rows brutes.
 *
 * @param {string} orgId - core.organizations.id
 */
export function usePermissions(orgId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: permissionKeys.org(orgId),
    queryFn: async () => {
      const { data: rows, error: fetchError } = await permissionsService.getPermissions(orgId);
      if (fetchError) throw fetchError;
      return {
        rows: rows || [],
        map: buildPermissionMap(rows || []),
      };
    },
    enabled: !!orgId,
    staleTime: 5 * 60_000, // 5 min — les permissions changent rarement
  });

  return {
    permissionMap: data?.map || {},
    permissionRows: data?.rows || [],
    isLoading,
    error,
    refetch,
  };
}

/**
 * Hook convenience : can(resource, action) pré-wired avec le rôle effectif.
 * Usage : const { can, effectiveRole } = useCanAccess();
 *         can('pipeline', 'view') → true/false
 */
export function useCanAccess() {
  const { effectiveRole, organization, user } = useAuth();
  const { permissionMap, isLoading } = usePermissions(organization?.id);

  const can = useCallback(
    (resource, action) => {
      // Pendant le chargement, org_admin a toujours accès, les autres non
      if (isLoading) return effectiveRole === 'org_admin';
      return hasPermission(permissionMap, effectiveRole, resource, action);
    },
    [permissionMap, effectiveRole, isLoading]
  );

  /**
   * Vérifie si l'utilisateur est propriétaire d'un enregistrement.
   * Compare le userId avec un champ de l'enregistrement.
   *
   * @param {Object} record - L'enregistrement à vérifier
   * @param {string} [ownerField='assigned_user_id'] - Nom du champ propriétaire
   * @returns {boolean}
   */
  const isOwner = useCallback(
    (record, ownerField = 'assigned_user_id') => {
      if (!user?.id || !record) return false;
      return record[ownerField] === user.id;
    },
    [user?.id]
  );

  /**
   * Vérifie si l'utilisateur peut éditer un enregistrement.
   * Tient compte de edit (global) et edit_own (seulement les siens).
   */
  const canEdit = useCallback(
    (resource, record, ownerField = 'assigned_user_id') => {
      if (can(resource, 'edit')) return true;
      if (can(resource, 'edit_own') && isOwner(record, ownerField)) return true;
      return false;
    },
    [can, isOwner]
  );

  return {
    can,
    canEdit,
    isOwner,
    effectiveRole,
    permissionsLoading: isLoading,
  };
}

/**
 * Charge les membres Auth de l'organisation (core.organization_members + profils).
 *
 * @param {string} orgId - core.organizations.id
 */
export function useOrgMembers(orgId) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: permissionKeys.members(orgId),
    queryFn: async () => {
      const { data: members, error: fetchError } = await permissionsService.getOrgMembers(orgId);
      if (fetchError) throw fetchError;
      return members || [];
    },
    enabled: !!orgId,
    staleTime: 60_000, // 1 min
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, appRole, businessRole, membershipRole }) =>
      permissionsService.updateMemberRole(orgId, userId, appRole, businessRole, membershipRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: permissionKeys.members(orgId) });
    },
  });

  const inviteMemberMutation = useMutation({
    mutationFn: ({ email, password, fullName, effectiveRole }) =>
      permissionsService.inviteMember({ email, password, fullName, orgId, effectiveRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: permissionKeys.members(orgId) });
    },
  });

  return {
    members: data || [],
    isLoading,
    error,
    refetch,
    updateRole: updateRoleMutation.mutateAsync,
    isUpdatingRole: updateRoleMutation.isPending,
    inviteMember: inviteMemberMutation.mutateAsync,
    isInviting: inviteMemberMutation.isPending,
  };
}

