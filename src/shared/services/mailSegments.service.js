/**
 * mailSegments.service.js — CRUD sur majordhome.mail_segments
 * ============================================================================
 * Catalogue de segments de ciblage mailing réutilisables.
 * Chaque segment = audience + filtres jsonb (DSL SegmentFilters).
 *
 * Les RPCs `mail_segment_compile` / `mail_segment_count` / `mail_segment_preview`
 * transforment les filters en SQL exécutable (côté serveur, SECURITY DEFINER).
 * ============================================================================
 */

import supabase from '@lib/supabaseClient';

export const mailSegmentsService = {
  async list(orgId, { includeArchived = false } = {}) {
    let query = supabase
      .from('majordhome_mail_segments')
      .select('*')
      .eq('org_id', orgId)
      .order('is_preset', { ascending: false })
      .order('name', { ascending: true });

    if (!includeArchived) query = query.eq('is_archived', false);

    const { data, error } = await query;
    return { data: data || [], error };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('majordhome_mail_segments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return { data, error };
  },

  async create(payload) {
    const { data, error } = await supabase
      .from('majordhome_mail_segments')
      .insert(payload)
      .select()
      .single();
    return { data, error };
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('majordhome_mail_segments')
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
      .from('majordhome_mail_segments')
      .delete()
      .eq('id', id);
    return { error };
  },

  async duplicate(segment) {
    const {
      id: _id,
      created_at: _ca,
      updated_at: _ua,
      created_by: _cb,
      created_by_name: _cbn,
      is_preset: _ip,
      ...rest
    } = segment;
    return this.create({
      ...rest,
      name: `${rest.name} (copie)`,
      is_preset: false,
    });
  },

  async compileSql({ filters, campaignName = null, orgId }) {
    const { data, error } = await supabase.rpc('mail_segment_compile', {
      p_filters: filters,
      p_campaign_name: campaignName,
      p_org_id: orgId,
    });
    return { data, error };
  },

  async count({ filters, campaignName = null, orgId }) {
    const { data, error } = await supabase.rpc('mail_segment_count', {
      p_filters: filters,
      p_campaign_name: campaignName,
      p_org_id: orgId,
    });
    return { data: data ?? 0, error };
  },

  async preview({ filters, campaignName = null, orgId, limit = 20 }) {
    const { data, error } = await supabase.rpc('mail_segment_preview', {
      p_filters: filters,
      p_campaign_name: campaignName,
      p_org_id: orgId,
      p_limit: limit,
    });
    return { data: data || [], error };
  },
};
