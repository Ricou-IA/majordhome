/**
 * mailCampaignStats.service.js — Lecture seule sur la vue agrégée des stats
 * ============================================================================
 * Source : public.majordhome_mail_campaign_stats (1 ligne par campaign_name).
 * ============================================================================
 */

import supabase from '@lib/supabaseClient';

const RECIPIENT_COLUMNS =
  'id, campaign_name, email_to, client_id, lead_id, recipient_name, client_number, status, sent_at, opened_at, clicked_at, bounced_at, complained_at, last_event_at, open_count, click_count, error_message, unsubscribed_after_send, unsubscribed_at';

// Colonne de tri (event le plus récent en premier) selon le type de drill-down.
const ORDER_BY = {
  opened: 'opened_at',
  clicked: 'clicked_at',
  bounced: 'bounced_at',
  unsubscribed: 'unsubscribed_at',
};

export const mailCampaignStatsService = {
  async list(orgId) {
    const { data, error } = await supabase
      .from('majordhome_mail_campaign_stats')
      .select('*')
      .eq('org_id', orgId)
      .order('last_sent_at', { ascending: false });
    return { data: data || [], error };
  },

  /**
   * Détail des destinataires d'une campagne, filtré par type d'event (drill-down
   * de l'onglet Stats). Lit la vue public.majordhome_mail_campaign_recipients.
   * mode ∈ 'opened' | 'clicked' | 'bounced' | 'unsubscribed'.
   * Les filtres reproduisent exactement le décompte de majordhome_mail_campaign_stats.
   */
  async listRecipients(orgId, campaignName, mode) {
    let q = supabase
      .from('majordhome_mail_campaign_recipients')
      .select(RECIPIENT_COLUMNS)
      .eq('org_id', orgId)
      .eq('campaign_name', campaignName);

    if (mode === 'opened') q = q.in('status', ['opened', 'clicked']);
    else if (mode === 'clicked') q = q.eq('status', 'clicked');
    else if (mode === 'bounced') q = q.eq('status', 'bounced');
    else if (mode === 'unsubscribed') q = q.eq('unsubscribed_after_send', true);

    q = q.order(ORDER_BY[mode] || 'last_event_at', { ascending: false, nullsFirst: false });

    const { data, error } = await q;
    return { data: data || [], error };
  },
};
