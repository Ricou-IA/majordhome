// src/shared/services/orgSettings.service.js
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

/**
 * Service de lecture/écriture des settings d'une organisation.
 * Source : core.organizations.settings (JSONB).
 *
 * Lecture : SELECT direct (RLS scope user→org via security_invoker).
 * Écriture : RPC SECURITY DEFINER org_update_settings (check org_admin côté DB).
 *
 * Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §8
 */
export const orgSettingsService = {
  /**
   * Charge les settings de l'org.
   * @param {string} orgId - core.organizations.id
   * @returns {Promise<{ data: object, error: Error|null }>}
   */
  async getSettings(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .schema('core')
        .from('organizations')
        .select('id, name, settings')
        .eq('id', orgId)
        .single();
      if (error) throw error;
      return data?.settings ?? {};
    }, 'orgSettings.getSettings');
  },

  /**
   * Met à jour les settings via la RPC (shallow merge JSONB).
   * Le patch est merge au 1er niveau ; pour territoire_centers (sous-arbre),
   * l'arbre entier est remplacé.
   * @param {string} orgId
   * @param {object} patch - sous-arbre JSONB à merger
   * @returns {Promise<{ data: object, error: Error|null }>}
   */
  async updateSettings(orgId, patch) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('org_update_settings', {
        p_org_id: orgId,
        p_patch: patch,
      });
      if (error) throw error;
      return data;
    }, 'orgSettings.updateSettings');
  },
};
