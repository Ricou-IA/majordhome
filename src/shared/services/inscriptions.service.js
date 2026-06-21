/**
 * inscriptions.service.js - Majord'home Artisan
 * ============================================================================
 * Module Offres/Inscriptions : lecture des inscriptions aux campagnes (offres).
 * Lecture via la vue publique majordhome_campaign_inscriptions (RLS security_invoker).
 * Ecriture = uniquement cote site via la RPC public.inscription_record (hors app).
 * Org : core (alignee sur clients/mail_campaigns) - filtre explicite (defense en profondeur).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

export const inscriptionsService = {
  /**
   * Liste des inscriptions (vue enrichie : campaign_label, client_display_name).
   * @param {object} params
   * @param {string} params.orgId - org core (obligatoire, defense en profondeur)
   * @param {string} [params.campaignKey] - filtre campagne exact
   */
  async getInscriptions({ orgId, campaignKey } = {}) {
    return withErrorHandling(async () => {
      let query = supabase
        .from('majordhome_campaign_inscriptions')
        .select('*')
        .order('created_at', { ascending: false });

      if (orgId) query = query.eq('org_id', orgId);
      if (campaignKey) query = query.eq('campaign_key', campaignKey);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }, 'inscriptions.getInscriptions');
  },
};

export default inscriptionsService;
