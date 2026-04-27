/**
 * mailCampaignStats.service.js — Lecture seule sur la vue agrégée des stats
 * ============================================================================
 * Source : public.majordhome_mail_campaign_stats (1 ligne par campaign_name).
 * ============================================================================
 */

import supabase from '@lib/supabaseClient';

export const mailCampaignStatsService = {
  async list(orgId) {
    const { data, error } = await supabase
      .from('majordhome_mail_campaign_stats')
      .select('*')
      .eq('org_id', orgId)
      .order('last_sent_at', { ascending: false });
    return { data: data || [], error };
  },
};
