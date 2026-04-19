/**
 * mailCampaigns.service.js — CRUD sur majordhome.mail_campaigns
 * ============================================================================
 * Gestion des templates de mailing paramétrables (carte d'identité + contenu).
 * ============================================================================
 */

import supabase from '@lib/supabaseClient';

export const mailCampaignsService = {
  async list(orgId, { includeArchived = false } = {}) {
    let query = supabase
      .from('majordhome_mail_campaigns')
      .select('*')
      .eq('org_id', orgId)
      .order('key', { ascending: true });

    if (!includeArchived) query = query.eq('is_archived', false);

    const { data, error } = await query;
    return { data: data || [], error };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('majordhome_mail_campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return { data, error };
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('majordhome_mail_campaigns')
      .insert(payload)
      .select()
      .single();
    return { data, error };
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('majordhome_mail_campaigns')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  },

  async archive(id) {
    return this.update(id, { is_archived: true });
  },

  async unarchive(id) {
    return this.update(id, { is_archived: false });
  },

  async remove(id) {
    const { error } = await supabase
      .from('majordhome_mail_campaigns')
      .delete()
      .eq('id', id);
    return { error };
  },

  async duplicate(campaign, newKey) {
    const {
      id: _id,
      created_at: _ca,
      updated_at: _ua,
      created_by: _cb,
      ...rest
    } = campaign;
    return this.create({ ...rest, key: newKey, label: `${rest.label} (copie)` });
  },
};
