/**
 * orgRoles.service.js — profils « maison » d'une organisation
 * ============================================================================
 * Lecture : vues majordhome_org_roles / majordhome_member_org_roles (security_invoker).
 * Écriture : RPC SECURITY DEFINER org_admin (20261006_2) — jamais d'écriture directe.
 * Retour : { data, error } (withErrorHandling), jamais de throw au caller.
 * ============================================================================
 */

import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

export const orgRolesService = {
  /** Tous les profils de l'org (actifs ET inactifs), triés par libellé. */
  async listOrgRoles(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_org_roles')
        .select('id, org_id, code, label, base_role, is_active, created_at, updated_at')
        .eq('org_id', orgId)
        .order('label');
      if (error) throw error;
      return data || [];
    }, 'orgRoles.listOrgRoles');
  },

  /** Qui porte quel profil (une ligne par membre porteur). */
  async listMemberOrgRoles(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_member_org_roles')
        .select('org_id, user_id, org_role_id, code, label, base_role, is_active')
        .eq('org_id', orgId);
      if (error) throw error;
      return data || [];
    }, 'orgRoles.listMemberOrgRoles');
  },

  async createOrgRole({ orgId, label, baseRole }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('org_role_create', {
        p_org_id: orgId, p_label: label, p_base_role: baseRole,
      });
      if (error) throw error;
      return data;
    }, 'orgRoles.createOrgRole');
  },

  /** NULL = inchangé (libellé ou activation). Le code et le modèle sont immuables. */
  async updateOrgRole({ orgRoleId, label = null, isActive = null }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('org_role_update', {
        p_org_role_id: orgRoleId, p_label: label, p_is_active: isActive,
      });
      if (error) throw error;
      return data;
    }, 'orgRoles.updateOrgRole');
  },

  /** Irréversible : purge les surcharges, les porteurs retombent sur le modèle. */
  async deleteOrgRole(orgRoleId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('org_role_delete', { p_org_role_id: orgRoleId });
      if (error) throw error;
      return data;
    }, 'orgRoles.deleteOrgRole');
  },

  /** orgRoleId null = retour à un rôle standard (l'appelant pose ensuite le standard via updateMemberRole). */
  async setMemberOrgRole({ orgId, userId, orgRoleId }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('member_set_org_role', {
        p_org_id: orgId, p_user_id: userId, p_org_role_id: orgRoleId,
      });
      if (error) throw error;
      return data;
    }, 'orgRoles.setMemberOrgRole');
  },
};

export default orgRolesService;
