/**
 * leadInteractions.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion de la timeline d'interactions des leads MT-LT.
 *
 * Lecture : vue publique majordhome_lead_interactions
 * Ecriture : RPC SECURITY DEFINER (create/update/delete_majordhome_lead_interaction)
 *
 * @version 1.0.0
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

export const INTERACTION_CHANNELS = [
  { value: 'phone', label: 'Téléphone', icon: 'Phone' },
  { value: 'email', label: 'Email', icon: 'Mail' },
  { value: 'sms', label: 'SMS', icon: 'MessageSquare' },
  { value: 'meeting', label: 'Rendez-vous', icon: 'Users' },
  { value: 'note', label: 'Note', icon: 'StickyNote' },
];

export const leadInteractionsService = {
  async getByLeadId(leadId) {
    if (!leadId) return { data: [], error: null };

    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_lead_interactions')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    }, 'leadInteractions.getByLeadId');
  },

  async create({ leadId, channel, summary, nextAction, nextActionDate, createdAt }) {
    if (!leadId || !channel || !summary) {
      throw new Error('[leadInteractions] leadId, channel et summary requis');
    }

    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('create_majordhome_lead_interaction', {
        p_data: {
          lead_id: leadId,
          channel,
          summary,
          next_action: nextAction || null,
          next_action_date: nextActionDate || null,
          created_at: createdAt || null,
        },
      });

      if (error) throw error;
      return data;
    }, 'leadInteractions.create');
  },

  async update(interactionId, updates) {
    if (!interactionId) throw new Error('[leadInteractions] interactionId requis');

    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('update_majordhome_lead_interaction', {
        p_interaction_id: interactionId,
        p_updates: updates,
      });

      if (error) throw error;
      return data;
    }, 'leadInteractions.update');
  },

  async delete(interactionId) {
    if (!interactionId) throw new Error('[leadInteractions] interactionId requis');

    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('delete_majordhome_lead_interaction', {
        p_interaction_id: interactionId,
      });

      if (error) throw error;
      return data;
    }, 'leadInteractions.delete');
  },
};

export default leadInteractionsService;
