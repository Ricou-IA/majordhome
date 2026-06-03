import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

export const callCampaignsService = {
  async startSession({ orgId, kanban = 'entretien', params = {} }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('call_session_start', {
        p_org_id: orgId, p_kanban: kanban, p_params: params,
      });
      if (error) throw error;
      return data; // session id (uuid)
    }, 'callCampaigns.startSession');
  },

  async recordAttempt({ orgId, sessionId, interventionId = null, leadId = null, result, phone = null, note = null }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('call_attempt_record', {
        p_org_id: orgId, p_session_id: sessionId,
        p_intervention_id: interventionId, p_lead_id: leadId,
        p_result: result, p_phone: phone, p_note: note,
      });
      if (error) throw error;
      return data; // attempt id
    }, 'callCampaigns.recordAttempt');
  },

  async getCardContext(interventionId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('call_get_card_context', { p_intervention_id: interventionId });
      if (error) throw error;
      return data; // { intervention_id, client_id, client_name, client_phone, contract_id, contract_number, visit_year }
    }, 'callCampaigns.getCardContext');
  },

  async getStats(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_call_attempt_stats')
        .select('intervention_id, lead_id, call_count, last_call_at, last_call_result')
        .eq('org_id', orgId);
      if (error) throw error;
      return data || [];
    }, 'callCampaigns.getStats');
  },
};
