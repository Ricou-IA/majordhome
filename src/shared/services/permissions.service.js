/**
 * permissions.service.js - Majord'home Artisan
 * ============================================================================
 * Service CRUD pour la gestion des permissions (role_permissions table)
 * et des membres de l'organisation.
 *
 * @version 1.0.0 - Sprint 7 — Droits & Accès
 * ============================================================================
 */

import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

// =============================================================================
// SERVICE
// =============================================================================

export const permissionsService = {
  // ===========================================================================
  // PERMISSIONS
  // ===========================================================================

  /**
   * Récupère toutes les permissions d'une organisation
   * @param {string} orgId - core.organizations.id
   * @returns {Promise<{data: Array|null, error: Error|null}>}
   */
  async getPermissions(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_role_permissions')
        .select('*')
        .eq('org_id', orgId)
        .order('resource')
        .order('action');
      if (error) throw error;
      return data;
    }, 'permissions.getPermissions');
  },

  /**
   * Met à jour une permission (upsert)
   * @param {string} orgId
   * @param {string} role
   * @param {string} resource
   * @param {string} action
   * @param {boolean} allowed
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async updatePermission(orgId, role, resource, action, allowed) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .schema('majordhome')
        .from('role_permissions')
        .upsert(
          { org_id: orgId, role, resource, action, allowed, updated_at: new Date().toISOString() },
          { onConflict: 'org_id,role,resource,action' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'permissions.updatePermission');
  },

  /**
   * Met à jour plusieurs permissions d'un coup
   * @param {string} orgId
   * @param {Array<{role, resource, action, allowed}>} updates
   * @returns {Promise<{data: Array|null, error: Error|null}>}
   */
  async bulkUpdatePermissions(orgId, updates) {
    return withErrorHandling(async () => {
      const rows = updates.map((u) => ({
        org_id: orgId, role: u.role, resource: u.resource,
        action: u.action, allowed: u.allowed, updated_at: new Date().toISOString(),
      }));
      const { data, error } = await supabase
        .schema('majordhome')
        .from('role_permissions')
        .upsert(rows, { onConflict: 'org_id,role,resource,action' })
        .select();
      if (error) throw error;
      return data;
    }, 'permissions.bulkUpdatePermissions');
  },

  // ===========================================================================
  // MEMBRES DE L'ORG
  // ===========================================================================

  /**
   * Récupère les membres de l'organisation avec leurs profils
   * @param {string} orgId - core.organizations.id
   * @returns {Promise<{data: Array|null, error: Error|null}>}
   */
  async getOrgMembers(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('organization_members')
        .select('*')
        .eq('org_id', orgId)
        .eq('status', 'active');
      if (error) throw error;

      if (data?.length > 0) {
        const userIds = data.map((m) => m.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url, app_role, business_role')
          .in('id', userIds);

        if (profiles) {
          const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
          for (const member of data) {
            member.profile = profileMap[member.user_id] || null;
          }
        }
      }
      return data;
    }, 'permissions.getOrgMembers');
  },

  /**
   * Invite un nouveau membre dans l'organisation via l'Edge Function create-user.
   * Mappe le rôle effectif vers les valeurs DB (app_role + business_role).
   *
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.password
   * @param {string} params.fullName
   * @param {string} params.orgId - core.organizations.id
   * @param {string} params.effectiveRole - 'org_admin' | 'team_leader' | 'commercial' | 'technicien'
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async inviteMember({ email, password, fullName, orgId, effectiveRole }) {
    return withErrorHandling(async () => {
      const { ROLE_DB_MAPPING } = await import('@lib/permissions');
      const mapping = ROLE_DB_MAPPING[effectiveRole];
      if (!mapping) throw new Error(`Rôle inconnu : ${effectiveRole}`);

      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: email.trim(), password, fullName: fullName.trim(),
          orgId, appRole: mapping.app_role, businessRole: mapping.business_role,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    }, 'permissions.inviteMember');
  },

  /**
   * Change le rôle d'un membre via la RPC sécurisée
   * @param {string} orgId
   * @param {string} userId
   * @param {string} appRole - 'org_admin' | 'team_leader' | 'user'
   * @param {string|null} businessRole - 'Commercial' | 'Technicien' | null
   * @param {string} membershipRole - 'org_admin' | 'team_leader' | 'member'
   * @returns {Promise<{error: Error|null}>}
   */
  async updateMemberRole(orgId, userId, appRole, businessRole, membershipRole) {
    return withErrorHandling(async () => {
      const { error } = await supabase.rpc('update_member_role', {
        p_org_id: orgId, p_user_id: userId, p_app_role: appRole,
        p_business_role: businessRole, p_membership_role: membershipRole,
      });
      if (error) throw error;
      return null;
    }, 'permissions.updateMemberRole');
  },
};

export default permissionsService;
