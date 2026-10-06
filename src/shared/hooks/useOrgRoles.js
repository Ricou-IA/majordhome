/**
 * useOrgRoles — profils « maison » d'une org (listes + mutations).
 * ============================================================================
 * Contrat mutations : unwrapResult → mutateAsync résout avec data, REJETTE sur
 * { error } ; côté appelant try/catch + toast.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orgRolesService } from '@services/orgRoles.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { orgRoleKeys, permissionKeys, appointmentKeys } from '@hooks/cacheKeys';

export function useOrgRoles(orgId) {
  const queryClient = useQueryClient();

  const rolesQuery = useQuery({
    queryKey: orgRoleKeys.list(orgId),
    queryFn: () => orgRolesService.listOrgRoles(orgId),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    select: (r) => r?.data || [],
  });
  const membersQuery = useQuery({
    queryKey: orgRoleKeys.members(orgId),
    queryFn: () => orgRolesService.listMemberOrgRoles(orgId),
    enabled: !!orgId,
    staleTime: 60_000,
    select: (r) => r?.data || [],
  });

  const orgRoles = useMemo(() => rolesQuery.data || [], [rolesQuery.data]);
  const activeOrgRoles = useMemo(() => orgRoles.filter((r) => r.is_active), [orgRoles]);
  const memberOrgRoleByUser = useMemo(() => {
    const map = new Map();
    (membersQuery.data || []).forEach((m) => map.set(m.user_id, m));
    return map;
  }, [membersQuery.data]);

  // Une mutation peut réaligner les champs core d'un membre (modèle) et son rôle
  // planning : on invalide la grille, les membres et les ressources planning.
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: orgRoleKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: permissionKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: appointmentKeys.teamMembers(orgId) });
  };

  const createMutation = useMutation({
    mutationFn: ({ label, baseRole }) => unwrapResult(orgRolesService.createOrgRole({ orgId, label, baseRole })),
    onSuccess: invalidateAll,
  });
  const updateMutation = useMutation({
    mutationFn: ({ orgRoleId, label, isActive }) => unwrapResult(orgRolesService.updateOrgRole({ orgRoleId, label, isActive })),
    onSuccess: invalidateAll,
  });
  const deleteMutation = useMutation({
    mutationFn: (orgRoleId) => unwrapResult(orgRolesService.deleteOrgRole(orgRoleId)),
    onSuccess: invalidateAll,
  });
  const setMemberMutation = useMutation({
    mutationFn: ({ userId, orgRoleId }) => unwrapResult(orgRolesService.setMemberOrgRole({ orgId, userId, orgRoleId })),
    onSuccess: invalidateAll,
  });

  return {
    orgRoles,
    activeOrgRoles,
    memberOrgRoleByUser,
    isLoading: rolesQuery.isLoading || membersQuery.isLoading,
    error: rolesQuery.error || membersQuery.error,
    createOrgRole: createMutation.mutateAsync,
    updateOrgRole: updateMutation.mutateAsync,
    deleteOrgRole: deleteMutation.mutateAsync,
    setMemberOrgRole: setMemberMutation.mutateAsync,
    isMutating: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || setMemberMutation.isPending,
  };
}

export default useOrgRoles;
